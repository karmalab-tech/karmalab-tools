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
  adds more steps to the same chain, always continuing from the last step that
  produced an image; a step that failed is retried in place, or deleted, from
  its own card. The finished chain downloads as the images in a zip, or as one
  video with each image held for a set number of milliseconds.
- **Batch Video Studio** (`/batch-videos`) — a batch of videos: one per prompt
  line, or one per uploaded start frame. Both modes flatten to one list of run
  items in `src/apps/batchVideo/items.js`.
- **Continuous Video Studio** (`/video-chain`) — chains video clips; each clip
  starts from the last frame of the previous one, extracted in-browser via canvas.
- **Chat Box Studio** (`/prompt`) — the odd one out: it generates nothing on
  Replicate. It records the chat box (`src/apps/chatBox/ChatBox.jsx`, the styled
  box this route used to be a mockup of) having images dropped into it and a
  message typed and sent, as a video file at whatever resolution a reel wants —
  every frame painted on a canvas and encoded in the browser, over the sound of
  a real keyboard cut to the same timeline. Still not in the tools sidebar.

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
   trust model. Generated outputs are cached in the _browser's_ IndexedDB
   (`src/shared/outputCache.js`) because Replicate deletes them after an hour —
   that is local storage on the user's machine, never the server.
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
   A tool whose items are made in the browser rather than on Replicate passes
   `remote: false` (the Chat Box Studio): there is no prediction to ask about, so
   such a run is never refreshed, and one interrupted by a closed tab is closed
   out and shelved instead of being put back on screen to wait for nothing.
7. **Adding a tool is four edits**: an HTML entry at the root, an input in
   `vite.config.js`, an entry in `server/routes.js` — the source of truth for
   which tools exist — and one in `src/shared/tools.js`, which is what the tools
   sidebar puts in front of people. The two lists are deliberately not the same
   (the Chat Box Studio is routed but not offered); a test asserts every
   navigable tool is a real route, so they can't drift into a dead link.

## Routing lives on the backend

Each tool is a separate Vite HTML entry with its own JS bundle; there is no
client-side router — switching tools is a plain link, and the tools sidebar
(`src/shared/components/ToolsSidebar.jsx`, opened from the `Tools` button in the
`TopBar`) is a list of them. It replaced a tab per tool, which stopped fitting
at four and wrapped on a phone; behind one button the bar keeps to three
controls at any width. The tools are genuinely independent — no shared shell, no
cross-tool state — so this keeps each bundle small (the heavy Batch Studio
JavaScript never loads on the Chat Box Studio) and lets the server own routing.
`vite build` emits `dist/`; `server/routes.js` maps clean routes to the built
HTML.

## Layout

- `index.html` / `image-chain.html` / `batch-videos.html` / `video-chain.html` /
  `prompt.html` — Vite HTML entries, each loading a script from `src/entries/`.
- `src/apps/` — the tools. Per-tool logic in `src/apps/batch/` (`storage.js`),
  `src/apps/imageChain/` (`chain.js` — the step model, `video.js` — stitching the
  chain into one video, `DownloadModal.jsx`, `storage.js`),
  `src/apps/batchVideo/` (`items.js`, `storage.js`), `src/apps/video/`
  (`frames.js` — end-frame extraction via off-screen `<video>` + canvas) and
  `src/apps/chatBox/` (`ChatBox.jsx` — the box itself, `design.js` — the numbers
  it is built from, `scene.js` — the same box painted on a canvas, `timeline.js`
  — what it is doing at a given millisecond, `audio.js` — the typing sound
  arranged against that, `typing/` + `sequences.js` — the keyboard clips that
  ship with it, `record.js` — the frames and the sound encoded into a file,
  `sound.js` + `storage.js` — what is kept between visits).
