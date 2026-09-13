// Recording the chat box into a video file, in the browser.
//
// Every frame is painted by scene.js at the target resolution and handed
// straight to a WebCodecs encoder (src/shared/videoEncode.js) — there is no
// screen capture, no real-time playback and nothing uploaded, so a 20-second
// 1080×1920 reel takes as long as the encoder takes rather than 20 seconds, and
// the text in it is as crisp as the resolution allows.
//
// timeline.js decides what the box looks like at each moment; this walks the
// frames, paints them and muxes the result. No automated coverage — node has no
// canvas and no WebCodecs — so the arithmetic lives in timeline.js and scene.js
// where it can be tested, and the picture is checked by watching it.

import {
  createMuxer,
  drainEncoder,
  motionBitrate,
  pickEncoding,
  videoSupport,
} from '../../shared/videoEncode.js';
import { buildScene, ensureFonts, paintFrame } from './scene.js';
import { stateAt } from './timeline.js';

export { videoSupport };

// A keyframe every couple of seconds: enough for a player to scrub, few enough
// that a nearly-still scene stays small.
const KEYFRAME_SECONDS = 2;

// Attachments arrive as data URIs (the box holds what was dropped on it) and
// have to be decoded before the first frame — a frame is only drawing.
async function decodeAttachments(attachments) {
  const images = [];
  for (const attachment of attachments) {
    try {
      const resp = await fetch(attachment.dataUri);
      images.push(await createImageBitmap(await resp.blob()));
    } catch {
      /* an image that will not decode is left out rather than failing the run */
    }
  }
  return images;
}

// Record the box. `plan` comes from planRecording(); the rest is what the box
// looks like. Resolves to { blob, extension, label, durationMs }, or
// { cancelled: true } if `shouldStop` asked it to stop part-way.
export async function recordChatBox({
  width,
  height,
  boxWidthPct,
  background,
  headline,
  placeholder,
  modelChip,
  attachments = [],
  plan,
  onProgress = () => {},
  shouldStop = () => false,
}) {
  if (!videoSupport()) throw new Error('This browser cannot encode video.');

  onProgress({ stage: 'preparing', done: 0, total: plan.frameCount });
  await ensureFonts();
  const images = await decodeAttachments(attachments);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });

  const scene = buildScene(ctx, {
    width,
    height,
    boxWidthPct,
    background,
    headline,
    placeholder,
    modelChip,
    attachments: images,
    finalText: plan.chars.join(''),
  });

  const bitrate = motionBitrate(width, height, plan.fps);
  const encoding = await pickEncoding(width, height, plan.fps, bitrate);
  if (!encoding) throw new Error('This browser has no video encoder for a frame this size.');

  const muxer = await createMuxer(encoding, width, height, plan.fps);
  let encodeError = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (err) => {
      encodeError = err;
    },
  });
  encoder.configure({ codec: encoding.codec, width, height, bitrate, framerate: plan.fps });

  const frameDuration = 1_000_000 / plan.fps; // microseconds
  const keyEvery = Math.max(1, Math.round(plan.fps * KEYFRAME_SECONDS));
  let cancelled = false;

  try {
    for (let i = 0; i < plan.frameCount; i++) {
      if (encodeError) throw encodeError;
      if (shouldStop()) {
        cancelled = true;
        break;
      }
      if (i % 5 === 0) onProgress({ stage: 'recording', done: i, total: plan.frameCount });
      paintFrame(ctx, scene, stateAt((i * 1000) / plan.fps, plan));
      const frame = new VideoFrame(canvas, {
        timestamp: Math.round(i * frameDuration),
        duration: Math.round(frameDuration),
      });
      encoder.encode(frame, { keyFrame: i % keyEvery === 0 });
      frame.close();
      await drainEncoder(encoder);
    }

    if (!cancelled) {
      // WebM's segment duration comes from the last block's timestamp alone
      // (webm-muxer ignores its BlockDuration), so without one more frame at
      // the very end the file claims to be a frame short and players cut it
      // off. MP4 needs none of this — it adds the last sample's own duration.
      if (encoding.container === 'webm') {
        const tail = new VideoFrame(canvas, {
          timestamp: Math.round(plan.frameCount * frameDuration),
          duration: Math.round(frameDuration),
        });
        encoder.encode(tail);
        tail.close();
      }
      await encoder.flush();
      if (encodeError) throw encodeError;
    }
  } finally {
    if (encoder.state !== 'closed') encoder.close();
    images.forEach((image) => image.close?.());
  }

  if (cancelled) return { cancelled: true };

  muxer.finalize();
  onProgress({ stage: 'done', done: plan.frameCount, total: plan.frameCount });
  return {
    blob: new Blob([muxer.target.buffer], { type: `video/${encoding.container}` }),
    extension: encoding.container,
    label: encoding.label,
    durationMs: plan.totalMs,
  };
}
