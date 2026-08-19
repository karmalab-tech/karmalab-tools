// The Batch Video Studio's two batch modes both collapse into one flat list of
// run items, so nothing downstream needs to know which mode produced them. That
// flattening — and the filename stems it derives from uploaded image names — is
// where a mistake shows up as a wrong or colliding download.
import { describe, expect, it } from 'vitest';

import { buildItems, splitPrompts } from '../src/apps/batchVideo/items.js';

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
