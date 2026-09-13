// Stitching a chain's images into one video, in the browser.
//
// Each image is held on a canvas for the same number of milliseconds, encoded
// with WebCodecs and muxed into an MP4. The encoder plumbing — which codec and
// container this browser actually has, the muxer, the encode queue — is shared
// with the Chat Box Studio's recorder in src/shared/videoEncode.js; what is
// here is the frames. Nothing leaves the browser and no server is involved —
// the same trust model as the rest of the app.
//
// WebCodecs is what makes this possible without an ffmpeg-sized download, and
// it is also the limit: a browser with no `VideoEncoder` cannot do this at all,
// and `videoSupport()` answers that before the UI offers it.
//
// Like src/apps/video/frames.js this drives real browser media APIs and has no
// automated coverage — the pure parts (the frame order, the arithmetic, the
// input parsing) are unit-tested, the encoding is verified by hand in a
// browser.

import { cachedBlob } from '../../shared/outputCache.js';
import {
  createMuxer,
  drainEncoder,
  pickEncoding,
  stillBitrate,
  videoSupport,
} from '../../shared/videoEncode.js';

export { videoSupport };

export const DEFAULT_MS_PER_IMAGE = 200;
export const MIN_MS_PER_IMAGE = 20;
export const MAX_MS_PER_IMAGE = 10000;

// The duration box is free text: "0", "12.5" and "abc" are not durations.
// Returns the milliseconds to hold each image, or null if it isn't one.
export function parseDurationMs(raw) {
  const ms = Number.parseInt(String(raw ?? '').trim(), 10);
  if (!Number.isFinite(ms) || ms < MIN_MS_PER_IMAGE) return null;
  return Math.min(ms, MAX_MS_PER_IMAGE);
}

// The order the images are shown in. Looping plays the chain forwards and then
// back down it, stopping one short of the first image: the player's own loop
// supplies that one, so the chain reads as a continuous back-and-forth instead
// of pausing on a doubled first frame.
export function frameSequence(count, loop) {
  const forward = Array.from({ length: count }, (_, i) => i);
  if (!loop || count < 3) return forward;
  const back = [];
  for (let i = count - 2; i >= 1; i--) back.push(i);
  return forward.concat(back);
}

export const totalDurationMs = (count, msPerImage, loop) =>
  frameSequence(count, loop).length * msPerImage;

// What the download is likely to be, for the modal to say so up front. A common
// frame size stands in for the chain's own, since the images have not been
// fetched yet; the file itself is named after what the build actually used.
export const probeEncoding = () => pickEncoding(640, 640, 5);

// Draw one image centred on the canvas, scaled to fit. A chain's images are
// normally all the same size, but a model or aspect ratio changed part-way
// through leaves the odd one out — letterboxing it keeps the video one size
// rather than failing.
function drawContained(ctx, bitmap, width, height) {
  const scale = Math.min(width / bitmap.width, height / bitmap.height);
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, Math.round((width - w) / 2), Math.round((height - h) / 2), w, h);
}

// Build the video. `sources` are the images in chain order as
// { url, key } — the key being their place in the output cache — `msPerImage`
// how long each is held, `loop` whether to come back down the chain.
// `onProgress` is called with { stage, done, total } as it goes. Resolves to
// { blob, extension, label } — the extension being whichever container the
// browser could encode.
export async function buildChainVideo({ sources, msPerImage, loop, onProgress = () => {} }) {
  if (!videoSupport()) throw new Error('This browser cannot encode video.');
  if (!sources.length) throw new Error('There are no images to stitch.');

  // Gather every image up front, cache first: an hour after a step ran its
  // Replicate URL is a link to a deleted file, and the cached copy is the only
  // one left. Decoding from a blob (rather than pointing the canvas at a URL)
  // also keeps the canvas untainted, so the frames can be read back.
  const bitmaps = [];
  for (const [i, source] of sources.entries()) {
    onProgress({ stage: 'loading', done: i, total: sources.length });
    let blob = source.key ? await cachedBlob(source.key) : null;
    if (!blob) {
      const resp = await fetch(source.url);
      if (!resp.ok) {
        throw new Error(
          `Image ${i + 1} is no longer available (HTTP ${resp.status}) — Replicate deletes results an hour after they are made, and this one was not cached.`
        );
      }
      blob = await resp.blob();
    }
    bitmaps.push(await createImageBitmap(blob));
  }

  // H.264 wants even dimensions; the first image sets the frame, the rest are
  // fitted into it.
  const width = Math.max(2, bitmaps[0].width - (bitmaps[0].width % 2));
  const height = Math.max(2, bitmaps[0].height - (bitmaps[0].height % 2));
  const framerate = Math.max(1, Math.round(1000 / msPerImage));

  const encoding = await pickEncoding(width, height, framerate);
  if (!encoding) throw new Error('This browser has no video encoder for images this size.');

  const muxer = await createMuxer(encoding, width, height, framerate);

  let encodeError = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (err) => {
      encodeError = err;
    },
  });
  encoder.configure({
    codec: encoding.codec,
    width,
    height,
    bitrate: stillBitrate(width, height),
    framerate,
  });

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  const sequence = frameSequence(bitmaps.length, loop);
  const frameDuration = msPerImage * 1000; // microseconds
  try {
    for (const [position, imageIndex] of sequence.entries()) {
      if (encodeError) throw encodeError;
      onProgress({ stage: 'encoding', done: position, total: sequence.length });
      drawContained(ctx, bitmaps[imageIndex], width, height);
      const frame = new VideoFrame(canvas, {
        timestamp: position * frameDuration,
        duration: frameDuration,
      });
      // Only the first frame is forced: every image is a scene change, so the
      // encoder inserts its own keyframes where they earn their size.
      encoder.encode(frame, { keyFrame: position === 0 });
      frame.close();
      await drainEncoder(encoder);
    }
    // WebM's segment duration is taken from the last block's timestamp alone
    // (webm-muxer ignores its BlockDuration for this), so without a marker
    // after the final image the file claims to be one hold short and players
    // cut it off. One repeat of the last image, timed at the very end, gives
    // the file the length it actually plays for. MP4 needs none of this — it
    // adds the last sample's own duration.
    if (encoding.container === 'webm') {
      drawContained(ctx, bitmaps[sequence[sequence.length - 1]], width, height);
      const tail = new VideoFrame(canvas, {
        timestamp: sequence.length * frameDuration,
        duration: frameDuration,
      });
      encoder.encode(tail);
      tail.close();
    }
    await encoder.flush();
    if (encodeError) throw encodeError;
  } finally {
    if (encoder.state !== 'closed') encoder.close();
    bitmaps.forEach((bitmap) => bitmap.close());
  }

  muxer.finalize();
  onProgress({ stage: 'done', done: sequence.length, total: sequence.length });
  return {
    blob: new Blob([muxer.target.buffer], { type: `video/${encoding.container}` }),
    extension: encoding.container,
    label: encoding.label,
  };
}
