# AGENTS.md — KarmaLab Tools

Orientation for coding agents, and the architecture notes for anyone else.
Contributor workflow is in [CONTRIBUTING.md](CONTRIBUTING.md).

## What this is

A multi-page web app: browser-based tools for generating images and video with
Replicate models, built with **React + Vite** and served by a small Node server
that also proxies the Replicate API.

- **Batch Image Studio** (`/`) — one image per text prompt, in batch. The
  flagship tool.
- **Image Chain Studio** (`/image-chain`) — chains images: each step is
  generated from the previous step's image as its reference. Run it again and it
  adds more steps to the same chain, continuing from its last image.
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
5. **Adding a model is one entry** in `src/shared/imageModels.js` (images) or
   `src/shared/videoModels.js` (video). Both catalogues are shared by two tools,
   so an entry appears in each — an image model without an `imageField` is left
   out of the Image Chain Studio, which has nothing to chain through. The UI
   rebuilds itself from the entry; don't special-case a model in component code.
6. **A generation is a "run", and runs are shared machinery.** Every tool
   normalises its cards to one item shape and drives them through
   `useGenerationRun` (`src/shared/useGenerationRun.js`), which owns the item
   list, its persistence, recovering an unfinished run on load, the history of
   finished runs, the browser tab title and the close-the-tab warning. A tool
   supplies its inputs, its runner loop and its card component — nothing else.
   (`continueRun()` is the one exception to a run being over when it is
   archived: it takes the finished run back off the shelf, under the same id, so
   the Image Chain Studio can append more steps to it.)
   Persisting more per item means adding the key to `PERSISTED_ITEM_KEYS` in
   `src/shared/runs.js`; that whitelist is what keeps image data URIs out of
   `localStorage`, so never widen it to a data URI.
7. **Adding a tool is three edits**: an HTML entry at the root, an input in
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

- `index.html` / `image-chain.html` / `batch-videos.html` / `video-chain.html` /
  `prompt.html` — Vite HTML entries, each loading a script from `src/entries/`.
- `src/apps/` — the tools. Per-tool logic in `src/apps/batch/` (`storage.js`),
  `src/apps/imageChain/` (`chain.js` — the step model, `storage.js`),
  `src/apps/batchVideo/` (`items.js`, `storage.js`) and `src/apps/video/`
  (`frames.js` — end-frame extraction via off-screen `<video>` + canvas).
- `src/shared/` — what the tools are built from: `theme.css` (the Tailwind
  entry — `@theme` tokens, base styles, keyframes), `components/` (import from
  `src/shared/components`, which also pulls in `theme.css`), `replicate.js`
  (prediction create / poll / output helpers, the longer polling profile video
  needs, and `friendlyErrorMessage()`), `imageModels.js` and `videoModels.js`
  (the model catalogues and their input assembly, one per medium and each shared
  by two tools), `storage.js`
  (`createToolStorage(namespace)` — namespaced `localStorage` plus the
  current-run / run-history persistence, one prefix per tool), `apiKey.js`, `fields.js`,
  `useUnloadGuard.js`, plus the run machinery: `runs.js` (the run/item model —
  what is persisted, a run's progress, the tab title), `useGenerationRun.js`
  (the hook every generation tool shares) and `download.js` (single-file and zip
  downloads).
- `server/` — `index.js` (serves `dist/`, proxies Replicate), `proxy.js` (the
  proxy's request policy), `routes.js` (the route table).
- `test/` Vitest suites · `docs/` a README screenshot · `Dockerfile` + `fly.toml`
  fly.io deployment.

Anything two tools need goes in `src/shared/`, namespaced per tool where it
touches storage — never reached for across `src/apps/`.

## How a run survives a closed tab

`useGenerationRun` writes the run in progress to `karmalab.<tool>.currentRun` on
every item change, and moves it to `karmalab.<tool>.runHistory` (newest first,
capped) once nothing is in flight. On load it reads `currentRun` back: if any item
is still active the run goes back on screen and each one is fetched from Replicate
and re-polled; if they all landed, it is archived instead. Opening a run from the
history modal does the same refresh, writing the result back into its history
entry.

Two details are easy to get wrong:

- **Archiving waits for the items to settle.** `finishRun()` only requests it;
  the archive happens in an effect once no item is active, so what history gets
  is the final state rather than whatever the refs held when the runner
  returned. Items that never reached a prediction (a cancelled batch leaves
  some) are closed out there, or a cancelled run would stay "current" forever.
- **A run is per tab, not per browser.** Two tabs of the same tool share the
  storage key and will both poll and both write. Nothing corrupts, but the
  progress in one lags the other; sorting that out means a `storage`-event
  listener or a lock, and neither is here.

The pre-run-model format (a flat `pendingJobs` list) is migrated into a run on
first read, so a tab closed before this shipped still recovers.

The Image Chain Studio is the one tool that can add to a finished run:
`continueRun()` flips the archived run back to live, keeping its id, and the new
steps are appended to it — archiving replaces the same history entry rather than
leaving a shorter copy behind. It can do this at all because what links two
steps is the earlier step's `outputUrl`, which is persisted, so a chain
recovered from a closed tab or reopened from history continues where it stopped.
(The video chain cannot: its link is an extracted frame that only exists in the
tab that made it. Replicate's result URLs do expire, so continuing a chain from
much later fails at the model rather than in the UI.)

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
the prediction polling loop, per-model input assembly for images and video, the
run model (what is persisted, a run's progress, the tab title), namespaced
storage with its current-run / history persistence and the legacy migration, the
Batch Video run-item flattening including its download filename stems, and the
Image Chain step model (the step a chain continues from, its numbering, the step
count parsing and the download filename stems).

`useGenerationRun` has no unit coverage — it is a hook over `localStorage`,
`document.title` and `beforeunload`, and the node test environment has none of
them. Its behaviour was verified in a real browser (Chromium + Playwright,
driving the tools against a stubbed `/v1`): progress and completion in the
tab title, the run persisted with its prediction ids, no data URIs in what is
stored, the `beforeunload` guard only while something is in flight, a run
archived to history with its final statuses, an unfinished run recovered on load
without creating a new prediction, and reopening a run from history. That script
is not in the repo — it wants a proper Playwright suite, alongside the one
`frames.js` needs. Changes to the hook need the same check by hand: `continueRun`
was verified the same way (Chromium + Playwright against a stubbed `/v1`, driving
the Image Chain Studio) — a chain generated, continued into the same history
entry, recovered mid-step on reload and then continued from the recovered
image, with each step's request carrying the previous step's output URL.

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
