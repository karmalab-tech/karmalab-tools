// Chat Box Studio storage: the recording settings (remembered between visits),
// the recording in progress and the history of finished ones.
//
// The recordings themselves are not in here — only what src/shared/runs.js
// whitelists, which for this tool is the message, the resolution label and the
// blob URL the video had while the tab was open. The video file lives in the
// output cache (IndexedDB, src/shared/outputCache.js) under the run's key,
// which is what a recording opened from History plays and downloads: a blob URL
// dies with the page, the cached copy does not.

import { createToolStorage } from '../../shared/storage.js';

export const storage = createToolStorage('chatBoxStudio');
export const { loadKey, saveKey } = storage;
