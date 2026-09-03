// The tools' own logic: what each model wants as input, what persists between
// sessions (the run recovered after a closed tab, and the history of finished
// runs), how the Batch Video Studio's two modes flatten into one run list, and
// how the Image Chain Studio finds the step a chain continues from.
// None of it needs a DOM; `localStorage` is stubbed where it is touched.
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CHAIN_MODEL_KEYS, MODEL_CONFIGS, buildImageInput } from '../src/shared/imageModels.js';
import { buildVideoInput } from '../src/shared/videoModels.js';
import { loadKey, saveKey, storage } from '../src/apps/batch/storage.js';
import { HISTORY_LIMIT, createToolStorage } from '../src/shared/storage.js';
import { runCounts, runStatus, runTabTitle, serializeItem, uiStatus } from '../src/shared/runs.js';
import { buildItems, splitPrompts } from '../src/apps/batchVideo/items.js';
import {
  MAX_STEPS,
  chainSource,
  imageName,
  nextStepIndex,
  parseStepCount,
  sourceLabel,
  stepId,
} from '../src/apps/imageChain/chain.js';
import {
  DEFAULT_MS_PER_IMAGE,
  MAX_MS_PER_IMAGE,
  MIN_MS_PER_IMAGE,
  frameSequence,
  parseDurationMs,
  totalDurationMs,
} from '../src/apps/imageChain/video.js';

const base = { promptText: 'a cat', suffix: '', aspect: '1:1', extraValues: {} };

describe('buildImageInput', () => {
  it('sends the prompt as-is when there is no suffix', () => {
    expect(buildImageInput({}, base)).toEqual({ prompt: 'a cat' });
  });

  it('appends a suffix and collapses the whitespace', () => {
    expect(buildImageInput({}, { ...base, suffix: '  in watercolour  ' })).toEqual({
      prompt: 'a cat in watercolour',
    });
  });

  it('treats a whitespace-only suffix as absent', () => {
    expect(buildImageInput({}, { ...base, suffix: '   ' })).toEqual({ prompt: 'a cat' });
  });

  it('writes the aspect to whichever key the model uses', () => {
    expect(buildImageInput({ aspectField: 'aspect_ratio' }, base).aspect_ratio).toBe('1:1');
    expect(buildImageInput({ aspectField: 'size' }, base).size).toBe('1:1');
  });

  it('omits the aspect entirely for a model that takes none', () => {
    expect(buildImageInput({}, base)).not.toHaveProperty('aspect_ratio');
  });

  it("carries the model's static extra input", () => {
    expect(buildImageInput({ extraInput: { quality: 'high' } }, base)).toEqual({
      prompt: 'a cat',
      quality: 'high',
    });
  });

  it('sends a reference image bare or wrapped, per the model', () => {
    const withImage = { ...base, referenceImage: 'data:image/png;base64,AAA' };
    expect(buildImageInput({ imageField: 'image' }, withImage).image).toBe(
      'data:image/png;base64,AAA'
    );
    expect(
      buildImageInput({ imageField: 'input_images', imageIsArray: true }, withImage).input_images
    ).toEqual(['data:image/png;base64,AAA']);
  });

  it('omits the image key when the model supports one but none was given', () => {
    expect(buildImageInput({ imageField: 'image' }, base)).not.toHaveProperty('image');
  });

  it('drops an image the model cannot accept', () => {
    const withImage = { ...base, referenceImage: 'data:image/png;base64,AAA' };
    expect(buildImageInput({ imageField: null }, withImage)).toEqual({ prompt: 'a cat' });
  });

  it('includes filled-in extra fields and skips blank ones', () => {
    const cfg = {
      extraFields: [{ key: 'openai_api_key' }, { key: 'negative_prompt' }, { key: 'seed' }],
    };
    const input = buildImageInput(cfg, {
      ...base,
      extraValues: { openai_api_key: '  sk-test  ', negative_prompt: '', seed: '   ' },
    });
    expect(input.openai_api_key).toBe('sk-test');
    expect(input).not.toHaveProperty('negative_prompt');
    expect(input).not.toHaveProperty('seed');
  });

  it("lets an extra field override the model's static input", () => {
    const input = buildImageInput(
      { extraInput: { quality: 'high' }, extraFields: [{ key: 'quality' }] },
      { ...base, extraValues: { quality: 'low' } }
    );
    expect(input.quality).toBe('low');
  });
});

