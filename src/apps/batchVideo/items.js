// The two batch shapes of the Batch Video Studio.
//
// Both modes end up as the same flat list of run items — one Replicate
// prediction each — so the runner, the result cards and the zip don't need to
// know which mode produced them:
//
//   { prompt, startFrame, label, basename }
//
//   prompt     — the text prompt sent to the model
//   startFrame — a start-frame data URI, or null for text-to-video
//   label      — the short heading on the result card
//   basename   — the download filename stem (no extension)

export const MODES = [
  {
    value: 'prompts',
    title: 'Multiple prompts',
    desc: 'One video per prompt line, generated in parallel — with an optional shared start frame.',
  },
  {
    value: 'frames',
    title: 'One prompt, multiple start frames',
    desc: 'One video per uploaded image, all animated from the same prompt.',
  },
];

export const splitPrompts = (text) =>
  text
    .split('\n')
    .map((p) => p.trim())
    .filter(Boolean);

const pad = (n) => String(n).padStart(2, '0');

// Filename-safe stem from an uploaded image's name ('Shot 3.final.PNG' → 'shot-3-final').
const slug = (name) =>
  name
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

export function buildItems({ mode, promptsText, sharedFrame, prompt, frames }) {
  if (mode === 'prompts') {
    return splitPrompts(promptsText).map((text, i) => ({
      prompt: text,
      startFrame: sharedFrame?.dataUri || null,
      label: `Video ${i + 1}`,
      basename: `video-${pad(i + 1)}`,
    }));
  }

  const shared = prompt.trim();
  return frames.map((frame, i) => {
    const stem = slug(frame.name);
    return {
      prompt: shared,
      startFrame: frame.dataUri,
      label: frame.name,
      basename: `video-${pad(i + 1)}${stem ? `-${stem}` : ''}`,
    };
  });
}
