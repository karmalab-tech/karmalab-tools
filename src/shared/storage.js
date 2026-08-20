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
// `karmalab.batchVideoStudio.` so tools never read each other's state.

import { normalizeRun } from './runs.js';

// How many finished runs to keep per tool. Runs hold prompts and result URLs,
// never image data (src/shared/runs.js whitelists what is persisted), so this
// is a few hundred KB at worst.
export const HISTORY_LIMIT = 25;

export function createToolStorage(namespace) {
  const prefix = `karmalab.${namespace}.`;
  const currentRunKey = `${prefix}currentRun`;
  const historyKey = `${prefix}runHistory`;
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

  function loadHistory() {
    const raw = readJson(historyKey);
    if (!Array.isArray(raw)) return [];
    return raw.map(normalizeRun).filter(Boolean);
  }

  // Newest first. Over quota, drop the oldest half and try again rather than
  // silently losing the newest run.
  function saveHistory(runs) {
    const capped = runs.slice(0, HISTORY_LIMIT);
    if (writeJson(historyKey, capped)) return;
    if (capped.length > 1) writeJson(historyKey, capped.slice(0, Math.ceil(capped.length / 2)));
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
    if (normalized) saveHistory([normalized, ...loadHistory().filter((r) => r.id !== run.id)]);
    clearCurrentRun();
  }

  // Write back a run that is already in history — its statuses were refreshed.
  function updateHistoryRun(run) {
    const normalized = normalizeRun(run);
    if (!normalized) return;
    const history = loadHistory();
    if (!history.some((r) => r.id === normalized.id)) return;
    saveHistory(history.map((r) => (r.id === normalized.id ? normalized : r)));
  }

  function clearHistory() {
    writeJson(historyKey, null);
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
    loadKey,
    saveKey,
    loadCurrentRun,
    saveCurrentRun,
    clearCurrentRun,
    archiveRun,
    loadHistory,
    saveHistory,
    updateHistoryRun,
    clearHistory,
  };
}
