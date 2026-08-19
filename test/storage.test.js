// Namespaced localStorage, and the pending-job persistence built on it. A
// Replicate prediction keeps running after the tab closes, so these records are
// what lets a fresh page load pick the run back up — and every read has to
// survive a browser where localStorage throws.
//
// Exercised through the Batch Image Studio's binding, plus the shared factory
// directly, since two tools now have their own namespace in the same storage.
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { addJob, loadJobs, loadKey, removeJob, saveKey } from '../src/apps/batch/storage.js';
import { createToolStorage } from '../src/shared/storage.js';

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
