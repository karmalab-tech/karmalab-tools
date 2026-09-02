// The Image Chain Studio's step model.
//
// A chain is one run: every step is a Replicate prediction whose reference
// image is the previous step's output, so a step is just the shared run item
// shape (src/shared/runs.js) plus its `index`. Nothing extra needs persisting —
// what links two steps is the earlier one's `outputUrl`, already in the
// whitelist — so unlike the video chain, a chain recovered on reload or
// reopened from history can still be continued.

// Enough to keep one click from queueing a runaway (and a runaway bill); the
// chain can always be continued for another batch of steps.
export const MAX_STEPS = 25;

const pad = (n) => String(n).padStart(2, '0');

export const stepLabel = (index) => `Step ${index + 1}`;

export const stepBasename = (index) => `image-${pad(index + 1)}`;

// A step's index is unique within its chain (a continued chain carries on
// counting, a failed step still takes its place), so it also makes the stable
// UI key — one that a step recovered from storage keeps.
export const stepId = (index) => `step-${index + 1}`;

export const imageName = (item) => `${item.basename || stepBasename(item.index ?? 0)}.png`;

// The step count is free text in the UI — "0", "2.5" and "abc" are not chains.
// Returns the number of steps to run, or null if it isn't one.
export function parseStepCount(raw) {
  const n = Number.parseInt(String(raw ?? '').trim(), 10);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.min(n, MAX_STEPS);
}

// Where a continued chain picks up: the newest step that produced an image.
// A failed tail is skipped, so a chain that stopped on an error carries on from
// the last good image instead of not at all.
export function chainSource(items) {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.status === 'succeeded' && item.outputUrl) return item;
  }
  return null;
}

// The label of the step each step continued from, in the same order — what a
// card shows under its heading. Null for a step with no image before it.
export function sourceLabels(items) {
  let previous = null;
  return items.map((item) => {
    const label = previous;
    if (item.status === 'succeeded' && item.outputUrl)
      previous = item.label || stepLabel(item.index ?? 0);
    return label;
  });
}

// The number the next step gets. A failed step still took its place in the
// chain, so every item counts — including one recovered from storage, which
// carries the index it had.
export function nextStepIndex(items) {
  return items.reduce((next, item) => Math.max(next, (item.index ?? 0) + 1), 0);
}

export const chainTitle = (modelLabel) => `Chain · ${modelLabel}`;
