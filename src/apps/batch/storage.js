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

// Pending-job persistence — the Replicate predictions still in flight.
//
// A prediction keeps running on Replicate even after the tab is closed, but the
// UI polling that tracks it is lost. We remember each in-flight prediction (its
// Replicate id + the prompt that produced it) so a fresh page load can fetch it
// back and resume its progress. Jobs are removed once they reach a terminal
// state (succeeded / failed / canceled).

const JOBS_KEY = 'pendingJobs';

export function loadJobs() {
  try {
    const raw = localStorage.getItem(PREFIX + JOBS_KEY);
    const jobs = raw ? JSON.parse(raw) : [];
    return Array.isArray(jobs) ? jobs : [];
  } catch {
    return [];
  }
}

function saveJobs(jobs) {
  try {
    if (jobs && jobs.length) localStorage.setItem(PREFIX + JOBS_KEY, JSON.stringify(jobs));
    else localStorage.removeItem(PREFIX + JOBS_KEY);
  } catch {
    /* localStorage unavailable — ignore */
  }
}

export function addJob(job) {
  const jobs = loadJobs().filter((j) => j.predictionId !== job.predictionId);
  jobs.push(job);
  saveJobs(jobs);
}

export function removeJob(predictionId) {
  saveJobs(loadJobs().filter((j) => j.predictionId !== predictionId));
}
