// Single source of truth for the tools exposed by KarmaLab Tools.
//
// Each tool maps a clean browser route to a built HTML entry in `dist/`
// (produced by `vite build`). The server (server/index.js) uses this table to
// resolve routes; the same list can feed a future shared tool index.
//
// To add a tool: add a Vite HTML entry (see vite.config.js) and one entry here.

export const routes = [
  {
    path: '/',
    file: 'index.html',
    title: 'Batch Image Studio',
    description: 'Generate one image per prompt in batch via Replicate.',
  },
  {
    path: '/prompt',
    file: 'prompt.html',
    title: 'Prompt Box',
    description: 'Hi Karma prompt box mockup.',
  },
];

