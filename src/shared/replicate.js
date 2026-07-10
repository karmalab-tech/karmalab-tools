// Shared Replicate API helpers, used by the Batch Image Studio and the
// Continuous Video Studio.
//
// All requests are same-origin (relative `/v1/...`): in dev Vite proxies them
// to Replicate, in production the Node server does. Either way there is no
// cross-origin request from the browser, so no CORS problem.

export const MAX_CONCURRENT = 3;
export const POLL_INTERVAL_MS = 1500;
export const POLL_TIMEOUT_MS = 5 * 60 * 1000;

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
    const msg = (data && (data.detail || data.error || JSON.stringify(data))) || `HTTP ${resp.status}`;
    throw new Error(msg);
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
