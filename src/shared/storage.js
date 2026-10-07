// Namespaced localStorage helpers for the tools (best-effort — never throw if
// storage is unavailable), plus the run persistence that lets a generation
// survive the tab being closed.
//
// A prediction keeps running on Replicate after the tab is gone, but the UI
// polling that tracked it is lost. So the run in progress is written on every
// change: its items carry their Replicate ids (see src/shared/runs.js for the
// shape), which is enough for a fresh page load to fetch each one back and
// resume. Once a run has no item left in flight it moves to the history list,
// where it can be reopened and refreshed.
//
// `createToolStorage('batchVideoStudio')` namespaces every key under
// `karmalab.batchVideoStudio.` so tools never read each other's state — with one
// deliberate exception: the history of finished runs is a single list, shared
// by every tool (`karmalab.runHistory`), each run tagged with the tool that made
// it. The run in progress stays per tool.

import { HISTORY_TOOLS } from './historyTools.js';
import { normalizeRun } from './runs.js';

// How many finished runs to keep per tool. Runs hold prompts and result URLs,
// never image data (src/shared/runs.js whitelists what is persisted), so this
// is a few hundred KB at worst. Per tool rather than overall, so a busy tool
// can't push every other tool's history off the shared list.
export const HISTORY_LIMIT = 25;

export const HISTORY_KEY = 'karmalab.runHistory';

export function createToolStorage(namespace) {
  const prefix = `karmalab.${namespace}.`;
  const currentRunKey = `${prefix}currentRun`;
  // Pre-run-model persistence: a flat list of in-flight predictions. Read once
  // and migrated so a tab that was closed before this shipped still recovers.
  const legacyJobsKey = `${prefix}pendingJobs`;

  function loadKey(key) {
    try {
      return localStorage.getItem(prefix + key) || '';
    } catch {
      return '';
    }
  }

  function saveKey(key, value) {
    try {
      if (value) localStorage.setItem(prefix + key, value);
      else localStorage.removeItem(prefix + key);
    } catch {
      /* localStorage unavailable — ignore */
    }
  }

  function readJson(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function writeJson(key, value) {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      // Unavailable, or over quota — the caller decides whether to retry with
      // less data.
      return false;
    }
  }

  // Fold the per-tool lists this browser may still hold into the shared one, then
  // delete them. Every tool's old list is picked up by whichever tool is opened
  // first, so the shared list is whole from the first visit.
  function migrateLegacyHistory() {
    const namespaces = new Set([...Object.keys(HISTORY_TOOLS), namespace]);
    const migrated = [];
    namespaces.forEach((ns) => {
      const key = `karmalab.${ns}.runHistory`;
      const raw = readJson(key);
      if (raw === null && !hasKey(key)) return;
      if (Array.isArray(raw)) {
        raw.map(normalizeRun).forEach((r) => r && migrated.push({ ...r, tool: ns }));
      }
      writeJson(key, null);
    });
    if (!migrated.length) return;
    const existing = readHistory();
    const merged = [...existing, ...migrated.filter((m) => !existing.some((e) => sameRun(e, m)))];
    const stamp = (r) => r.finishedAt || r.createdAt || 0;
    saveHistory(merged.sort((a, b) => stamp(b) - stamp(a)));
  }

  function hasKey(key) {
    try {
      return localStorage.getItem(key) !== null;
    } catch {
      return false;
    }
  }

  const sameRun = (a, b) => a.id === b.id && a.tool === b.tool;
  const mine = (r) => r.tool === namespace;

  // A run read from the shared list always has a tool; one handed in without it
  // belongs to this tool.
  const tagged = (r) => ({ ...r, tool: r.tool || namespace });

  function readHistory() {
    const raw = readJson(HISTORY_KEY);
    if (!Array.isArray(raw)) return [];
    return raw
      .map(normalizeRun)
      .filter(Boolean)
      .map((r) => (r.tool ? r : { ...r, tool: namespace }));
  }

  // Every tool's finished runs, newest first.
  function loadHistory() {
    migrateLegacyHistory();
    return readHistory();
  }

  // Newest first. Each tool keeps its newest HISTORY_LIMIT runs. Over quota,
  // drop the oldest half and try again rather than silently losing the newest.
  function saveHistory(runs) {
    const seen = {};
    const capped = runs.map(tagged).filter((r) => {
      seen[r.tool] = (seen[r.tool] || 0) + 1;
      return seen[r.tool] <= HISTORY_LIMIT;
    });
    if (writeJson(HISTORY_KEY, capped)) return;
    if (capped.length > 1) writeJson(HISTORY_KEY, capped.slice(0, Math.ceil(capped.length / 2)));
  }

  function loadCurrentRun() {
    const run = normalizeRun(readJson(currentRunKey));
    return run || migrateLegacyJobs();
  }

  function saveCurrentRun(run) {
    writeJson(currentRunKey, run);
  }

  function clearCurrentRun() {
    writeJson(currentRunKey, null);
  }

  // Move a finished run into the history list (replacing any earlier copy of
  // the same run) and stop tracking it as the current one.
  function archiveRun(run) {
    const normalized = normalizeRun(run);
    if (normalized) {
      const entry = { ...normalized, tool: namespace };
      saveHistory([entry, ...loadHistory().filter((r) => !sameRun(r, entry))]);
    }
    clearCurrentRun();
  }

  // Drop a run from the history list. Used when a run loses its last item and
  // so has nothing left to show.
  function removeHistoryRun(id) {
    const history = loadHistory();
    const remaining = history.filter((r) => !(mine(r) && r.id === id));
    if (remaining.length !== history.length) saveHistory(remaining);
  }

  // Write back a run that is already in history — its statuses were refreshed.
  function updateHistoryRun(run) {
    const normalized = normalizeRun(run);
    if (!normalized) return;
    const history = loadHistory();
    const isIt = (r) => mine(r) && r.id === normalized.id;
    if (!history.some(isIt)) return;
    saveHistory(history.map((r) => (isIt(r) ? { ...normalized, tool: namespace } : r)));
  }

  // Clears the list for every tool — it is one list.
  function clearHistory() {
    writeJson(HISTORY_KEY, null);
  }

  function migrateLegacyJobs() {
    const jobs = readJson(legacyJobsKey);
    try {
      localStorage.removeItem(legacyJobsKey);
    } catch {
      /* localStorage unavailable — ignore */
    }
    if (!Array.isArray(jobs) || !jobs.length) return null;
    return normalizeRun({
      id: `run-legacy-${namespace}`,
      title: 'Recovered generation',
      createdAt: Date.now(),
      items: jobs
        .filter((j) => j && j.predictionId)
        .map((j, i) => ({
          id: j.predictionId,
          predictionId: j.predictionId,
          status: 'running',
          prompt: j.prompt || '',
          label: j.label || '',
          basename: j.basename || '',
          index: i,
        })),
    });
  }

  return {
    // The tool this storage belongs to. The output cache keys by it too, so a
    // run's cached files can be found without a second name for the same tool.
    namespace,
    loadKey,
    saveKey,
    loadCurrentRun,
    saveCurrentRun,
    clearCurrentRun,
    archiveRun,
    loadHistory,
    saveHistory,
    removeHistoryRun,
    updateHistoryRun,
    clearHistory,
  };
}
