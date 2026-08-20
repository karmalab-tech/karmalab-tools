// Batch Video Studio storage: the run in progress (recovered on reload) and the
// history of finished runs. Start frames are deliberately not persisted — image
// data URIs are far too big for localStorage's quota, so a recovered card
// simply has no thumbnail.

import { createToolStorage } from '../../shared/storage.js';

export const storage = createToolStorage('batchVideoStudio');
