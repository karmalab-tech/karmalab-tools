# Contributing

Thanks for looking. Small project, simple bar: it should build, lint and pass
tests, and keep working for people running it locally with their own Replicate
token.

## Setup

Needs **Node ≥ 18.11** (`.nvmrc` pins 20) and **yarn** — CI installs with
`--frozen-lockfile`, so npm will drift.

```bash
yarn install
yarn dev
```

Add a Replicate token via the **API keys** button in the top bar. Generations bill
to your own account, so test with a cheap model where you can.

Before opening a pull request, run what CI runs:

```bash
yarn lint && yarn format:check && yarn test && yarn build
```

`yarn format` fixes formatting, `yarn lint:fix` fixes what ESLint can. Prettier
settles formatting — don't hand-format against it.

## Adding a model

One entry in a config file; the UI rebuilds itself from it.

- Images: `src/apps/batch/models.js`
- Video: `src/shared/videoModels.js` — shared by both video tools, so one entry
  appears in each. Check it works in both.

Each entry declares only how that model _differs_: which key it wants for the
aspect ratio, whether it takes a reference image and whether that field is an
array, static extra input, and user-fillable extra fields. The comment at the top
of each file documents every option.

Please confirm you've actually run a generation through the model — the input
schemas differ in small ways that are easy to get wrong on paper.

## Adding a tool

1. An HTML entry at the repo root (copy `index.html`), pointing at a new script in
   `src/entries/`.
2. That input registered in `vite.config.js`.
3. One entry in `server/routes.js`.

Then build it in `src/apps/`, using the shared components from
`src/shared/components`. Keep it independent — the tools share no state or shell,
only the component library and the API key storage.

## Two things to know

**Always fetch relative `/v1/...`**, never `api.replicate.com` directly.
Replicate sends no CORS headers; the proxy is what makes the call work. If you
need an endpoint the app doesn't currently call, you must also add it to the
allowlist in `server/proxy.js` — say why in the PR.

**`src/apps/video/frames.js` has no automated coverage** (jsdom can't decode
video) and is the subtlest code here. If you touch it, describe how you tested it
by hand.

[AGENTS.md](AGENTS.md) has the architecture notes and the reasoning behind the
layout, the proxy and the lint config. Security issues: see [SECURITY.md](SECURITY.md),
not a public issue.
