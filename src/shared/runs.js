// The "run" model shared by the generation tools.
//
// A run is one generation the user kicked off — a batch of images, a batch of
// videos, a chain of clips, a chain of images — together with the items it
// produced. Runs are the
// unit that survives a closed tab: the run in progress is written to
// localStorage on every change (src/shared/storage.js), so a fresh page load
// can pick it back up, refresh each item's status from Replicate and carry on
// polling. Finished runs are kept as history so they can be reopened later.
//
// Every tool normalises its cards to the same item shape, which is what makes
// the persistence, the recovery, the history modal and the tab title one
// implementation instead of one per tool:
//
//   { id, predictionId, status, prompt, label, basename, outputUrl, error, index, from }
//
//   id           — stable UI key (the prediction id for a restored item)
//   predictionId — the Replicate prediction, null until it has been created
//   status       — queued | running | succeeded | failed
//   prompt       — the prompt sent to the model
//   label        — optional heading on the card
//   basename     — optional download filename stem (no extension)
//   outputUrl    — the model's output URL once it succeeded
//   error        — failure message, if any
//   index        — optional position in the run (a chain's clip or step number)
//   from         — optional label of the item this one was generated from (the
//                  image chain's previous step)
//
// Anything else a tool hangs off an item (start frames, object URLs, extracted
// end frames) stays in memory only: PERSISTED_ITEM_KEYS is a whitelist, so
// image data URIs can never blow the localStorage quota by accident.

export const PERSISTED_ITEM_KEYS = [
  'id',
  'predictionId',
  'status',
  'prompt',
  'label',
  'basename',
  'outputUrl',
  'error',
  'index',
  'from',
];

export const isTerminalStatus = (status) => status === 'succeeded' || status === 'failed';

export const isActiveItem = (item) => !isTerminalStatus(item.status);

// Replicate status → the UI's status vocabulary (queued / running / …).
export const uiStatus = (status) =>
  status === 'processing' ? 'running' : status === 'starting' ? 'queued' : status;

export const newRunId = () =>
  `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function serializeItem(item) {
  const out = {};
  PERSISTED_ITEM_KEYS.forEach((key) => {
    if (item[key] !== undefined) out[key] = item[key];
  });
  return out;
}

// A run as it goes to storage: its metadata plus the persistable part of each
// item. `origin` is UI-only state (whether the run is live or being viewed out
// of history) and is deliberately not written.
export function serializeRun(run, items) {
  return {
    id: run.id,
    title: run.title || 'Generation',
    createdAt: run.createdAt || Date.now(),
    finishedAt: run.finishedAt || null,
    items: items.map(serializeItem),
  };
}

// Storage is user-editable and survives deploys — treat anything read back as
// untrusted and drop what doesn't fit the shape.
export function normalizeRun(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.items)) return null;
  const items = raw.items
    .filter((it) => it && typeof it === 'object' && it.id)
    .map((it) => ({ ...serializeItem(it), status: it.status || 'queued' }));
  if (!items.length) return null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newRunId(),
    title: typeof raw.title === 'string' && raw.title ? raw.title : 'Generation',
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
    finishedAt: Number.isFinite(raw.finishedAt) ? raw.finishedAt : null,
    items,
  };
}

export function runCounts(items) {
  const total = items.length;
  const succeeded = items.filter((i) => i.status === 'succeeded').length;
  const failed = items.filter((i) => i.status === 'failed').length;
  return { total, succeeded, failed, done: succeeded + failed, active: total - succeeded - failed };
}

// The status pill a whole run gets in the history list.
export function runStatus(items) {
  const { total, succeeded, failed, active } = runCounts(items);
  if (active > 0) return 'running';
  if (!total) return 'queued';
  if (succeeded === total) return 'succeeded';
  if (failed === total) return 'failed';
  return 'partial';
}

export function runSummary(items) {
  const { total, succeeded, failed, active } = runCounts(items);
  const parts = [`${succeeded}/${total} done`];
  if (failed) parts.push(`${failed} failed`);
  if (active) parts.push(`${active} still generating`);
  return parts.join(' · ');
}

// What the browser tab says. While a run is going the count is the point of it
// — the user is on another tab waiting — and `showDone` keeps a marker up once
// it lands, so a finished run is visible without switching back first.
export function runTabTitle(baseTitle, counts, showDone) {
  const { total, done, succeeded, failed, active } = counts;
  if (active > 0) return `⏳ ${done}/${total} · ${baseTitle}`;
  if (showDone && total) {
    return `${failed ? '⚠️' : '✅'} ${succeeded}/${total} · ${baseTitle}`;
  }
  return baseTitle;
}

// Compact, locale-independent stamp for the history list ("20 Aug, 14:32").
export function formatRunTime(timestamp) {
  if (!Number.isFinite(timestamp)) return '';
  const d = new Date(timestamp);
  const day = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${day}, ${time}`;
}
