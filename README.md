# KarmaLab Tools

Browser-based tools for generating images and video with
[Replicate](https://replicate.com) models. Built with **React + Vite** and served
by a tiny Node server that also proxies the Replicate API.

Built for [KarmaLab](https://www.karmalab.tech) and open-sourced because the
tools are generally useful: if you work with Replicate models in bulk, or want to
chain video clips into a continuous shot, these do that without a signup.

![The Batch Image Studio, with four prompts queued](docs/screenshot-batch-image-studio.png)

## You bring your own keys — and pay for your own generations

There is no account and no server-side API key. You paste your own Replicate API
token into the app; it stays in your browser's `localStorage` and is sent with
each request. **Every generation is billed to your own Replicate account.** A few
models (the OpenAI GPT Image ones) additionally bill through your own OpenAI
account and need an OpenAI key too.

Nothing is stored server-side — no accounts, no tokens, no prompts, no outputs.

## The tools

- **Batch Image Studio** (`/`) — paste a list of prompts, one per line, pick a
  model, generate them all. Runs three at a time, with an optional shared prompt
  suffix and reference image. Downloads individually or as a zip, and remembers
  in-flight generations so closing the tab and coming back resumes them.
  Models: GPT Image 1 and 2, Flux 1.1 Pro, Flux Kontext Pro, Ideogram v3 Turbo,
  Recraft v3, Stable Diffusion 3.5 Large.
- **Batch Video Studio** (`/batch-videos`) — the same idea for video, in two
  modes: one video per prompt line (with an optional shared start frame), or one
  video per uploaded start frame from a single prompt.
- **Continuous Video Studio** (`/video-chain`) — chains clips into one continuous
  shot: each clip is generated from the **last frame of the previous one**,
  extracted in the browser with an off-screen `<video>` and a canvas. Auto-run a
  set number of clips, or review each and continue, retry or stop.
  Both video tools share a model catalogue: Veo 3.1 and 3.1 Fast, Kling v3,
  Seedance 2.0, Hailuo 2.3 Fast, Wan 2.7 i2v.
- **Prompt Box** (`/prompt`) — a non-functional UI mockup, kept as a styling
  reference. Mentioned so its presence here isn't a mystery.

## Running it locally

Needs **Node ≥ 18.11** (`.nvmrc` pins 20) and **yarn** — the lockfile is
`yarn.lock`, so npm will resolve a different tree.

```bash
yarn install
yarn dev      # http://localhost:5173, with HMR
```

Then click **API keys** in the top bar and paste a token from
[replicate.com/account/api-tokens](https://replicate.com/account/api-tokens).

For the production setup — the built app served by the Node server — use
`yarn build && yarn start` (http://localhost:8787). `yarn lint`,
`yarn format`, and `yarn test` are the other scripts; CI runs lint, format check,
test and build on every pull request.

## How it works

Each tool is a separate Vite HTML entry with its own bundle, so there is no
client-side router and the heavy Batch Studio JavaScript never loads on the
Prompt Box. Routing lives on the server: `server/routes.js` maps clean routes to
built HTML files.

`api.replicate.com` sends no CORS headers, so the browser cannot call it
directly. Both the Vite dev server and the Node server forward `/v1/...` to
Replicate, keeping every call same-origin.

[AGENTS.md](AGENTS.md) has the fuller architecture notes.

## A note on the Replicate proxy

Because the token comes from the browser, the `/v1` proxy is usable by anyone who
can reach a deployed instance. It exposes no credentials — callers supply their
own token and none is stored — but your host does relay their traffic. So the
proxy forwards only the two request shapes the app itself makes, only the headers
Replicate needs, and only within a per-client rate limit. See `server/proxy.js`,
which documents the `PROXY_*` environment variables that tune it.

**If you deploy this publicly, understand that tradeoff first.** The stronger
setup is to hold a Replicate token server-side and authenticate your own users
instead of accepting one from the browser. Found a hole? See
[SECURITY.md](SECURITY.md).

## Deploying

There's a `Dockerfile` (multi-stage: build, then run the server) and a `fly.toml`
for [fly.io](https://fly.io). The `app` name in `fly.toml` is a placeholder —
fly.io app names are globally unique, so run `fly launch` to create your own
first. Any host that can run a Node container works; the runtime needs no
`node_modules`, since the server uses only Node core modules. Set `PORT` to
choose the port (`fly.toml` uses 8080).

## Contributing

Welcome — adding a model is one entry in a config file, and adding a whole tool
is three edits. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE).
