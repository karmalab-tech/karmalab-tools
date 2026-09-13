// Which typing sound a recording uses, and where a clip of your own is kept.
//
// The studio opens on the built-in sequences (sequences.js). A clip of your own
// replaces them, and that one is a file chosen once and wanted under every
// recording after that — but it is megabytes of audio, which is exactly what
// must never go near localStorage. So it lives in the same IndexedDB store the
// results do (src/shared/outputCache.js), under a key of its own: `assets` sits
// where a run id normally does, so clearing the generation history (which drops
// the files of the runs in the list) leaves it alone.
//
// Its name is small enough to be an ordinary setting, and is kept beside the
// other ones in localStorage, as is the choice between the two and silence.

import { cacheOutput, cachedBlob, forgetRuns } from '../../shared/outputCache.js';

export const SOUND_KEY = 'chatBoxStudio/assets/typingSound';
const SOUND_RUN = 'chatBoxStudio/assets';

// 'builtin' | 'custom' | 'off' — what the Sound panel is set to.
export const SOUND_CHOICES = ['builtin', 'custom', 'off'];
export const normalizeChoice = (raw) => (SOUND_CHOICES.includes(raw) ? raw : 'builtin');

// Never throws: a browser with no IndexedDB simply forgets the clip when the
// tab closes, which is a smaller problem than a broken studio.
export async function saveSound(file) {
  const url = URL.createObjectURL(file);
  try {
    await cacheOutput(SOUND_KEY, url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const loadSound = () => cachedBlob(SOUND_KEY);

export const clearSound = () => forgetRuns([SOUND_RUN]);