// The video tools' equivalent: same job, a different per-model field shape.
describe('buildVideoInput', () => {
  const cfg = { fields: [{ key: 'duration' }, { key: 'resolution' }], imageField: 'first_frame' };

  it("sends the prompt plus the model's static input", () => {
    expect(
      buildVideoInput(
        { fields: [], extraInput: { fps: 24 } },
        { prompt: 'a cat', optionValues: {} }
      )
    ).toEqual({
      prompt: 'a cat',
      fps: 24,
    });
  });

  it('includes the option values the model declares', () => {
    const input = buildVideoInput(cfg, {
      prompt: 'a cat',
      optionValues: { duration: 8, resolution: '1080p' },
    });
    expect(input).toEqual({ prompt: 'a cat', duration: 8, resolution: '1080p' });
  });

  it('skips options that are unset, null or blank — but keeps false and 0', () => {
    const boolCfg = {
      fields: [{ key: 'sound' }, { key: 'seed' }, { key: 'style' }, { key: 'gone' }],
    };
    const input = buildVideoInput(boolCfg, {
      prompt: 'a cat',
      optionValues: { sound: false, seed: 0, style: '', gone: null },
    });
    expect(input.sound).toBe(false);
    expect(input.seed).toBe(0);
    expect(input).not.toHaveProperty('style');
    expect(input).not.toHaveProperty('gone');
  });

  it("writes the start frame to the model's image field", () => {
    const input = buildVideoInput(cfg, {
      prompt: 'a cat',
      optionValues: {},
      startFrameDataUri: 'data:image/jpeg;base64,AAA',
    });
    expect(input.first_frame).toBe('data:image/jpeg;base64,AAA');
  });

  it('omits the image field for text-to-video', () => {
    const input = buildVideoInput(cfg, { prompt: 'a cat', optionValues: {} });
    expect(input).not.toHaveProperty('first_frame');
  });
});

// The run model every tool normalises its cards to: what gets persisted,
// what a run's progress adds up to, and what the browser tab says about it.
describe('serializeItem', () => {
  it('keeps the fields a recovered card is rebuilt from', () => {
    expect(
      serializeItem({
        id: 'r1',
        predictionId: 'p1',
        status: 'running',
        prompt: 'a cat',
        label: 'Video 1',
        basename: 'video-01',
        outputUrl: null,
        error: null,
        index: 0,
      })
    ).toEqual({
      id: 'r1',
      predictionId: 'p1',
      status: 'running',
      prompt: 'a cat',
      label: 'Video 1',
      basename: 'video-01',
      outputUrl: null,
      error: null,
      index: 0,
    });
  });

  // The whole point of the whitelist: image data URIs would blow the quota.
  it('drops in-memory extras like frames and object URLs', () => {
    const persisted = serializeItem({
      id: 'c1',
      status: 'succeeded',
      startFrame: 'data:image/jpeg;base64,AAA',
      endFrame: 'data:image/jpeg;base64,BBB',
      videoUrl: 'blob:http://localhost/abc',
    });
    expect(persisted).toEqual({ id: 'c1', status: 'succeeded' });
  });

  it('omits keys that were never set rather than writing undefined', () => {
    expect(Object.keys(serializeItem({ id: 'r1', status: 'queued' }))).toEqual(['id', 'status']);
  });
});

describe('runCounts', () => {
  const items = (...statuses) => statuses.map((status, i) => ({ id: `r${i}`, status }));

  it('counts what landed, what failed and what is still going', () => {
    expect(runCounts(items('succeeded', 'failed', 'running', 'queued'))).toEqual({
      total: 4,
      succeeded: 1,
      failed: 1,
      done: 2,
      active: 2,
    });
  });

  it('has nothing active once every item is terminal', () => {
    expect(runCounts(items('succeeded', 'failed')).active).toBe(0);
  });

  it('handles an empty run', () => {
    expect(runCounts([])).toEqual({ total: 0, succeeded: 0, failed: 0, done: 0, active: 0 });
  });
});

