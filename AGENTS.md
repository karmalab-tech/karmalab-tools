# AGENTS.md — KarmaLab Tools

Orientation for coding agents, and the architecture notes for anyone else.
Contributor workflow is in [CONTRIBUTING.md](CONTRIBUTING.md).

## What this is

A multi-page web app: browser-based tools for generating images and video with
Replicate models, built with **React + Vite** and served by a small Node server
that also proxies the Replicate API.

- **Batch Image Studio** (`/`) — one image per text prompt, in batch. The
  flagship tool.
- **Batch Video Studio** (`/batch-videos`) — a batch of videos: one per prompt
  line, or one per uploaded start frame. Both modes flatten to one list of run
  items in `src/apps/batchVideo/items.js`.
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
5. **Adding a model is one entry** in `src/apps/batch/models.js` (images) or
   `src/shared/videoModels.js` (video — shared by both video tools, so an entry
   there appears in each). The UI rebuilds itself from it; don't special-case a
   model in component code.
6. **Adding a tool is three edits**: an HTML entry at the root, an input in
   `vite.config.js`, an entry in `server/routes.js`, which is the source of truth
   for which tools exist.

## Routing lives on the backend

Each tool is a separate Vite HTML entry with its own JS bundle; there is no
client-side router. The tools are genuinely independent — no shared shell, no
cross-tool state — so this keeps each bundle small (the heavy Batch Studio
JavaScript never loads on the Prompt Box) and lets the server own routing.
`vite build` emits `dist/`; `server/routes.js` maps clean routes to the built
HTML.

## Layout

- `index.html` / `batch-videos.html` / `video-chain.html` / `prompt.html` —
  Vite HTML entries, each loading a script from `src/entries/`.
- `src/apps/` — the tools. Per-tool logic in `src/apps/batch/` (`models.js`,
  `replicate.js`, `storage.js`), `src/apps/batchVideo/` (`items.js`,
  `storage.js`) and `src/apps/video/` (`frames.js` — end-frame extraction via
  off-screen `<video>` + canvas).
- `src/shared/` — what the tools are built from: `theme.css` (the Tailwind
  entry — `@theme` tokens, base styles, keyframes), `components/` (import from
  `src/shared/components`, which also pulls in `theme.css`), `replicate.js`
  (prediction create / poll / output helpers, the longer polling profile video
  needs, and `friendlyErrorMessage()`), `videoModels.js` (video model catalogue
  and input assembly, shared by both video tools), `storage.js`
  (`createToolStorage(namespace)` — namespaced `localStorage` plus
  pending-prediction persistence, one prefix per tool), `apiKey.js`, `fields.js`,
  `useUnloadGuard.js`.
- `server/` — `index.js` (serves `dist/`, proxies Replicate), `proxy.js` (the
  proxy's request policy), `routes.js` (the route table).
- `test/` Vitest suites · `docs/` a README screenshot · `Dockerfile` + `fly.toml`
  fly.io deployment.

Anything two tools need goes in `src/shared/`, namespaced per tool where it
touches storage — never reached for across `src/apps/`.

## What the proxy allows, and why

`api.replicate.com` sends no CORS headers, so the proxy is what makes any call
work. The Replicate token is passed through from the browser and never stored
server-side — that is what makes the app usable without accounts, and also its
main limitation: a deployed instance is reachable by anyone, so `server/proxy.js`
bounds it.

1. **Request allowlist** — only the two calls above; everything else gets a 403.
2. **Header allowlist** — only `authorization`, `content-type`, `accept` go
   upstream. An allowlist rather than a denylist means `cookie` is dropped by
   construction rather than by remembering to delete it. `Set-Cookie` is stripped
   from responses.
3. **Body cap and rate limit** — bodies are capped (reference images are base64
   and are not downscaled in the browser, so the cap has to be generous), and
   requests are counted per client in a fixed window, keyed off `fly-client-ip`
   or the socket address, never a client-supplied `X-Forwarded-For`, which anyone
   could rotate to reset their bucket. The limiter is in-process, so it bounds
   one machine; a multi-machine deployment should rate limit at the edge.

The stronger design is to hold a token server-side and authenticate your own
users, at which point the proxy stops being an anonymous relay. That is a
different product — accounts, billing, quotas — which is why this repo hasn't
gone there.

## Testing

`yarn test` runs Vitest in the `node` environment, stubbing the browser globals
the modules touch (`localStorage`, `fetch`). Covered: the proxy's request policy,
the prediction polling loop, per-model input assembly for images and video,
namespaced storage and pending-job recovery, and the Batch Video run-item
flattening including its download filename stems.

`src/apps/video/frames.js` has **no** automated coverage — jsdom can't decode
video, so a test there would assert nothing meaningful; it wants a Playwright
test. It's the subtlest code in the repo, so changes need manual verification in
a real browser, and say so rather than implying tests cover it.

One ESLint choice worth knowing: `eslint.config.js` enables
`react-hooks/rules-of-hooks` and `exhaustive-deps` by name rather than spreading
the plugin's `recommended` preset, which now also carries the React Compiler
rules. This codebase hydrates state from `localStorage` inside mount effects,
which `set-state-in-effect` flags but which is what effects are for. Revisit if
the compiler is adopted.

## Before you claim you're done

```bash
yarn lint && yarn format:check && yarn test && yarn build
```

That is exactly what CI runs.
