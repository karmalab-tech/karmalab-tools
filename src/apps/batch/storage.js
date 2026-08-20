// Batch Image Studio storage: saved extra-field values, the run in progress and
// the history of finished runs. The implementation is the shared, namespaced
// localStorage helper — this module just fixes the namespace.

import { createToolStorage } from '../../shared/storage.js';

export const storage = createToolStorage('batchImageStudio');
export const { loadKey, saveKey } = storage;