describe('runStatus', () => {
  const items = (...statuses) => statuses.map((status, i) => ({ id: `r${i}`, status }));

  it('is running while anything is in flight', () => {
    expect(runStatus(items('succeeded', 'running'))).toBe('running');
    expect(runStatus(items('failed', 'queued'))).toBe('running');
  });

  it('is succeeded or failed when the whole run went one way', () => {
    expect(runStatus(items('succeeded', 'succeeded'))).toBe('succeeded');
    expect(runStatus(items('failed', 'failed'))).toBe('failed');
  });

  it('is partial for a mixed result', () => {
    expect(runStatus(items('succeeded', 'failed'))).toBe('partial');
  });
});

describe('runTabTitle', () => {
  const counts = (over) => ({ total: 6, succeeded: 2, failed: 0, done: 2, active: 4, ...over });

  it('shows the progress while the run is going', () => {
    expect(runTabTitle('Studio', counts(), false)).toBe('⏳ 2/6 · Studio');
  });

  it('marks a finished run, and flags one that had failures', () => {
    const finished = counts({ succeeded: 6, done: 6, active: 0 });
    expect(runTabTitle('Studio', finished, true)).toBe('✅ 6/6 · Studio');
    const withFailures = counts({ succeeded: 4, failed: 2, done: 6, active: 0 });
    expect(runTabTitle('Studio', withFailures, true)).toBe('⚠️ 4/6 · Studio');
  });

  it('leaves the page title alone when there is nothing to report', () => {
    expect(runTabTitle('Studio', counts({ succeeded: 6, done: 6, active: 0 }), false)).toBe(
      'Studio'
    );
    expect(runTabTitle('Studio', runCounts([]), true)).toBe('Studio');
  });

  it('prefers the progress over the finished marker', () => {
    expect(runTabTitle('Studio', counts(), true)).toBe('⏳ 2/6 · Studio');
  });
});

describe('uiStatus', () => {
  it("maps Replicate's wording onto the UI's", () => {
    expect(uiStatus('starting')).toBe('queued');
    expect(uiStatus('processing')).toBe('running');
    expect(uiStatus('succeeded')).toBe('succeeded');
    expect(uiStatus('canceled')).toBe('canceled');
  });
});

const PREFIX = 'karmalab.batchImageStudio.';

function stubLocalStorage(store = new Map()) {
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  return store;
}

const item = (over = {}) => ({
  id: 'r1',
  predictionId: 'p1',
  status: 'running',
  prompt: 'a cat',
  ...over,
});

const run = (over = {}) => ({
  id: 'run-1',
  title: '2 images',
  createdAt: 1700000000000,
  items: [item()],
  ...over,
});

describe('loadKey / saveKey', () => {
  let store;
  beforeEach(() => {
    store = stubLocalStorage();
  });

  it('namespaces what it writes', () => {
    saveKey('model', 'openai/gpt-image-2');
    expect(store.get(`${PREFIX}model`)).toBe('openai/gpt-image-2');
    expect(loadKey('model')).toBe('openai/gpt-image-2');
  });

  it('returns an empty string for a key that was never set', () => {
    expect(loadKey('nope')).toBe('');
  });

  it('removes the key when saving an empty value', () => {
    saveKey('model', 'flux');
    saveKey('model', '');
    expect(store.has(`${PREFIX}model`)).toBe(false);
    expect(loadKey('model')).toBe('');
  });
});

