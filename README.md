# KarmaLab Tools

A small collection of browser-based tools, each on its own route, built with
**React + Vite** and served by a small Node server that also proxies the
Replicate API.

- **Batch Image Studio** (`/`) — generates one image per text prompt via
  Replicate, in batch.
- **Prompt Box** (`/prompt`) — a styled mockup.

## Running locally

Package manager is **yarn**; needs Node ≥ 18.11.

```bash
yarn dev      # Vite dev server (HMR) + /v1 proxy — the normal workflow
yarn build    # build both tools to dist/
yarn start    # run the Node server on dist/ (build first)
```

`yarn dev` serves `/` and `/prompt` on port 5173. Paste a Replicate token in the
Batch Studio (remembered in `localStorage`).

## How it works

Each tool is a separate Vite HTML entry with its own bundle — there is no
client-side router. The Node server (`server/index.js`) serves `dist/` and
proxies `/v1/...` to Replicate to avoid CORS.

See [AGENTS.md](AGENTS.md) for the full architecture notes.

## Deployment

Configured for [fly.io](https://fly.io) via `Dockerfile` and `fly.toml`.
