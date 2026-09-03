// The tools the navigation offers, in the order they are shown.
//
// `server/routes.js` stays the source of truth for which tools *exist* — this
// is what the UI puts in front of someone, which is not quite the same list:
// the Prompt Box is a styling mockup and is deliberately left out. A test keeps
// the two honest, so a tool renamed or moved in the route table can't leave a
// dead link here.
//
// `blurb` is the line under each name in the tools sidebar. One short sentence:
// what the tool does, not how.

export const TOOLS = [
  {
    path: '/',
    label: 'Batch Images',
    blurb: 'One image per prompt, generated in batch.',
  },
  {
    path: '/image-chain',
    label: 'Image Chain',
    blurb: 'Each image generated from the one before it.',
  },
  {
    path: '/batch-videos',
    label: 'Batch Videos',
    blurb: 'A batch of videos, per prompt or per start frame.',
  },
  {
    path: '/video-chain',
    label: 'Video Chain',
    blurb: 'Clips chained into one continuous shot.',
  },
];

export const toolLabel = (path) => TOOLS.find((t) => t.path === path)?.label || '';