// The run in progress is what a reopened tab recovers from, so what it stores
// (and what it refuses to store) is the whole feature.
describe('the current run', () => {
  let store;
  beforeEach(() => {
    store = stubLocalStorage();
  });

  it('starts empty', () => {
    expect(storage.loadCurrentRun()).toBeNull();
  });

  it('round-trips a run with its items', () => {
    storage.saveCurrentRun(run());
    expect(storage.loadCurrentRun()).toEqual({
      id: 'run-1',
      title: '2 images',
      createdAt: 1700000000000,
      finishedAt: null,
      items: [item()],
    });
  });

  it('namespaces the entry it writes', () => {
    storage.saveCurrentRun(run());
    expect(store.has(`${PREFIX}currentRun`)).toBe(true);
  });

  it('clears the entry', () => {
    storage.saveCurrentRun(run());
    storage.clearCurrentRun();
    expect(store.has(`${PREFIX}currentRun`)).toBe(false);
    expect(storage.loadCurrentRun()).toBeNull();
  });

  it('recovers from corrupt stored JSON instead of throwing', () => {
    store.set(`${PREFIX}currentRun`, '{not json');
    expect(storage.loadCurrentRun()).toBeNull();
  });

  it('ignores a stored run with no usable items', () => {
    store.set(`${PREFIX}currentRun`, JSON.stringify({ id: 'run-1', items: 'nope' }));
    expect(storage.loadCurrentRun()).toBeNull();
    store.set(`${PREFIX}currentRun`, JSON.stringify({ id: 'run-1', items: [{}, null] }));
    expect(storage.loadCurrentRun()).toBeNull();
  });

  it('fills in the metadata a hand-edited entry is missing', () => {
    store.set(`${PREFIX}currentRun`, JSON.stringify({ items: [item()] }));
    const loaded = storage.loadCurrentRun();
    expect(loaded.id).toMatch(/^run-/);
    expect(loaded.title).toBe('Generation');
    expect(Number.isFinite(loaded.createdAt)).toBe(true);
  });
});

describe('run history', () => {
  let store;
  beforeEach(() => {
    store = stubLocalStorage();
  });

  it('starts empty', () => {
    expect(storage.loadHistory()).toEqual([]);
  });

  it('archiving moves the current run into history', () => {
    storage.saveCurrentRun(run());
    storage.archiveRun(run({ finishedAt: 1700000001000 }));
    expect(store.has(`${PREFIX}currentRun`)).toBe(false);
    expect(storage.loadHistory().map((r) => r.id)).toEqual(['run-1']);
    expect(storage.loadHistory()[0].finishedAt).toBe(1700000001000);
  });

  it('keeps the newest run first', () => {
    storage.archiveRun(run({ id: 'run-1' }));
    storage.archiveRun(run({ id: 'run-2' }));
    expect(storage.loadHistory().map((r) => r.id)).toEqual(['run-2', 'run-1']);
  });

  it('replaces rather than duplicates a run archived twice', () => {
    storage.archiveRun(run({ id: 'run-1', title: 'first' }));
    storage.archiveRun(run({ id: 'run-1', title: 'second' }));
    const history = storage.loadHistory();
    expect(history).toHaveLength(1);
    expect(history[0].title).toBe('second');
  });

  it('removes a run from the list', () => {
    storage.archiveRun(run({ id: 'run-1' }));
    storage.archiveRun(run({ id: 'run-2' }));
    storage.removeHistoryRun('run-1');
    expect(storage.loadHistory().map((r) => r.id)).toEqual(['run-2']);
  });

  it('leaves the list alone when removing a run that is not in it', () => {
    storage.archiveRun(run({ id: 'run-1' }));
    storage.removeHistoryRun('run-nope');
    expect(storage.loadHistory().map((r) => r.id)).toEqual(['run-1']);
  });

  it('caps the list so it cannot grow without bound', () => {
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) storage.archiveRun(run({ id: `run-${i}` }));
    const history = storage.loadHistory();
    expect(history).toHaveLength(HISTORY_LIMIT);
    // Newest kept, oldest dropped.
    expect(history[0].id).toBe(`run-${HISTORY_LIMIT + 4}`);
    expect(history.some((r) => r.id === 'run-0')).toBe(false);
  });

  it('writes back a refreshed run that is already in history', () => {
    storage.archiveRun(run({ id: 'run-1' }));
    storage.updateHistoryRun(run({ id: 'run-1', items: [item({ status: 'succeeded' })] }));
    expect(storage.loadHistory()[0].items[0].status).toBe('succeeded');
  });

  it('does not add a run that is not in history yet', () => {
    storage.updateHistoryRun(run({ id: 'run-9' }));
    expect(storage.loadHistory()).toEqual([]);
  });

  it('clears the whole list', () => {
    storage.archiveRun(run());
    storage.clearHistory();
    expect(storage.loadHistory()).toEqual([]);
    expect(store.has(`${PREFIX}runHistory`)).toBe(false);
  });

  it('drops entries it cannot make sense of', () => {
    store.set(`${PREFIX}runHistory`, JSON.stringify([run(), null, { items: [] }]));
    expect(storage.loadHistory()).toHaveLength(1);
  });
});

