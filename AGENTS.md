# AGENTS.md — KarmaLab Tools

Orientation for coding agents. The full reasoning lives in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — read it before any non-trivial
change, and keep it updated when you change the shape of things. Contributor
workflow is in [CONTRIBUTING.md](CONTRIBUTING.md); don't duplicate either here.

## What this is

A multi-page web app: a collection of browser-based tools for generating images
and video with Replicate models, built with **React + Vite** and served by a small
Node server that also proxies the Replicate API.

- **Batch Image Studio** (`/`) — one image per text prompt, in batch. The
  flagship tool.
- **Continuous Video Studio** (`/video-chain`) — chains video clips; each clip
  starts from the last frame of the previous one, extracted in-browser via canvas.
- **Prompt Box** (`/prompt`) — a styled, non-functional mockup. Don't wire it up
  to anything without being asked.

## Rules that matter here

1. **Always fetch relative `/v1/...`, never `api.replicate.com` directly.**
   Replicate sends no CORS headers, so a direct browser call is always blocked.
   Both the Vite dev server and the Node server forward `/v1/...`.
2. **The proxy is allowlisted.** `server/proxy.js` forwards only
   `POST /v1/models/{owner}/{model}/predictions` and `GET /v1/predictions/{id}`.
   Calling any other Replicate endpoint from the browser means adding it to that
   allowlist — a security-relevant change, so justify it rather than doing it
   quietly.
3. **Never store an API key server-side, or log one.** Keys live in the
   browser's `localStorage` and are passed through per request. This is the whole
   trust model.
4. **Tailwind utilities only.** Tokens are in `@theme` in
   `src/shared/theme.css`; there are no co-located `.css` files. Pull long
   repeated class strings into a local const or a variant map.
5. **Adding a model is one entry** in `src/apps/batch/models.js` or
   `src/apps/video/models.js` — the UI rebuilds itself from it. Don't special-case
   a model in component code.
6. **Adding a tool is three edits**: an HTML entry at the root, an input in
   `vite.config.js`, an entry in `server/routes.js`. `server/routes.js` is the
   source of truth for which tools exist.

## Where things are

`src/entries/` mounts each tool · `src/apps/` the tools, with per-tool logic in
`src/apps/batch/` and `src/apps/video/` · `src/shared/` the shared component
library and helpers · `server/` the Node server, its proxy policy and route table
· `test/` Vitest suites · `docs/` architecture notes and screenshots.

## Before you claim you're done

```bash
yarn lint && yarn format:check && yarn test && yarn build
```

That is exactly what CI runs. Note that `src/apps/video/frames.js` has **no**
automated coverage — jsdom can't decode video — so changes there need manual
verification in a real browser, and you should say so rather than implying tests
cover it.
