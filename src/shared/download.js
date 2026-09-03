// Browser download helpers shared by the tools: one result at a time, or the
// whole run as a zip.
//
// Replicate's result URLs (replicate.delivery) send CORS headers, so a result
// can be fetched as a blob and saved under a chosen filename. A plain `download`
// link would not: cross-origin, the attribute is ignored and the browser
// navigates instead — hence the fetch, with that navigation as the fallback.
//
// Every entry can also carry a `key` into the output cache
// (src/shared/outputCache.js). That is read first, because Replicate deletes an
// output an hour after it ran: for anything older, the cached copy is the only
// copy left.

import { cachedBlob } from './outputCache.js';

export function triggerDownload(href, filename) {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function downloadUrl(url, filename, key) {
  const cached = key ? await cachedBlob(key) : null;
  if (cached) return saveBlob(cached, filename);
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    saveBlob(await resp.blob(), filename);
  } catch {
    window.open(url, '_blank');
  }
}

function saveBlob(blob, filename) {
  const objUrl = URL.createObjectURL(blob);
  triggerDownload(objUrl, filename);
  URL.revokeObjectURL(objUrl);
}

// Zip a run's outputs. Each entry is { name } plus one of `blob` (already in
// memory), `base64` (a data URI's payload, for frames) or `url` — with an
// optional `key` into the output cache, which is tried before the URL.
//
// One that cannot be found anywhere is left out rather than failing the whole
// zip, but it is not left silent either: the names come back so the caller can
// say what is missing. A zip that is quietly three images short is worse than
// one that says so.
export async function downloadZip(zipName, entries) {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const missing = [];
  await Promise.all(
    entries.map(async (entry) => {
      try {
        const cached = entry.key ? await cachedBlob(entry.key) : null;
        if (cached) zip.file(entry.name, cached);
        else if (entry.blob) zip.file(entry.name, entry.blob);
        else if (entry.base64) zip.file(entry.name, entry.base64, { base64: true });
        else if (entry.url) {
          const resp = await fetch(entry.url);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          zip.file(entry.name, await resp.blob());
        } else throw new Error('nothing to fetch');
      } catch {
        missing.push(entry.name);
      }
    })
  );
  const blob = await zip.generateAsync({ type: 'blob' });
  saveBlob(blob, zipName);
  return { missing };
}
