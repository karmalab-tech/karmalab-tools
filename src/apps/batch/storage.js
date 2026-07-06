// Namespaced localStorage helpers (best-effort — never throw if unavailable).

const PREFIX = 'karmalab.batchImageStudio.';

export function loadKey(key) {
  try {
    return localStorage.getItem(PREFIX + key) || '';
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
