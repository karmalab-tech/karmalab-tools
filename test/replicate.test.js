// The shared Replicate helpers, used by both generation tools. The polling loop
// is the part that has to be right: it decides when a run is done, when it has
// failed, and when to give up.
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createPrediction,
  extractOutputUrl,
  friendlyErrorMessage,
  getPrediction,
  pollPrediction,
} from '../src/shared/replicate.js';

// Answer each successive fetch() with the next queued response.
function queueFetch(responses) {
  const calls = [];
  globalThis.fetch = vi.fn((url, options) => {
    calls.push({ url, options });
    const next = responses.shift();
    if (!next) throw new Error('fetch called more times than the test queued');
    return Promise.resolve({
      ok: next.ok ?? true,
      status: next.status ?? 200,
      json: () =>
        next.invalidJson ? Promise.reject(new Error('not json')) : Promise.resolve(next.body),
    });
  });
  return calls;
}

afterEach(() => {
  delete globalThis.fetch;
});

describe('createPrediction', () => {
  it('posts to the model route, same-origin, with the bearer token', async () => {
    const calls = queueFetch([{ body: { id: 'p1' } }]);
    const result = await createPrediction('openai/gpt-image-2', { prompt: 'a cat' }, 'r8_token');

    expect(result).toEqual({ id: 'p1' });
    expect(calls[0].url).toBe('/v1/models/openai/gpt-image-2/predictions');
    // A relative URL is the whole point — an absolute one would be blocked by CORS.
    expect(calls[0].url.startsWith('/')).toBe(true);
    expect(calls[0].options.method).toBe('POST');
    expect(calls[0].options.headers.Authorization).toBe('Bearer r8_token');
    expect(JSON.parse(calls[0].options.body)).toEqual({ input: { prompt: 'a cat' } });
  });

  it("surfaces Replicate's own error message", async () => {
    queueFetch([{ ok: false, status: 422, body: { detail: 'Invalid input: prompt too long' } }]);
    await expect(createPrediction('m/n', {}, 'k')).rejects.toThrow(
      'Invalid input: prompt too long'
    );
  });

  it('falls back to the status code when the error body is unreadable', async () => {
    queueFetch([{ ok: false, status: 500, invalidJson: true }]);
    await expect(createPrediction('m/n', {}, 'k')).rejects.toThrow('HTTP 500');
  });
});

describe('getPrediction', () => {
  it('fetches one prediction without polling', async () => {
    const calls = queueFetch([{ body: { id: 'p1', status: 'processing' } }]);
    const result = await getPrediction('p1', 'r8_token');

    expect(result.status).toBe('processing');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/v1/predictions/p1');
  });

  it('throws on a failed request', async () => {
    queueFetch([{ ok: false, status: 404, body: { detail: 'not found' } }]);
    await expect(getPrediction('missing', 'k')).rejects.toThrow('not found');
  });
});

describe('pollPrediction', () => {
  const never = () => false;

  it('returns the prediction once it succeeds', async () => {
    queueFetch([{ body: { status: 'succeeded', output: 'https://out/1.png' } }]);
    const result = await pollPrediction('p1', 'k', never, { intervalMs: 0 });
    expect(result.output).toBe('https://out/1.png');
  });

  it('keeps polling while the prediction is still running', async () => {
    const calls = queueFetch([
      { body: { status: 'starting' } },
      { body: { status: 'processing' } },
      { body: { status: 'succeeded', output: 'ok' } },
    ]);
    const result = await pollPrediction('p1', 'k', never, { intervalMs: 0 });
    expect(result.output).toBe('ok');
    expect(calls).toHaveLength(3);
  });

  it("throws with the model's error when the prediction fails", async () => {
    queueFetch([{ body: { status: 'failed', error: 'NSFW content detected' } }]);
    await expect(pollPrediction('p1', 'k', never, { intervalMs: 0 })).rejects.toThrow(
      'NSFW content detected'
    );
  });

  it('throws when the prediction is canceled upstream', async () => {
    queueFetch([{ body: { status: 'canceled' } }]);
    await expect(pollPrediction('p1', 'k', never, { intervalMs: 0 })).rejects.toThrow(
      'Prediction canceled'
    );
  });

  it('stops before the first request when already cancelled', async () => {
    const calls = queueFetch([]);
    await expect(pollPrediction('p1', 'k', () => true, { intervalMs: 0 })).rejects.toThrow(
      'Cancelled'
    );
    expect(calls).toHaveLength(0);
  });

  it('gives up once the timeout has passed', async () => {
    queueFetch([{ body: { status: 'processing' } }]);
    await expect(
      pollPrediction('p1', 'k', never, { intervalMs: 0, timeoutMs: -1 })
    ).rejects.toThrow('Timed out waiting for the prediction to finish.');
  });
});

describe('extractOutputUrl', () => {
  it('handles every output shape the models return', () => {
    expect(extractOutputUrl('https://out/1.png')).toBe('https://out/1.png');
    expect(extractOutputUrl(['https://out/1.png', 'https://out/2.png'])).toBe('https://out/1.png');
    expect(extractOutputUrl({ url: 'https://out/1.png' })).toBe('https://out/1.png');
    expect(extractOutputUrl({ url: () => 'https://out/1.png' })).toBe('https://out/1.png');
  });

  it('returns null when there is no output yet', () => {
    expect(extractOutputUrl(null)).toBeNull();
    expect(extractOutputUrl(undefined)).toBeNull();
    expect(extractOutputUrl('')).toBeNull();
  });

  it('returns undefined for an empty array, not a crash', () => {
    expect(extractOutputUrl([])).toBeUndefined();
  });

  it('returns null for an object with no url', () => {
    expect(extractOutputUrl({ status: 'succeeded' })).toBeNull();
  });
});

describe('friendlyErrorMessage', () => {
  it('explains the proxy when the request never left the page', () => {
    // A failed fetch to our own /v1 path means the proxy isn't there — the
    // browser's own wording ("Failed to fetch") tells the user nothing.
    for (const raw of ['Failed to fetch', 'NetworkError when attempting to fetch', 'Load failed']) {
      expect(friendlyErrorMessage(new Error(raw))).toMatch(/proxy/i);
    }
  });

  it('passes a real API error through untouched', () => {
    expect(friendlyErrorMessage(new Error('Invalid input: prompt too long'))).toBe(
      'Invalid input: prompt too long'
    );
  });

  it('has something to say about a thrown value with no message', () => {
    expect(friendlyErrorMessage(null)).toBe('Something went wrong.');
    expect(friendlyErrorMessage(new Error(''))).toBe('Something went wrong.');
  });
});
