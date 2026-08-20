// Browser download helpers shared by the tools: one result at a time, or the
// whole run as a zip.
//
// Replicate's result URLs (replicate.delivery) send CORS headers, so a result
// can be fetched as a blob and saved under a chosen filename. A plain `download`
// link would not: cross-origin, the attribute is ignored and the browser
// navigates instead — hence the fetch, with that navigation as the fallback.

export function triggerDownload(href, filename) {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function downloadUrl(url, filename) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const objUrl = URL.createObjectURL(await resp.blob());
    triggerDownload(objUrl, filename);
    URL.revokeObjectURL(objUrl);
  } catch {
    window.open(url, '_blank');
  }
}

// Zip a run's outputs. Each entry is { name } plus one of `url` (fetched here),
// `blob` (already in memory) or `base64` (a data URI's payload, for frames).
// Entries that cannot be fetched are skipped rather than failing the whole zip.
export async function downloadZip(zipName, entries) {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  await Promise.all(
    entries.map(async (entry) => {
      try {
        if (entry.blob) zip.file(entry.name, entry.blob);
        else if (entry.base64) zip.file(entry.name, entry.base64, { base64: true });
        else if (entry.url) zip.file(entry.name, await (await fetch(entry.url)).blob());
      } catch {
        /* skip whatever could not be fetched */
      }
    })
  );
  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, zipName);
  URL.revokeObjectURL(url);
}
