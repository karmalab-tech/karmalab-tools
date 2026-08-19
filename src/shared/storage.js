// Namespaced localStorage helpers for the tools (best-effort — never throw if
// storage is unavailable), plus the pending-job persistence the batch tools
// use to recover in-flight Replicate predictions.
//
// A prediction keeps running on Replicate even after the tab is closed, but the
// UI polling that tracks it is lost. Each in-flight prediction is remembered
// (its Replicate id plus whatever the tool needs to rebuild its card) so a
// fresh page load can fetch it back and resume its progress. Jobs are removed
// once they reach a terminal state (succeeded / failed / canceled).
//
// `createToolStorage('batchVideoStudio')` namespaces every key under
// `karmalab.batchVideoStudio.` so tools never read each other's state.

export function createToolStorage(namespace) {
  const prefix = `karmalab.${namespace}.`;
  const jobsKey = `${prefix}pendingJobs`;

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

  function loadJobs() {
    try {
      const raw = localStorage.getItem(jobsKey);
      const jobs = raw ? JSON.parse(raw) : [];
      return Array.isArray(jobs) ? jobs : [];
    } catch {
      return [];
    }
  }

  function saveJobs(jobs) {
    try {
      if (jobs && jobs.length) localStorage.setItem(jobsKey, JSON.stringify(jobs));
      else localStorage.removeItem(jobsKey);
    } catch {
      /* localStorage unavailable (or quota exceeded) — ignore */
    }
  }

  function addJob(job) {
    const jobs = loadJobs().filter((j) => j.predictionId !== job.predictionId);
    jobs.push(job);
    saveJobs(jobs);
  }

  function removeJob(predictionId) {
    saveJobs(loadJobs().filter((j) => j.predictionId !== predictionId));
  }

  return { loadKey, saveKey, loadJobs, addJob, removeJob };
}