// Tabs closed before the run model shipped left a flat list of pending jobs.
describe('migrating pre-run-model pending jobs', () => {
  let store;
  beforeEach(() => {
    store = stubLocalStorage();
  });

  it('reads them back as one recovered run', () => {
    store.set(
      `${PREFIX}pendingJobs`,
      JSON.stringify([
        { predictionId: 'p1', prompt: 'a cat' },
        { predictionId: 'p2', prompt: 'a dog', label: 'Video 2', basename: 'video-02' },
      ])
    );
    const recovered = storage.loadCurrentRun();
    expect(recovered.items.map((i) => i.predictionId)).toEqual(['p1', 'p2']);
    expect(recovered.items[0].status).toBe('running');
    expect(recovered.items[1].basename).toBe('video-02');
  });

  it('drops the old entry so it is only recovered once', () => {
    store.set(`${PREFIX}pendingJobs`, JSON.stringify([{ predictionId: 'p1' }]));
    expect(storage.loadCurrentRun()).not.toBeNull();
    expect(store.has(`${PREFIX}pendingJobs`)).toBe(false);
    expect(storage.loadCurrentRun()).toBeNull();
  });

  it('ignores an empty or unusable entry', () => {
    store.set(`${PREFIX}pendingJobs`, '[]');
    expect(storage.loadCurrentRun()).toBeNull();
    store.set(`${PREFIX}pendingJobs`, '{not json');
    expect(storage.loadCurrentRun()).toBeNull();
  });

  it('prefers a real current run over the legacy entry', () => {
    storage.saveCurrentRun(run());
    store.set(`${PREFIX}pendingJobs`, JSON.stringify([{ predictionId: 'legacy' }]));
    expect(storage.loadCurrentRun().id).toBe('run-1');
  });
});

describe('when localStorage is unavailable', () => {
  beforeEach(() => {
    // Safari in private mode, and any browser with storage blocked, throws here.
    globalThis.localStorage = {
      getItem: vi.fn(() => {
        throw new Error('SecurityError');
      }),
      setItem: vi.fn(() => {
        throw new Error('SecurityError');
      }),
      removeItem: vi.fn(() => {
        throw new Error('SecurityError');
      }),
    };
  });

  it('degrades quietly rather than breaking the tool', () => {
    expect(loadKey('model')).toBe('');
    expect(storage.loadCurrentRun()).toBeNull();
    expect(storage.loadHistory()).toEqual([]);
    expect(() => saveKey('model', 'flux')).not.toThrow();
    expect(() => storage.saveCurrentRun(run())).not.toThrow();
    expect(() => storage.archiveRun(run())).not.toThrow();
    expect(() => storage.clearHistory()).not.toThrow();
  });
});

// Over quota, keeping the newest runs beats losing the write entirely.
describe('when storage is over quota', () => {
  it('retries the history write with fewer runs', () => {
    const store = new Map();
    let allow = false;
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => {
        // Reject the first (full) write of each save, accept the retry.
        allow = !allow;
        if (allow) throw new Error('QuotaExceededError');
        store.set(k, String(v));
      },
      removeItem: (k) => store.delete(k),
    };
    const tool = createToolStorage('quotaTest');
    tool.saveHistory([run({ id: 'a' }), run({ id: 'b' }), run({ id: 'c' }), run({ id: 'd' })]);
    expect(tool.loadHistory().map((r) => r.id)).toEqual(['a', 'b']);
  });
});

