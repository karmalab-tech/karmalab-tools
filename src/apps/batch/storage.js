// Batch Image Studio storage: saved extra-field values + the pending Replicate
// jobs to recover on reload. The implementation is the shared, namespaced
// localStorage helper — this module just fixes the namespace.

import { createToolStorage } from '../../shared/storage.js';

export const { loadKey, saveKey, loadJobs, addJob, removeJob } =
  createToolStorage('batchImageStudio');
