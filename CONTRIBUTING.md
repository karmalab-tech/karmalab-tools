# Contributing

Thanks for looking. This is a small project, so the bar is simple: it should
build, lint, and pass tests, and it should keep working for people running it
locally with their own Replicate token.

## Setup

Needs **Node ≥ 18.11** (`.nvmrc` pins 20) and **yarn**. The lockfile is
`yarn.lock`, so please use yarn — npm will resolve a different tree and CI
installs with `--frozen-lockfile`.

```bash
yarn install
yarn dev        # http://localhost:5173
```

Add a Replicate token via the **API keys** button in the top bar. It stays in your
browser's `localStorage`; nothing is written server-side. Generations bill to your
own Replicate account, so test with a cheap model where you can.

## Before opening a pull request

```bash
yarn lint
yarn format:check
yarn test
yarn build
```

CI runs exactly these four. `yarn format` fixes formatting; `yarn lint:fix`
fixes what ESLint can.

## Adding a model

One entry in the relevant `models.js` — the UI rebuilds itself from it.

- Images: `src/apps/batch/models.js`
- Video: `src/shared/videoModels.js` — shared by the Batch Video Studio and the
  Continuous Video Studio, so one entry appears in both. Check it works in each.

Each entry declares only how that model _differs_: which key it wants for the
aspect ratio, whether it takes a reference image and whether that field is an
array, any static extra input, and any user-fillable extra fields. The comment at
the top of each file documents every option.

Please confirm you have actually run a generation through the model you are
adding — the input schemas differ in small ways that are easy to get wrong on
paper.

## Adding a tool

Three steps:

1. An HTML entry at the repo root (copy `index.html`), pointing at a new script
   in `src/entries/`.
2. That input registered in `vite.config.js` under `build.rollupOptions.input`.
3. One entry in `server/routes.js` mapping the clean route to the built HTML.

Then build the tool itself in `src/apps/`, using the shared components from
`src/shared/components`. Keep it independent — the tools deliberately share no
state or shell, only the component library and the API key storage.

## House style

- **Tailwind utilities, no co-located CSS.** Design tokens live in `@theme` in
  `src/shared/theme.css`. Pull long repeated class strings into a local const or a
  variant map rather than duplicating them.
- **Always fetch relative `/v1/...`**, never `api.replicate.com` directly.
  Replicate sends no CORS headers; the proxy is what makes the call work. If you
  need a Replicate endpoint the app doesn't currently call, you must also add it
  to the allowlist in `server/proxy.js` — and say why in the PR.
- **Comments explain why, not what.** The existing code leans on short comments
  above non-obvious blocks; match that.
- Prettier settles formatting. Don't hand-format against it.

## Tests

Add tests for logic that can break silently — input assembly, storage, polling,
the proxy policy. `test/` has examples of each. Components aren't unit-tested
here, and that's fine.

If you touch `src/apps/video/frames.js`, be aware it has no automated coverage
(jsdom can't decode video) and is the subtlest code in the repo. Please describe
how you tested it by hand.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the reasoning behind the
layout, the proxy, and the lint configuration.

## Reporting a security issue

Don't open a public issue — see [SECURITY.md](SECURITY.md).
