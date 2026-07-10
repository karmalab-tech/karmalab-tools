// Shared Replicate API token storage (best-effort localStorage — never throw).
//
// The token is managed by the ApiKeyModal (opened from the TopBar) and shared
// by every tool. Earlier versions stored it under per-tool namespaces — those
// are still read as a fallback so existing users keep their token.

const KEY = 'karmalab.replicateToken';

const LEGACY_KEYS = [
  'karmalab.batchImageStudio.replicateToken',
  'karmalab.continuousVideoStudio.replicateToken',
];

export function loadApiKey() {
  try {
    return (
      localStorage.getItem(KEY) ||
      LEGACY_KEYS.map((k) => localStorage.getItem(k)).find(Boolean) ||
      ''
    );
  } catch {
    return '';
  }
}

export function saveApiKey(value) {
  try {
    if (value) localStorage.setItem(KEY, value);
    else localStorage.removeItem(KEY);
  } catch {
    /* localStorage unavailable — ignore */
  }
}
