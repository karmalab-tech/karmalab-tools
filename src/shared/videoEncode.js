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

// One audio codec per container: AAC is what an MP4 carries, Opus is what a
// WebM carries. A browser can have a video encoder and no audio encoder (or
// H.264 and no AAC), so this is probed the same way the video is.
export const AUDIO_ENCODINGS = {
  mp4: { codec: 'mp4a.40.2', muxerCodec: 'aac', label: 'AAC' },
  webm: { codec: 'opus', muxerCodec: 'A_OPUS', label: 'Opus' },
};

// Opus is defined at 48 kHz; AAC takes it too, so one rate serves both.
export const AUDIO_SAMPLE_RATE = 48000;
export const AUDIO_BITRATE = 128000;

// Whether this browser can encode a video here at all.
export const videoSupport = () =>
  typeof VideoEncoder !== 'undefined' &&
  typeof VideoFrame !== 'undefined' &&
  typeof createImageBitmap === 'function';

export const audioSupport = () =>
  typeof AudioEncoder !== 'undefined' && typeof AudioData !== 'undefined';

// Whether this browser will encode audio for that container.
export async function pickAudioEncoding(
  container,
  { sampleRate = AUDIO_SAMPLE_RATE, channels = 1 } = {}
) {
  const encoding = AUDIO_ENCODINGS[container];
  if (!encoding || !audioSupport()) return null;
  try {
    const support = await AudioEncoder.isConfigSupported({
      codec: encoding.codec,
      sampleRate,
      numberOfChannels: channels,
      bitrate: AUDIO_BITRATE,
    });
    return support.supported ? encoding : null;
  } catch {
    return null;
  }
}

// The first encoding this browser will take at these dimensions, or null if it
// has a VideoEncoder but nothing behind it that can encode this. `containers`
// narrows the list — the chat box recorder uses it to look for a container
// whose audio codec this browser also has.
export async function pickEncoding(width, height, framerate, bitrate, { containers } = {}) {
  if (!videoSupport()) return null;
  const rate = bitrate || stillBitrate(width, height);
  for (const encoding of ENCODINGS.filter((e) => !containers || containers.includes(e.container))) {
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
// only the container and the codec name differ. `audio` adds a second track:
// { muxerCodec, sampleRate, numberOfChannels }, or nothing for a silent file.
export async function createMuxer({ container, muxerCodec }, width, height, frameRate, audio) {
  const { Muxer, ArrayBufferTarget } =
    container === 'mp4' ? await import('mp4-muxer') : await import('webm-muxer');
  return new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: muxerCodec, width, height, frameRate },
    ...(audio
      ? {
          audio: {
            codec: audio.muxerCodec,
            sampleRate: audio.sampleRate,
            numberOfChannels: audio.numberOfChannels,
          },
        }
      : {}),
    // MP4 only: puts the index at the front of the file, so the video can be
    // played and scrubbed straight from disk without a server.
    ...(container === 'mp4' ? { fastStart: 'in-memory' } : {}),
  });
}

// Feed a finished mono track to an AudioEncoder in bites, so a long recording
// doesn't hand the encoder one enormous AudioData.
export async function encodeAudioTrack(muxer, { codec }, { samples, sampleRate }) {
  let encodeError = null;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: (err) => {
      encodeError = err;
    },
  });
  encoder.configure({ codec, sampleRate, numberOfChannels: 1, bitrate: AUDIO_BITRATE });

  const chunk = Math.round(sampleRate / 10); // 100ms at a time
  for (let offset = 0; offset < samples.length; offset += chunk) {
    if (encodeError) throw encodeError;
    const slice = samples.subarray(offset, Math.min(offset + chunk, samples.length));
    const data = new AudioData({
      format: 'f32-planar',
      sampleRate,
      numberOfFrames: slice.length,
      numberOfChannels: 1,
      timestamp: Math.round((offset / sampleRate) * 1_000_000),
      // A copy: AudioData takes ownership of the buffer it is given.
      data: new Float32Array(slice),
    });
    encoder.encode(data);
    data.close();
    while (encoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 5));
  }
  await encoder.flush();
  encoder.close();
  if (encodeError) throw encodeError;
}

// Keep the encoder fed without letting an unbounded queue of full-size frames
// pile up in memory.
export async function drainEncoder(encoder, max = 4) {
  while (encoder.encodeQueueSize > max) await new Promise((r) => setTimeout(r, 10));
}
