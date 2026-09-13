// Image Chain Studio storage: saved extra-field values, the chain in progress
// (recovered on reload) and the history of finished chains. Only what
// src/shared/runs.js whitelists is written — which for this tool is enough to
// continue a chain, since each step's reference image is the previous step's
// `outputUrl`. An uploaded first reference image is not persisted (image data
// URIs are far too big for the localStorage quota), so a recovered chain
// continues from its last generated image rather than from that upload.

import { createToolStorage } from '../../shared/storage.js';

export const storage = createToolStorage('imageChainStudio');
export const { loadKey, saveKey } = storage;
