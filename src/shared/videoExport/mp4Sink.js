// MP4 writer: WebCodecs VideoEncoder (hardware where available) + mp4-muxer.
// Tries H.264 first (plays everywhere), then VP9 and AV1 — all legal in MP4.
// AAC audio from an MP4 source is passed through untouched via addRawAudio.

import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

const VIDEO_CODECS = [
  { codec: 'avc1.640034', mux: 'avc' }, // H.264 High 5.2 (up to 4K60)
  { codec: 'vp09.00.51.08', mux: 'vp9' },
  { codec: 'av01.0.08M.08', mux: 'av1' },
];

const defaultBitrate = (width, height, fps) =>
  Math.round(Math.min(80e6, Math.max(4e6, width * height * fps * 0.12)));

export async function createMp4Sink({ width, height, fps, bitrate, audio }) {
  if (typeof VideoEncoder === 'undefined') {
    throw new Error('WebCodecs VideoEncoder is not available in this browser.');
  }
  const rate = Math.round(bitrate ?? defaultBitrate(width, height, fps));
  let chosen = null;
  for (const c of VIDEO_CODECS) {
    const cfg = { codec: c.codec, width, height, bitrate: rate, framerate: fps };
    if (c.mux === 'avc') cfg.avc = { format: 'avc' }; // length-prefixed, as MP4 wants
    const s = await VideoEncoder.isConfigSupported(cfg).catch(() => null);
    if (s?.supported) { chosen = { ...c, cfg }; break; }
  }
  if (!chosen) throw new Error('No MP4 video encoder (H.264/VP9/AV1) is supported by this browser.');

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: chosen.mux, width, height, frameRate: fps },
    audio: audio
      ? { codec: 'aac', numberOfChannels: audio.numberOfChannels, sampleRate: audio.sampleRate }
      : undefined,
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });

  // The muxer needs decoderConfig metadata (VP9's vpcC box even requires a
  // colorSpace), but encoders don't always emit one — normalize with a BT.709
  // default, which is what canvas-rendered frames are.
  const COLOR = { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false };
  let configSent = false;
  const normalizeMeta = (meta = {}) => {
    let dc = meta.decoderConfig;
    if (!dc && !configSent) {
      dc = { codec: chosen.codec, codedWidth: width, codedHeight: height };
    }
    if (dc && !dc.colorSpace?.primaries) dc = { ...dc, colorSpace: COLOR };
    if (dc) configSent = true;
    return dc === meta.decoderConfig ? meta : { ...meta, decoderConfig: dc };
  };

  // Exceptions thrown inside the encoder's output callback would vanish
  // (it's a platform-invoked callback), so capture them and rethrow later.
  let encodeError = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      try {
        muxer.addVideoChunk(chunk, normalizeMeta(meta));
      } catch (e) {
        encodeError = encodeError || e;
      }
    },
    error: (e) => { encodeError = encodeError || e; },
  });
  encoder.configure(chosen.cfg);

  const gop = Math.max(1, Math.round(fps * 2)); // a keyframe every ~2 s
  let added = 0;

  return {
    codec: chosen.codec,

    // Encodes and closes the frame. Awaits when the encoder queue is deep.
    async addFrame(frame) {
      if (encodeError) { frame.close(); throw encodeError; }
      while (encoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 4));
      encoder.encode(frame, { keyFrame: added % gop === 0 });
      added++;
      frame.close();
    },

    // Pass source AAC samples through without re-encoding (MP4 sources only).
    addRawAudio(track) {
      let first = true;
      for (const s of track.samples) {
        const meta = first && track.description
          ? {
              decoderConfig: {
                codec: track.codec,
                sampleRate: track.sampleRate,
                numberOfChannels: track.numberOfChannels,
                description: track.description,
              },
            }
          : undefined;
        muxer.addAudioChunkRaw(
          s.data,
          s.is_sync ? 'key' : 'delta',
          Math.round((s.cts * 1e6) / track.timescale),
          Math.round((s.duration * 1e6) / track.timescale),
          meta
        );
        first = false;
      }
    },

    async finalize() {
      if (encodeError) throw encodeError;
      await encoder.flush();
      if (encodeError) throw encodeError;
      muxer.finalize();
      encoder.close();
      return new Blob([target.buffer], { type: 'video/mp4' });
    },

    abort() {
      try { encoder.close(); } catch { /* already closed */ }
    },
  };
}
