// Namespaced localStorage helpers (best-effort — never throw if unavailable).

const PREFIX = 'karmalab.continuousVideoStudio.';

// The Batch Image Studio stores the same Replicate token under its own
// namespace — fall back to it so the token only has to be pasted once.
const BATCH_TOKEN_KEY = 'karmalab.batchImageStudio.replicateToken';

export function loadKey(key) {
  try {
    const own = localStorage.getItem(PREFIX + key);
    if (own) return own;
    if (key === 'replicateToken') return localStorage.getItem(BATCH_TOKEN_KEY) || '';
    return '';
  } catch {
    return '';
  }
}

export function saveKey(key, value) {
  try {
    if (value) localStorage.setItem(PREFIX + key, value);
    else localStorage.removeItem(PREFIX + key);
  } catch {
    /* localStorage unavailable — ignore */
  }
}
