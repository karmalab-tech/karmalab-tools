// Batch Video Studio storage: the pending Replicate jobs to recover on reload.
// Start frames are deliberately not persisted — image data URIs are far too
// big for localStorage's quota, so a recovered card simply has no thumbnail.

import { createToolStorage } from '../../shared/storage.js';

export const { loadJobs, addJob, removeJob } = createToolStorage('batchVideoStudio');
