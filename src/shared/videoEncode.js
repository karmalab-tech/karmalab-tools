// Encoding video in the browser, shared by the tools that make one.
//
// Two tools build a video locally rather than fetching one from a model: the
// Image Chain Studio stitches a chain's images into a clip
// (src/apps/imageChain/video.js), and the Chat Box Studio records the chat box
// typing (src/apps/chatBox/record.js). Both draw frames on a canvas, encode
// them with **WebCodecs** and mux the result with `mp4-muxer` or `webm-muxer`
// (imported on demand, like JSZip, so nothing loads until a video is actually
// asked for). Nothing is uploaded and no ffmpeg-sized dependency is shipped —
// the same trust model as the rest of the app.
//
// What differs between them is the frames; what is here is the plumbing they
// share: which encoder this browser actually has, the muxer, and keeping the
// encode queue from growing without bound.
//
// The choice of encoding is not a given. H.264 in MP4 is what every player
// takes, but a Chromium built without proprietary codecs (and Firefox) has
// WebCodecs and no H.264 encoder at all — so the list is probed in order and
// the file is named after whatever came back. The H.264 entries differ only in
// profile/level because a level caps the frame size it accepts (baseline 3.1,
// the one everyone reaches for, is already too small for a 1024×1024 image).

export const ENCODINGS = [
  { codec: 'avc1.640034', container: 'mp4', muxerCodec: 'avc', label: 'MP4 · H.264' },
  { codec: 'avc1.640033', container: 'mp4', muxerCodec: 'avc', label: 'MP4 · H.264' },
  { codec: 'avc1.4d0034', container: 'mp4', muxerCodec: 'avc', label: 'MP4 · H.264' },
  { codec: 'avc1.42e034', container: 'mp4', muxerCodec: 'avc', label: 'MP4 · H.264' },
  { codec: 'avc1.42001f', container: 'mp4', muxerCodec: 'avc', label: 'MP4 · H.264' },
  { codec: 'vp09.00.10.08', container: 'webm', muxerCodec: 'V_VP9', label: 'WebM · VP9' },
  { codec: 'vp8', container: 'webm', muxerCodec: 'V_VP8', label: 'WebM · VP8' },
];

// A few frames a second, each one a completely different image: bitrate is
// about keeping a held still crisp, bounded so a long chain doesn't produce a
// file nobody can send anywhere.
export const stillBitrate = (width, height) =>
  Math.min(24_000_000, Math.max(4_000_000, Math.round(width * height * 8)));

// Motion at a real frame rate, where almost nothing moves between frames (a
// caret, one more character). Far less than a still needs per frame, and it
// keeps a 1080×1920 reel in single-digit megabytes.
export const motionBitrate = (width, height, fps) =>
  Math.min(20_000_000, Math.max(3_000_000, Math.round(width * height * fps * 0.08)));

// Whether this browser can encode a video here at all.
export const videoSupport = () =>
  typeof VideoEncoder !== 'undefined' &&
  typeof VideoFrame !== 'undefined' &&
  typeof createImageBitmap === 'function';

// The first encoding this browser will take at these dimensions, or null if it
// has a VideoEncoder but nothing behind it that can encode this.
export async function pickEncoding(width, height, framerate, bitrate) {
  if (!videoSupport()) return null;
  const rate = bitrate || stillBitrate(width, height);
  for (const encoding of ENCODINGS) {
    try {
      const support = await VideoEncoder.isConfigSupported({
        codec: encoding.codec,
        width,
        height,
        bitrate: rate,
        framerate,
      });
      if (support.supported) return encoding;
    } catch {
      /* an unknown codec string throws rather than reporting unsupported */
    }
  }
  return null;
}

// Both muxers take the same shape of options and hand back an ArrayBuffer, so
// only the container and the codec name differ.
export async function createMuxer({ container, muxerCodec }, width, height, frameRate) {
  const { Muxer, ArrayBufferTarget } =
    container === 'mp4' ? await import('mp4-muxer') : await import('webm-muxer');
  return new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: muxerCodec, width, height, frameRate },
    // MP4 only: puts the index at the front of the file, so the video can be
    // played and scrubbed straight from disk without a server.
    ...(container === 'mp4' ? { fastStart: 'in-memory' } : {}),
  });
}

// Keep the encoder fed without letting an unbounded queue of full-size frames
// pile up in memory.
export async function drainEncoder(encoder, max = 4) {
  while (encoder.encodeQueueSize > max) await new Promise((r) => setTimeout(r, 10));
}