describe('createToolStorage namespacing', () => {
  let store;
  beforeEach(() => {
    store = stubLocalStorage();
  });

  it('prefixes keys with the tool namespace', () => {
    createToolStorage('batchVideoStudio').saveKey('model', 'google/veo-3.1');
    expect(store.get('karmalab.batchVideoStudio.model')).toBe('google/veo-3.1');
  });

  it("keeps two tools from reading each other's values", () => {
    const images = createToolStorage('batchImageStudio');
    const videos = createToolStorage('batchVideoStudio');

    images.saveKey('model', 'flux');
    videos.saveKey('model', 'veo');

    expect(images.loadKey('model')).toBe('flux');
    expect(videos.loadKey('model')).toBe('veo');
  });

  it("keeps two tools' runs and history apart", () => {
    const images = createToolStorage('batchImageStudio');
    const videos = createToolStorage('batchVideoStudio');

    images.saveCurrentRun(run({ id: 'img-run' }));
    videos.saveCurrentRun(run({ id: 'vid-run' }));
    expect(images.loadCurrentRun().id).toBe('img-run');
    expect(videos.loadCurrentRun().id).toBe('vid-run');

    images.archiveRun(run({ id: 'img-run' }));
    expect(images.loadCurrentRun()).toBeNull();
    expect(images.loadHistory().map((r) => r.id)).toEqual(['img-run']);
    // Archiving one tool's run must leave the other's alone.
    expect(videos.loadCurrentRun().id).toBe('vid-run');
    expect(videos.loadHistory()).toEqual([]);
  });
});

describe('splitPrompts', () => {
  it('takes one prompt per line, trimmed', () => {
    expect(splitPrompts('a cat\n  a dog  \na bird')).toEqual(['a cat', 'a dog', 'a bird']);
  });

  it('drops blank and whitespace-only lines', () => {
    expect(splitPrompts('a cat\n\n   \na dog\n')).toEqual(['a cat', 'a dog']);
  });

  it('returns nothing for empty input', () => {
    expect(splitPrompts('')).toEqual([]);
    expect(splitPrompts('   \n  ')).toEqual([]);
  });
});

describe('buildItems, prompts mode', () => {
  it('makes one item per prompt, numbered and zero-padded', () => {
    const items = buildItems({ mode: 'prompts', promptsText: 'a cat\na dog', sharedFrame: null });
    expect(items).toEqual([
      { prompt: 'a cat', startFrame: null, label: 'Video 1', basename: 'video-01' },
      { prompt: 'a dog', startFrame: null, label: 'Video 2', basename: 'video-02' },
    ]);
  });

  it('gives every item the shared start frame when there is one', () => {
    const items = buildItems({
      mode: 'prompts',
      promptsText: 'a cat\na dog',
      sharedFrame: { dataUri: 'data:image/png;base64,AAA', name: 'ref.png' },
    });
    expect(items.map((i) => i.startFrame)).toEqual([
      'data:image/png;base64,AAA',
      'data:image/png;base64,AAA',
    ]);
  });

  it('is text-to-video when no frame is given', () => {
    const items = buildItems({ mode: 'prompts', promptsText: 'a cat', sharedFrame: null });
    expect(items[0].startFrame).toBeNull();
  });

  it('pads past nine so filenames sort correctly', () => {
    const promptsText = Array.from({ length: 11 }, (_, i) => `prompt ${i + 1}`).join('\n');
    const items = buildItems({ mode: 'prompts', promptsText, sharedFrame: null });
    expect(items[8].basename).toBe('video-09');
    expect(items[9].basename).toBe('video-10');
    expect(items[10].basename).toBe('video-11');
  });
});

