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

// The step whose image another one starts from: the newest step that produced
// an image, before `beforeIndex` (the end of the chain by default). A failed
// step is skipped, so a chain that stopped on an error carries on from the last
// good image instead of not at all — and retrying a failed step hands it the
// same image it was given the first time.
export function chainSource(items, beforeIndex = Infinity) {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if ((item.index ?? i) >= beforeIndex) continue;
    if (item.status === 'succeeded' && item.outputUrl) return item;
  }
  return null;
}

// How a step names the step it continued from. Recorded on the step when it is
// created (`from`) rather than derived later, so a retry elsewhere in the chain
// can't rewrite what an earlier card says it used. Empty starts a chain.
export const sourceLabel = (item) => (item ? item.label || stepLabel(item.index ?? 0) : '');

// The number the next step gets. A failed step still took its place in the
// chain, so every item counts — including one recovered from storage, which
// carries the index it had.
export function nextStepIndex(items) {
  return items.reduce((next, item) => Math.max(next, (item.index ?? 0) + 1), 0);
}

export const chainTitle = (modelLabel) => `Chain · ${modelLabel}`;
