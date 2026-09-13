// The typing sounds that ship with the studio.
//
// `typing/` holds one short mp3 per burst of typing, cut out of one recording
// of a real keyboard: each starts on its own first keystroke and ends just
// after its last, which is what lets the recorder drop one under a run of
// characters with no lead-in to wait through and no tail to ring on. One is
// picked at random per run (src/apps/chatBox/audio.js), so no two recordings of
// the same message sound the same.
//
// They are found by globbing the folder rather than listed here, so another
// sequence is a file dropped in `typing/` and nothing else. Vite turns each
// into a URL at build time and the audio is fetched only when the studio first
// needs a sound — never as part of the bundle.

import { decodeClip } from './audio.js';

const FILES = import.meta.glob('./typing/*.mp3', {
  eager: true,
  query: '?url',
  import: 'default',
});

// Sorted by filename, so the set is in a stable order whatever the glob does.
export const SEQUENCE_URLS = Object.entries(FILES)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([path, url]) => ({ name: path.split('/').pop(), url }));

export const SEQUENCE_COUNT = SEQUENCE_URLS.length;

// Fetch and decode the lot, ready to be laid under a recording. A file that
// will not fetch or decode is left out rather than failing the studio.
export async function loadSequences(sampleRate) {
  const clips = await Promise.all(
    SEQUENCE_URLS.map(async ({ name, url }) => {
      try {
        const resp = await fetch(url);
        if (!resp.ok) return null;
        return await decodeClip(await resp.arrayBuffer(), sampleRate, name);
      } catch {
        return null;
      }
    })
  );
  return clips.filter(Boolean);
}
