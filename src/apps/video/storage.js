// Continuous Video Studio storage: the chain in progress (recovered on reload)
// and the history of finished chains. Only what src/shared/runs.js whitelists is
// written, so the extracted start/end frames stay in memory — a recovered clip
// plays from its Replicate URL but has no frame thumbnails, and the chain cannot
// be continued from it.

import { createToolStorage } from '../../shared/storage.js';

export const storage = createToolStorage('continuousVideoStudio');