describe('buildItems, frames mode', () => {
  const frame = (name) => ({ name, dataUri: `data:image/png;base64,${name}` });

  it('makes one item per frame, all sharing the one prompt', () => {
    const items = buildItems({
      mode: 'frames',
      prompt: '  slow dolly in  ',
      frames: [frame('a.png'), frame('b.png')],
    });
    expect(items.map((i) => i.prompt)).toEqual(['slow dolly in', 'slow dolly in']);
    expect(items.map((i) => i.startFrame)).toEqual([
      'data:image/png;base64,a.png',
      'data:image/png;base64,b.png',
    ]);
  });

  it('labels each card with the uploaded filename', () => {
    const items = buildItems({ mode: 'frames', prompt: 'x', frames: [frame('Shot 3.final.PNG')] });
    expect(items[0].label).toBe('Shot 3.final.PNG');
  });

  it('derives a filename-safe stem from the image name', () => {
    const items = buildItems({ mode: 'frames', prompt: 'x', frames: [frame('Shot 3.final.PNG')] });
    expect(items[0].basename).toBe('video-01-shot-3-final');
  });

  it('collapses runs of punctuation and trims the edges', () => {
    const items = buildItems({
      mode: 'frames',
      prompt: 'x',
      frames: [frame('__My   Weird!! Name__.jpg')],
    });
    expect(items[0].basename).toBe('video-01-my-weird-name');
  });

  it('falls back to the bare number when a name slugs to nothing', () => {
    const items = buildItems({ mode: 'frames', prompt: 'x', frames: [frame('!!!.png')] });
    expect(items[0].basename).toBe('video-01');
  });

  it('truncates a very long stem', () => {
    const long = 'a'.repeat(80) + '.png';
    const items = buildItems({ mode: 'frames', prompt: 'x', frames: [frame(long)] });
    expect(items[0].basename).toBe(`video-01-${'a'.repeat(40)}`);
  });

  it('returns nothing when no frames were uploaded', () => {
    expect(buildItems({ mode: 'frames', prompt: 'x', frames: [] })).toEqual([]);
  });
});

// The Image Chain Studio's step model. What links two steps is the earlier
// one's output URL, so most of the chain's logic is picking the right step to
// carry on from — including when the last one failed.
describe('the chainable image models', () => {
  it('lists only the models that take a reference image', () => {
    expect(CHAIN_MODEL_KEYS.length).toBeGreaterThan(0);
    CHAIN_MODEL_KEYS.forEach((k) => expect(MODEL_CONFIGS[k].imageField).toBeTruthy());
  });

  it('leaves out a model that cannot take one', () => {
    const textOnly = Object.keys(MODEL_CONFIGS).filter((k) => !MODEL_CONFIGS[k].imageField);
    textOnly.forEach((k) => expect(CHAIN_MODEL_KEYS).not.toContain(k));
  });
});

describe('parseStepCount', () => {
  it('reads a whole number of steps', () => {
    expect(parseStepCount('4')).toBe(4);
    expect(parseStepCount(' 12 ')).toBe(12);
  });

  it('caps a runaway at the maximum', () => {
    expect(parseStepCount('900')).toBe(MAX_STEPS);
  });

  it('rejects anything that is not a chain', () => {
    expect(parseStepCount('0')).toBeNull();
    expect(parseStepCount('-3')).toBeNull();
    expect(parseStepCount('')).toBeNull();
    expect(parseStepCount('abc')).toBeNull();
    expect(parseStepCount(undefined)).toBeNull();
  });
});