- `src/shared/` — what the tools are built from: `theme.css` (the Tailwind
  entry — `@theme` tokens, base styles, keyframes), `components/` (import from
  `src/shared/components`, which also pulls in `theme.css`), `tools.js` (the
  tool list behind the sidebar), `replicate.js`
  (prediction create / poll / output helpers, the longer polling profile video
  needs, and `friendlyErrorMessage()`), `imageModels.js` and `videoModels.js`
  (the model catalogues and their input assembly, one per medium and each shared
  by two tools), `storage.js`
  (`createToolStorage(namespace)` — namespaced `localStorage` plus the
  current-run / run-history persistence, one prefix per tool), `apiKey.js`, `fields.js`,
  `useUnloadGuard.js`, `videoEncode.js` (the WebCodecs encoder plumbing the two
  tools that build a video locally share — which codec and container this
  browser has, the muxer, the encode queue, and the audio track when there is
  one), plus the run machinery: `runs.js`
  (the run/item model — what is persisted, a run's progress, the tab title),
  `useGenerationRun.js` (the hook every generation tool shares) and
  `download.js` (single-file and zip downloads).
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
The same URL is what a retry reuses: a failed step is replaced in place with a
fresh one at the same number, handed the newest image _before_ it
(`chainSource(items, index)`), so a failure anywhere in the chain — the first
step included — is recoverable without starting over. Each step records the
label of the step it came from (`from`, persisted) rather than deriving it, so
retrying one step never rewrites what another card says it used. A failed step
can also be deleted (`removeItem()` on the hook); losing a run's last item
clears it from storage — `clearCurrentRun()`, or `removeHistoryRun()` once it
has been archived — so an empty run is not recovered on the next load or left
sitting in the history list.
(The video chain cannot: its link is an extracted frame that only exists in the
tab that made it. Replicate's result URLs do expire, so continuing a chain from
much later fails at the model rather than in the UI.)

## Results outlive Replicate, on purpose

Replicate deletes an API prediction's output files an hour after the prediction
ran — the file, not just the signature on the URL, so re-fetching the prediction
returns a link to nothing. A long batch or chain can finish with its earliest
results already gone, and a run reopened from History is older than that by
definition.

So `src/shared/outputCache.js` copies every output into **IndexedDB the moment
it lands**, while the URL is still good, and everything downstream reads the
cache before the network: the result cards (`useCachedOutput`), the single
downloads and zips (`download.js`), and the image chain's video encoder. The
copy is per browser, on the user's own machine — no server sees it, so the trust
model is unchanged, but note it _is_ a change to "nothing is stored": the
outputs are now on disk locally, and the History modal says so.

For the Chat Box Studio the cache is not an insurance policy but the only copy
there is: its `outputUrl` is a blob URL, which dies with the tab that made it,
so a recording reopened from History plays and downloads from IndexedDB or not
at all. Its typing sound lives in the same store, under
`chatBoxStudio/assets/typingSound` (`src/apps/chatBox/sound.js`) — a clip is a
file chosen once and wanted under every recording after that, and `assets` sits
where a run id normally does, so clearing the history leaves it alone.

- **The write happens in `useGenerationRun.updateItem`**, not in each tool: any
  patch carrying an `outputUrl` triggers the copy, so every tool got this at
  one call site. It is deliberately not awaited — a run is never held up by
  caching, and a failed copy just means falling back to the URL later.
- **Keys are `tool/runId/itemId`** (`cacheKey`), which is what lets a run's files
  be dropped in one go when its history entry is cleared, and keeps two tools
  from colliding on an item id.
- **The store is bounded** (`MAX_BYTES`, 500 MB) and evicts oldest-first
  (`planEviction`), so a browser profile can't fill up with a year of
  generations. A run pushed off the end of the capped history list keeps its
  files until that eviction reaches them.
- **Every path degrades to the network.** No IndexedDB (private mode, blocked
  storage), a quota error, a failed copy — all of it resolves to "no cached
  blob", and the download falls back to the URL. What it must never do is throw
  into a run.
- **A zip that comes up short says so.** `downloadZip` returns the names it
  could not find anywhere; the tools surface that instead of handing over a zip
  that is quietly three images light.

## Making a video in the browser

Two tools build a video locally rather than fetching one from a model: the Image
Chain Studio stitches a chain's images into a clip
(`src/apps/imageChain/video.js`) and the Chat Box Studio records the chat box
(`src/apps/chatBox/record.js`). Both draw frames on a canvas, encode them with
**WebCodecs** and mux them with `mp4-muxer` or `webm-muxer` (imported on demand,
like JSZip, so nothing loads until a video is actually asked for). No upload, no
ffmpeg-sized dependency, same trust model as the rest of the app. What they
share — picking an encoding, the muxer, draining the encode queue — is
`src/shared/videoEncode.js`; what differs is the frames.

Things there that are less obvious than they look:

- **The format is not a given.** H.264 in MP4 is what every player takes, but a
  Chromium built without proprietary codecs (and Firefox) has WebCodecs and no
  H.264 encoder at all, so the encoding is chosen by asking
  `VideoEncoder.isConfigSupported` down a list — H.264 first, then VP9 and VP8
  in WebM — and the file is named after what came back. The H.264 candidates
  differ only in profile/level because a level caps the frame size it accepts
  (baseline 3.1 is already too small for a 1024×1024 image).
- **WebM needs a marker frame at the end.** `webm-muxer` takes the segment
  duration from the last block's timestamp and ignores its `BlockDuration`, so
  without one extra frame at the very end the file claims to be a frame short
  and players cut it off. `mp4-muxer` adds the last sample's own duration, so
  the MP4 path must _not_ do this. Both tools carry this.
- **A held still and a moving picture want different bitrates.** `stillBitrate`
  is per-frame quality for a chain of completely different images;
  `motionBitrate` is for 30 frames a second where almost nothing changes between
  them, and is what keeps a 1080×1920 reel in single-digit megabytes.
- **Looping stops one short** (the image chain). The frame order for a loop is
  the chain forwards then back down it, ending on the second image: the player's
  own loop supplies the return to the first, so it doesn't sit on a doubled
  frame at the seam.

## Recording the chat box

The Chat Box Studio does not capture the screen. `src/apps/chatBox/scene.js`
paints the box on a canvas at the target resolution, from the same numbers the
DOM box is built from (`design.js`), and `timeline.js` says what it should look
like at a given millisecond. So the recording is laid out at 1080 wide rather
than scaled up from a screenshot, it renders as fast as the encoder goes
rather than in real time, and it needs no visible window.

That split is the thing to keep honest: `ChatBox.jsx` writes the metrics out as
Tailwind arbitrary values (Tailwind has to see the class strings) while
`scene.js` multiplies the same numbers by a scale, so a size changed in
`design.js` has to be changed in the markup too. The studio's stage is the check
— it is the real component in a frame the shape of the video, at the scale the
recording uses, so the two are side by side the whole time.

A recording is five stretches of time, all of them in `timeline.js`: an empty
box, the images landing in it one every `attachIntervalMs`, the message typed,
a pause, the send. Images are not sitting in the box when the video opens —
they drop in, one after another, and typing starts one interval after the last
of them.

Details worth knowing:

- **The layout width is what makes it a phone.** The box is laid out at
  `layoutWidth` CSS pixels (400 by default — a phone) and every metric is then
  multiplied by `frame width / layout width`, so a 1080-wide reel draws it at
  2.7×: the text is as big in the frame as it is on a phone. Laying the same box
  out at 860 and drawing it at 1.26× — which is what it did first — is a desktop
  window shrunk into a reel, and reads as tiny on the thing it is watched on.
  The box-width slider is a share of that screen, not of the frame.
- **The composition is settled against the finished message**, and the box is
  drawn from its bottom edge up. The controls row and the send button hold still
  while the box grows over them, instead of the whole thing drifting up the
  frame with every new line. The stage does the same, by measuring the box and
  shifting it by half of what it has yet to grow (`boxLift`).
- **Fonts have to be loaded before the first frame.** A canvas silently falls
  back to a system font for a face the document hasn't loaded, so `ensureFonts()`
  waits on the ones in `FONT_SPECS`; without it the video ships in Arial and
  nothing says so.
- **The attachment strip wraps**, like the DOM box's does (`thumbsPerRow`), so a
  tenth image doesn't quietly fall off the edge of the frame.

### The typing sound

`typing/` holds eight short mp3s, one per burst of typing, cut out of a single
recording of a real keyboard. They are what the sound is made of: wherever
characters are landing, `audio.js` drops one of them at random under the run,
and wherever they are not there is nothing. That arrangement is what makes the
sound do the three things it has to, rather than any gating:

- **Only while typing**, because a clip exists only under a run of keystrokes —
  the opening beat, the images dropping in, a breath at a full stop, the pause
  before the send and the wait after it are silent.
- **In time with the picture**, because every clip is played from its own first
  keystroke (`leadMs`, found by the onset detector when it is decoded), never
  from the top of the file. That matters: the source recording opens with 450ms
  of room tone, which a clock-based cut would have laid under the first
  characters — and did, until it was measured. The far end is cut the same way,
  `RUN_TAIL_MS` after the last character, so the sound stops with the typing
  instead of ringing into the pause.
- **Never the same part twice**, because clips are picked without replacement
  until they run out (`wrapped` says when a long message has gone through them
  all).

Splitting a new source clip is the same job each time: find the onsets, group
them into bursts, and cut the mp3 on frame boundaries so nothing is re-encoded —
the sequences in `typing/` were cut that way from one 8-second recording, and
another file dropped into that folder joins the set without a code change
(`sequences.js` globs it).

The sound then costs the recorder a second track: `pickTracks` prefers whatever
video encoding is best, but a browser with H.264 and no AAC would otherwise
produce a silent MP4, so it looks again in WebM, whose Opus every browser with
an `AudioEncoder` has. The picture is encoded first and the sound after — each
track's own chunks in order, which is what both muxers ask for. The studio's
"Play preview" builds the same track and plays it through Web Audio, so the
preview is the file, ears included.

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
storage with its current-run / history persistence, removing a run from history
and the legacy migration, the output cache's keys and its eviction plan, the
Batch Video run-item flattening including its download filename stems, and the
Image Chain step model (the step a chain continues from or a retry goes back to,
its numbering, the step count parsing and the download filename stems) and its
video arithmetic (the frame order with and without a loop, the resulting length,
the duration parsing), and the Chat Box Studio's recording timeline (the four
stretches it adds up to, that the typing keeps to the speed asked for and pauses
at a full stop, that the same settings produce the same recording, that a
character is never un-typed and the caret goes away at the send, the frame count
the encoder is asked for, and the clamping of every settings box), its frame
arithmetic (an even resolution, the presets, the download's name and extension),
the images it drops in (when each lands, what that does to the typing, the send
and the length, and how far the newest one is into landing) and its typing sound
(that it is heard only while characters land and silent either side, that a
burst is one run and a pause breaks it, that a clip is played from its own first
keystroke and cut when the run ends, that a long run is filled with more clips
and no clip repeats until they have all been used, that the onset detector finds
the keystrokes in a clip, and that the track is silence with faded edges).

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
image, with each step's request carrying the previous step's output URL. The
per-step retry was checked the same way, against a stub that fails on demand: a
failed first step retried in place, a mid-chain failure retried with the image
before it rather than a later one, and no extra cards or history entries left
behind, a failed step deleted from a chain (persisted, with the surviving steps
keeping their numbers and the next batch still starting from the last image),
and deleting a run's last step clearing it from storage instead of leaving an
empty run to recover. The video was checked the same way, by building one and
reading the duration back out of the container: four images at 120ms produce a
480ms file, the same chain looped produces 720ms (six frames), and the download
is named after the container it turned out to be. That Chromium has no H.264
encoder, so it exercised the WebM path; the MP4 path's timing was checked
separately against `mp4-muxer` directly (four 120ms samples → a 480ms file),
and a real H.264 encode still wants a look on a browser that has one.

The Chat Box Studio was checked the same way, in Chromium + Playwright, since
the parts of it that could be wrong are all browser parts: a recording driven
from the UI came out at the planned length (a 102-frame plan → a 3.4s file) and
was archived to history with its title, label and filename stem but no
prediction id; after a reload — with the blob URL in storage long dead — opening
it from History played it from the output cache; a drag over the box lit it up
and a dropped file became a thumbnail in it and a count on the attach pill; and
the frames themselves were read back as PNGs at each phase (empty, typing with
the caret at the end of the text, two lines with the spinner in the send button)
to check the painting against the box on screen. The stage's anchoring was
checked by measuring the box's bottom edge: settled and mid-preview, to the
pixel. The images and the sound were checked the same way: frames read back as
PNGs at each landing (the box lit, the newest thumbnail mid-scale, the pill's
count following it), and a recording with a clip under it decoded back out of
the muxed file — 6.013s of Opus against a 6.0s video, silent before the typing
(RMS 0) and after the send (RMS 0), audible in between. Driven from the UI, a
clip taken through the file picker survived a reload from IndexedDB with its
name, and the recording came out labelled `WebM · VP9 + Opus`. That Chromium has no H.264 encoder either, so what shipped there was
WebM/VP9 — the MP4 path wants a look on a browser that has one. Google Fonts is
not reachable from that sandbox, so the frames rendered in the fallback face:
`ensureFonts()` itself is unverified, and worth a look on a machine with the
fonts.

`src/apps/video/frames.js`, `src/apps/imageChain/video.js` and
`src/apps/chatBox/scene.js` + `record.js` have **no** automated coverage of the
media parts — jsdom can't decode video, and the node environment has no canvas
and no WebCodecs, so a test there would assert nothing meaningful; they want a
Playwright test. It's the subtlest code in the repo, so changes need manual
verification in a real browser, and say so rather than implying tests cover it.

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
