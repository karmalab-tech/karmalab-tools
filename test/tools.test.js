// The tools' own logic: what each model wants as input, what persists between
// sessions, and how the Batch Video Studio's two modes flatten into one run list.
// None of it needs a DOM; `localStorage` is stubbed where it is touched.
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildInput } from '../src/apps/batch/replicate.js';
import { buildVideoInput } from '../src/shared/videoModels.js';
import { addJob, loadJobs, loadKey, removeJob, saveKey } from '../src/apps/batch/storage.js';
import { createToolStorage } from '../src/shared/storage.js';
import { buildItems, splitPrompts } from '../src/apps/batchVideo/items.js';

const base = { promptText: 'a cat', suffix: '', aspect: '1:1', extraValues: {} };

describe('buildInput', () => {
  it('sends the prompt as-is when there is no suffix', () => {
    expect(buildInput({}, base)).toEqual({ prompt: 'a cat' });
  });

  it('appends a suffix and collapses the whitespace', () => {
    expect(buildInput({}, { ...base, suffix: '  in watercolour  ' })).toEqual({
      prompt: 'a cat in watercolour',
    });
  });

  it('treats a whitespace-only suffix as absent', () => {
    expect(buildInput({}, { ...base, suffix: '   ' })).toEqual({ prompt: 'a cat' });
  });

  it('writes the aspect to whichever key the model uses', () => {
    expect(buildInput({ aspectField: 'aspect_ratio' }, base).aspect_ratio).toBe('1:1');
    expect(buildInput({ aspectField: 'size' }, base).size).toBe('1:1');
  });

  it('omits the aspect entirely for a model that takes none', () => {
    expect(buildInput({}, base)).not.toHaveProperty('aspect_ratio');
  });

  it("carries the model's static extra input", () => {
    expect(buildInput({ extraInput: { quality: 'high' } }, base)).toEqual({
      prompt: 'a cat',
      quality: 'high',
    });
  });

  it('sends a reference image bare or wrapped, per the model', () => {
    const withImage = { ...base, referenceImageDataUri: 'data:image/png;base64,AAA' };
    expect(buildInput({ imageField: 'image' }, withImage).image).toBe('data:image/png;base64,AAA');
    expect(
      buildInput({ imageField: 'input_images', imageIsArray: true }, withImage).input_images
    ).toEqual(['data:image/png;base64,AAA']);
  });

  it('omits the image key when the model supports one but none was given', () => {
    expect(buildInput({ imageField: 'image' }, base)).not.toHaveProperty('image');
  });

  it('drops an image the model cannot accept', () => {
    const withImage = { ...base, referenceImageDataUri: 'data:image/png;base64,AAA' };
    expect(buildInput({ imageField: null }, withImage)).toEqual({ prompt: 'a cat' });
  });

  it('includes filled-in extra fields and skips blank ones', () => {
    const cfg = {
      extraFields: [{ key: 'openai_api_key' }, { key: 'negative_prompt' }, { key: 'seed' }],
    };
    const input = buildInput(cfg, {
      ...base,
      extraValues: { openai_api_key: '  sk-test  ', negative_prompt: '', seed: '   ' },
    });
    expect(input.openai_api_key).toBe('sk-test');
    expect(input).not.toHaveProperty('negative_prompt');
    expect(input).not.toHaveProperty('seed');
  });

  it("lets an extra field override the model's static input", () => {
    const input = buildInput(
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

const PREFIX = 'karmalab.batchImageStudio.';

function stubLocalStorage(store = new Map()) {
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  return store;
}

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

describe('pending jobs', () => {
  beforeEach(() => {
    stubLocalStorage();
  });

  it('starts empty', () => {
    expect(loadJobs()).toEqual([]);
  });

  it('round-trips jobs in insertion order', () => {
    addJob({ predictionId: 'p1', prompt: 'a cat' });
    addJob({ predictionId: 'p2', prompt: 'a dog' });
    expect(loadJobs()).toEqual([
      { predictionId: 'p1', prompt: 'a cat' },
      { predictionId: 'p2', prompt: 'a dog' },
    ]);
  });

  it('replaces rather than duplicates a job with the same prediction id', () => {
    addJob({ predictionId: 'p1', prompt: 'first' });
    addJob({ predictionId: 'p1', prompt: 'second' });
    expect(loadJobs()).toEqual([{ predictionId: 'p1', prompt: 'second' }]);
  });

  it('removes a job by prediction id and leaves the others', () => {
    addJob({ predictionId: 'p1' });
    addJob({ predictionId: 'p2' });
    removeJob('p1');
    expect(loadJobs()).toEqual([{ predictionId: 'p2' }]);
  });

  it('clears the storage entry once the last job is removed', () => {
    const store = stubLocalStorage();
    addJob({ predictionId: 'p1' });
    removeJob('p1');
    expect(store.has(`${PREFIX}pendingJobs`)).toBe(false);
  });

  it('recovers from corrupt stored JSON instead of throwing', () => {
    const store = stubLocalStorage();
    store.set(`${PREFIX}pendingJobs`, '{not json');
    expect(loadJobs()).toEqual([]);
  });

  it('ignores stored data that is not an array', () => {
    const store = stubLocalStorage();
    store.set(`${PREFIX}pendingJobs`, '{"predictionId":"p1"}');
    expect(loadJobs()).toEqual([]);
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
    expect(loadJobs()).toEqual([]);
    expect(() => saveKey('model', 'flux')).not.toThrow();
    expect(() => addJob({ predictionId: 'p1' })).not.toThrow();
    expect(() => removeJob('p1')).not.toThrow();
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

  it("keeps two tools' pending jobs apart", () => {
    const images = createToolStorage('batchImageStudio');
    const videos = createToolStorage('batchVideoStudio');

    images.addJob({ predictionId: 'img1' });
    videos.addJob({ predictionId: 'vid1' });

    expect(images.loadJobs()).toEqual([{ predictionId: 'img1' }]);
    expect(videos.loadJobs()).toEqual([{ predictionId: 'vid1' }]);

    // Clearing one tool's jobs must leave the other's alone.
    images.removeJob('img1');
    expect(images.loadJobs()).toEqual([]);
    expect(videos.loadJobs()).toEqual([{ predictionId: 'vid1' }]);
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