describe('chainSource', () => {
  const step = (index, status, outputUrl = null) => ({
    id: stepId(index),
    index,
    status,
    outputUrl,
    label: `Step ${index + 1}`,
  });

  it('is the newest step that produced an image', () => {
    const items = [step(0, 'succeeded', 'a.png'), step(1, 'succeeded', 'b.png')];
    expect(chainSource(items).outputUrl).toBe('b.png');
  });

  it('skips a failed tail, so an error does not end the chain', () => {
    const items = [step(0, 'succeeded', 'a.png'), step(1, 'failed'), step(2, 'failed')];
    expect(chainSource(items).outputUrl).toBe('a.png');
  });

  it('ignores a step marked succeeded with no image', () => {
    expect(chainSource([step(0, 'succeeded')])).toBeNull();
  });

  it('is null for a chain with nothing to continue from', () => {
    expect(chainSource([])).toBeNull();
    expect(chainSource([step(0, 'running')])).toBeNull();
  });

  it('hands a retried step the image it was given before, not a later one', () => {
    const items = [
      step(0, 'succeeded', 'a.png'),
      step(1, 'succeeded', 'b.png'),
      step(2, 'failed'),
      step(3, 'succeeded', 'd.png'),
    ];
    // Retrying step 3 (index 2) continues from step 2, even though step 4 has
    // since produced an image of its own.
    expect(chainSource(items, 2).outputUrl).toBe('b.png');
    // The first step has nothing before it — it starts the chain.
    expect(chainSource(items, 0)).toBeNull();
  });

  it('names the step an image came from, and nothing for the chain start', () => {
    expect(sourceLabel(step(1, 'succeeded', 'b.png'))).toBe('Step 2');
    expect(sourceLabel({ index: 4, status: 'succeeded', outputUrl: 'e.png' })).toBe('Step 5');
    expect(sourceLabel(null)).toBe('');
  });
});

describe('nextStepIndex', () => {
  it('starts a new chain at zero', () => {
    expect(nextStepIndex([])).toBe(0);
  });

  it('carries on past every step, failed ones included', () => {
    const items = [
      { index: 0, status: 'succeeded' },
      { index: 1, status: 'failed' },
      { index: 2, status: 'succeeded' },
    ];
    expect(nextStepIndex(items)).toBe(3);
  });

  it('follows the indexes a recovered chain came back with', () => {
    expect(nextStepIndex([{ index: 7, status: 'succeeded' }])).toBe(8);
  });
});

describe('a step download name', () => {
  it('is the step number, padded', () => {
    expect(imageName({ index: 0, basename: 'image-01' })).toBe('image-01.png');
    expect(imageName({ index: 11, basename: 'image-12' })).toBe('image-12.png');
  });

  it('falls back to the index when a recovered step has no basename', () => {
    expect(imageName({ index: 4 })).toBe('image-05.png');
  });
});

// Stitching a chain into one video. Only the parts that are arithmetic are
// covered — the encoding itself drives WebCodecs and a canvas, which the node
// test environment has none of, so it is verified in a real browser instead.
describe('the video frame order', () => {
  it('is the chain, in order', () => {
    expect(frameSequence(4, false)).toEqual([0, 1, 2, 3]);
  });

  it('comes back down the chain when looping, without repeating either end', () => {
    // 1,2,3,4,3,2 — the player's own loop supplies the return to image 1, so it
    // is not held twice at the seam.
    expect(frameSequence(4, true)).toEqual([0, 1, 2, 3, 2, 1]);
  });

  it('has nothing to loop through with fewer than three images', () => {
    expect(frameSequence(2, true)).toEqual([0, 1]);
    expect(frameSequence(1, true)).toEqual([0]);
    expect(frameSequence(0, true)).toEqual([]);
  });

  it('gives a looped video very nearly twice the length', () => {
    expect(totalDurationMs(4, 200, false)).toBe(800);
    expect(totalDurationMs(4, 200, true)).toBe(1200);
    expect(totalDurationMs(1, 200, false)).toBe(200);
  });
});

describe('parseDurationMs', () => {
  it('reads a whole number of milliseconds', () => {
    expect(parseDurationMs('200')).toBe(200);
    expect(parseDurationMs(' 40 ')).toBe(40);
    expect(parseDurationMs(String(DEFAULT_MS_PER_IMAGE))).toBe(DEFAULT_MS_PER_IMAGE);
  });

  it('caps a very long hold', () => {
    expect(parseDurationMs('999999')).toBe(MAX_MS_PER_IMAGE);
  });

  it('rejects anything under a frame or not a number', () => {
    expect(parseDurationMs(String(MIN_MS_PER_IMAGE - 1))).toBeNull();
    expect(parseDurationMs('0')).toBeNull();
    expect(parseDurationMs('-100')).toBeNull();
    expect(parseDurationMs('')).toBeNull();
    expect(parseDurationMs('soon')).toBeNull();
  });
});
