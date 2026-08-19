# Architecture

How KarmaLab Tools is put together, and why. If you only want to add a model or a
tool, [CONTRIBUTING.md](../CONTRIBUTING.md) is the shorter read.

## Routing lives on the backend

Each tool is a **separate Vite HTML entry** with its own JS bundle. There is no
client-side router.

The tools are genuinely independent — no shared shell, no cross-tool state — so a
multi-page setup keeps each bundle small (the heavy Batch Studio JavaScript never
loads on the Prompt Box) and lets the Node server own routing. `vite build` emits
`dist/`; the server maps clean routes to the built HTML.

`server/routes.js` is the single source of truth for which tools exist. The
server reads it to resolve routes, and the same list can feed a shared tool index
later.

## Layout

| Path                                            | What it is                                                    |
| ----------------------------------------------- | ------------------------------------------------------------- |
| `index.html`, `video-chain.html`, `prompt.html` | Vite HTML entries for `/`, `/video-chain`, `/prompt`          |
| `src/entries/`                                  | Mounts each tool's root React component                       |
| `src/apps/`                                     | The tools themselves                                          |
| `src/apps/batch/`                               | Batch Studio logic: `models.js`, `replicate.js`, `storage.js` |
| `src/apps/video/`                               | Video Studio logic: `models.js`, `frames.js`                  |
| `src/shared/`                                   | The shared library the tools are built from                   |
| `server/index.js`                               | Node server: serves `dist/`, proxies Replicate                |
| `server/proxy.js`                               | The proxy's request policy — allowlist, headers, rate limit   |
| `server/routes.js`                              | Route table (clean route → built HTML)                        |
| `vite.config.js`                                | Multi-page inputs + the dev `/v1` proxy                       |
| `test/`                                         | Vitest suites                                                 |
| `Dockerfile`, `fly.toml`                        | fly.io deployment                                             |

`src/shared/` holds:

- `theme.css` — the Tailwind entry: `@theme` design tokens, base styles, keyframes.
- `components/` — `Spinner`, `IconButton`, `Input`, `Button`, `Panel`, `Brand`,
  `ImageDrop`, `TopBar` (cross-tool nav + the API key button), `ApiKeyModal`.
  Import from `src/shared/components`, which is also what pulls in `theme.css`.
- `replicate.js` — generic prediction create / poll / output helpers.
- `apiKey.js` — the shared keys in `localStorage`: the Replicate token, plus the
  OpenAI key that only OpenAI models need. Older per-tool storage keys are still
  read as a fallback so existing users keep their keys.
- `fields.js` — shared field/control utility-class strings.
- `useUnloadGuard.js` — `beforeunload` confirmation while a run is in progress.

## The key constraint: the Replicate proxy

`api.replicate.com` sends no CORS headers, so a browser `fetch()` straight to it
is always blocked. Both the Vite dev server and the Node production server
forward `/v1/...` to Replicate, keeping the calls same-origin.

**So: always fetch relative `/v1/...`, never `api.replicate.com` directly.**

The Replicate token is passed through from the browser and never stored
server-side. That is what makes the app usable without accounts, and it is also
its main architectural limitation — see below.

### What the proxy allows

Since a deployed instance is reachable by anyone, `server/proxy.js` restricts it:

1. **Request allowlist.** Only `POST /v1/models/{owner}/{model}/predictions` and
   `GET /v1/predictions/{id}` — the two calls `src/shared/replicate.js` makes.
   Everything else is refused with a 403 rather than forwarded.
2. **Header allowlist.** Only `authorization`, `content-type` and `accept` go
   upstream. Building it as an allowlist means headers the browser adds by
   default — `cookie` above all — are dropped by construction rather than by
   remembering to delete them. `Set-Cookie` is stripped from responses.
3. **Body cap and rate limit.** Bodies are capped (reference images are base64
   data URIs and are not downscaled in the browser, so the cap has to be
   generous). Requests are counted per client in a fixed window, keyed off
   `fly-client-ip` or the socket address — never a client-supplied
   `X-Forwarded-For`, which anyone could rotate to reset their bucket.

The rate limiter is in-process, so it bounds what one client can push through
_one machine_. A multi-machine deployment should rate limit at the edge instead.

### The limitation worth knowing about

Taking the token from the browser is the root of the tradeoff. A deployment that
wants real protection should hold a Replicate token server-side and authenticate
its own users, at which point the proxy stops being an anonymous relay. That is a
different product — accounts, billing, quotas — which is why this repo hasn't
gone there.

## Styling: Tailwind v4, CSS-first

Styling is **Tailwind v4** via `@tailwindcss/vite`. Design tokens live in
`@theme` in `src/shared/theme.css` (the single Tailwind entry, imported once
through the shared components barrel), so tokens double as utilities:
`bg-panel`, `text-text-dim`, `border-panel-border`, `font-mono`,
`animate-klb-spin`.

Both tools and every shared component are on utilities — there are no co-located
`.css` files. Longer, repeated class strings are pulled out into local consts
(`CONTROL`, `FIELD` in `BatchImageStudio.jsx`) or a variant map (`IconButton`,
`Button`).

## Testing

`yarn test` runs Vitest in the `node` environment; the browser globals the
modules touch (`localStorage`, `fetch`) are stubbed per test. Covered:

- `server/proxy.js` — the request policy above. The security-relevant code, so
  what it _refuses_ is tested as thoroughly as what it allows.
- `src/shared/replicate.js` — the polling loop's terminal states, cancellation,
  timeout, and the several output shapes models return.
- `src/apps/batch/replicate.js` — `buildInput()`, which assembles per-model input.
- `src/apps/batch/storage.js` — pending-job persistence, including corrupt JSON
  and a `localStorage` that throws.

**Not covered:** `src/apps/video/frames.js`. It drives a real `<video>` element
and canvas, including a seek to just short of the clip's duration. jsdom does not
decode video, so a test there would assert nothing meaningful — it needs a
browser-based (Playwright) test. This is the least-covered and subtlest code in
the repo; treat changes to it carefully.

React components have no tests. At this size the build plus `react-hooks` lint
catches most of what a shallow render would.

## Lint configuration worth explaining

`eslint.config.js` enables `react-hooks/rules-of-hooks` and
`react-hooks/exhaustive-deps` **by name** rather than spreading
`eslint-plugin-react-hooks`'s `recommended` preset. That preset now also carries
the React Compiler rules, and this codebase hydrates state from `localStorage`
inside mount effects — restoring in-flight Replicate jobs, re-reading the API
keys when the modal opens — which `set-state-in-effect` flags but which is the
intended use of an effect: synchronising with an external system.

Adopting the preset would mean either suppressing that rule at each site or
restructuring working features. Worth revisiting if the React Compiler is adopted.

## Ideas, not commitments

- **More shared components** — grow `src/shared/components` as tools are added.
- **A shared tool index** — could be driven straight from `server/routes.js`.
- **Browser downscaling of reference images** — would shrink request bodies a lot
  and let the proxy's body cap come down with them.
- **Playwright coverage for `frames.js`** — see above.
