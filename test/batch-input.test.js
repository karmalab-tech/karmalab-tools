// buildInput() turns a model config plus the UI's current values into the
// `input` object sent to Replicate. Every model differs in which keys it wants,
// so this is where a wrong assumption becomes a failed generation.
import { describe, expect, it } from 'vitest';

import { buildInput } from '../src/apps/batch/replicate.js';

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
