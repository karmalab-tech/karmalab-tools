// Shared Replicate API helpers, used by the Batch Image Studio and the
// Continuous Video Studio.
//
// All requests are same-origin (relative `/v1/...`): in dev Vite proxies them
// to Replicate, in production the Node server does. Either way there is no
// cross-origin request from the browser, so no CORS problem.

export const MAX_CONCURRENT = 3;
export const POLL_INTERVAL_MS = 1500;
export const POLL_TIMEOUT_MS = 5 * 60 * 1000;

// Video predictions run much longer than image ones — poll slower, wait longer.
export const VIDEO_POLL = { intervalMs: 3000, timeoutMs: 30 * 60 * 1000 };

export async function createPrediction(modelId, input, apiKey) {
  const resp = await fetch(`/v1/models/${modelId}/predictions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    // Prefer Replicate's own wording, then whatever body there was, and only
    // fall back to the status code when the body is empty or unreadable —
    // stringifying an empty object first would just report "{}" to the user.
    const detail = data && (data.detail || data.error);
    const body = data && Object.keys(data).length ? JSON.stringify(data) : '';
    throw new Error(detail || body || `HTTP ${resp.status}`);
  }
  return data;
}

// Fetch a prediction's current state once (no polling). Used to load pending
// jobs back when the app reopens.
export async function getPrediction(predictionId, apiKey) {
  const resp = await fetch(`/v1/predictions/${predictionId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error((data && (data.detail || data.error)) || `HTTP ${resp.status}`);
  return data;
}

export async function pollPrediction(
  predictionId,
  apiKey,
  shouldCancel,
  { intervalMs = POLL_INTERVAL_MS, timeoutMs = POLL_TIMEOUT_MS } = {}
) {
  const pollUrl = `/v1/predictions/${predictionId}`;
  const start = Date.now();
  while (true) {
    if (shouldCancel()) throw new Error('Cancelled');
    const resp = await fetch(pollUrl, { headers: { Authorization: `Bearer ${apiKey}` } });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error((data && (data.detail || data.error)) || `HTTP ${resp.status}`);
    if (data.status === 'succeeded') return data;
    if (data.status === 'failed' || data.status === 'canceled') {
      throw new Error(data.error || `Prediction ${data.status}`);
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out waiting for the prediction to finish.');
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

// First URL in a Replicate output, whatever shape the model returns.
export function extractOutputUrl(output) {
  if (!output) return null;
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) return output[0];
  if (typeof output === 'object' && output.url) {
    return typeof output.url === 'function' ? output.url() : output.url;
  }
  return null;
}

// A failed fetch to our own `/v1` path means the request never left the page —
// in practice the proxy is missing (the pages were opened without the dev or
// built server). Say that instead of the browser's opaque "Failed to fetch".
export function friendlyErrorMessage(err) {
  const message = (err && err.message) || 'Something went wrong.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(message)) {
    return 'Request blocked before reaching Replicate — almost always the proxy. Make sure you are on the dev server (yarn dev) or the built server (yarn start).';
  }
  return message;
}
