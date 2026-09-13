// Keeping results after Replicate lets go of them.
//
// Replicate deletes an API prediction's output files an hour after it ran — the
// file itself, not just the signature on the URL, so re-asking the API brings
// back a link to nothing. A long batch or a long chain can therefore finish
// with its earliest results already gone: the cards break, the zip quietly
// comes up short, and a run reopened from History has nothing left to download.
//
// So every output is fetched into IndexedDB the moment it lands, while its URL
// is still good, and every download reads the cache before the network. This
// stays inside the app's trust model — the copy is in the browser, on this
// machine, and no server ever sees it.
//
// IndexedDB rather than localStorage: these are megabytes of binary per run,
// which is exactly what PERSISTED_ITEM_KEYS keeps out of localStorage. The
// store is bounded (MAX_BYTES) and evicts oldest-first, so a browser profile
// can't fill up with a year of generations.

const DB_NAME = 'karmalab.outputs';
const DB_VERSION = 1;
const STORE = 'outputs';

// A few hundred images' worth. Big enough that a day's work survives, small
// enough to be a polite guest in someone's browser storage.
export const MAX_BYTES = 500 * 1024 * 1024;

export const cacheSupported = () => typeof indexedDB !== 'undefined';

// One entry per item, namespaced by tool and run so a run can be forgotten in
// one go and two tools can't collide on an item id.
export const cacheKey = (tool, runId, itemId) => `${tool}/${runId}/${itemId}`;

export const keyRun = (key) => key.split('/').slice(0, 2).join('/');

// Which entries to drop to get back under the cap: oldest first, and only as
// many as it takes. Pure, so the arithmetic is testable without a browser.
export function planEviction(entries, maxBytes = MAX_BYTES) {
  const total = entries.reduce((sum, e) => sum + (e.bytes || 0), 0);
  if (total <= maxBytes) return [];
  const oldestFirst = [...entries].sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0));
  const drop = [];
  let freed = 0;
  for (const entry of oldestFirst) {
    if (total - freed <= maxBytes) break;
    drop.push(entry.key);
    freed += entry.bytes || 0;
  }
  return drop;
}

let dbPromise = null;

function openDb() {
  if (!cacheSupported()) return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      let request;
      try {
        request = indexedDB.open(DB_NAME, DB_VERSION);
      } catch {
        return resolve(null); // storage blocked entirely (some private modes)
      }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    });
  }
  return dbPromise;
}

// Every call goes through here: the cache is an optimisation, so a browser that
// refuses it (private mode, blocked storage, quota) degrades to the network
// rather than breaking a download.
function run(mode, work) {
  return openDb().then(
    (db) =>
      new Promise((resolve) => {
        if (!db) return resolve(null);
        let tx;
        try {
          tx = db.transaction(STORE, mode);
        } catch {
          return resolve(null);
        }
        const store = tx.objectStore(STORE);
        let result = null;
        try {
          work(store, (value) => {
            result = value;
          });
        } catch {
          return resolve(null);
        }
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => resolve(null);
        tx.onabort = () => resolve(null);
      })
  );
}

const allEntries = () =>
  run('readonly', (store, set) => {
    const req = store.getAll();
    req.onsuccess = () => set(req.result || []);
  });

async function evictIfNeeded() {
  const entries = await allEntries();
  if (!entries) return;
  const drop = planEviction(entries.map(({ key, bytes, savedAt }) => ({ key, bytes, savedAt })));
  if (drop.length) await run('readwrite', (store) => drop.forEach((key) => store.delete(key)));
}

// Fetch an output and keep it. Called as soon as an item succeeds, while the
// URL is fresh. Never throws: a failure here just means the download later
// falls back to the (possibly expired) URL.
export async function cacheOutput(key, url) {
  if (!cacheSupported() || !key || !url) return null;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    const stored = await run('readwrite', (store) => {
      store.put({ key, blob, bytes: blob.size, savedAt: Date.now() });
    });
    // `run` resolves null on a quota error; make room and try once more.
    if (stored === null) {
      await evictIfNeeded();
      await run('readwrite', (store) => {
        store.put({ key, blob, bytes: blob.size, savedAt: Date.now() });
      });
    }
    await evictIfNeeded();
    return blob;
  } catch {
    return null;
  }
}

export async function cachedBlob(key) {
  if (!cacheSupported() || !key) return null;
  const entry = await run('readonly', (store, set) => {
    const req = store.get(key);
    req.onsuccess = () => set(req.result || null);
  });
  return entry?.blob || null;
}

// Everything a run cached, dropped in one go — a run deleted from history has
// no way back to its files, so keeping them would just be litter.
export async function forgetRuns(runKeys) {
  if (!cacheSupported() || !runKeys.length) return;
  const wanted = new Set(runKeys);
  const entries = (await allEntries()) || [];
  const drop = entries.filter((e) => wanted.has(keyRun(e.key))).map((e) => e.key);
  if (drop.length) await run('readwrite', (store) => drop.forEach((key) => store.delete(key)));
}

export async function forgetTool(tool) {
  if (!cacheSupported()) return;
  const entries = (await allEntries()) || [];
  const drop = entries.filter((e) => e.key.startsWith(`${tool}/`)).map((e) => e.key);
  if (drop.length) await run('readwrite', (store) => drop.forEach((key) => store.delete(key)));
}

// What the cache is holding for one tool, for the History modal to show.
export async function cacheStats(tool) {
  if (!cacheSupported()) return { count: 0, bytes: 0 };
  const entries = (await allEntries()) || [];
  const mine = tool ? entries.filter((e) => e.key.startsWith(`${tool}/`)) : entries;
  return {
    count: mine.length,
    bytes: mine.reduce((sum, e) => sum + (e.bytes || 0), 0),
  };
}

export function formatBytes(bytes) {
  if (!bytes) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return mb < 100 ? `${mb.toFixed(1)} MB` : `${Math.round(mb)} MB`;
}
