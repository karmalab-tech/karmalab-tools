// Vitest runs the logic that is worth pinning down: the proxy's request policy
// and the pure-ish browser helpers. None of it needs a DOM, so the node
// environment is enough — the browser globals those modules touch
// (`localStorage`, `fetch`) are stubbed per test.
//
// Deliberately not covered: `src/apps/video/frames.js`, which drives a real
// <video> element and canvas. It needs a browser that actually decodes video,
// so a jsdom test would assert nothing useful — it wants a Playwright test.
// See docs/ARCHITECTURE.md.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
  },
});
