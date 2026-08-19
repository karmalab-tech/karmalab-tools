// MP4/MOV frame source: demuxes the file with mp4box.js and decodes it with
// WebCodecs VideoDecoder, yielding VideoFrames much faster than realtime.
// Audio (AAC) samples are collected untouched so the sink can pass them
// through to the output file without re-encoding.
//
// The file is read in slices and demuxing pauses while the sample queue is
// deep, so memory stays bounded even for long videos.
//
// Rotation metadata (phone footage): decoders output unrotated frames because
// rotation lives in the container's track matrix, so it's read from there and
// baked in — each decoded frame is drawn rotated onto a canvas and re-wrapped,
// and the reported width/height are the display (rotated) dimensions.

import { createFile, DataStream, Endianness, MP4BoxBuffer } from 'mp4box';

const READ_CHUNK = 4 << 20; // 4 MB file slices
const SAMPLE_HIGH_WATER = 300; // pause demuxing above this many queued samples

// avcC / hvcC box payload (without the 8-byte box header) — the `description`
// VideoDecoder needs for H.264/H.265. VP8/VP9/AV1 must NOT get one.
function videoDescription(trak) {
  for (const entry of trak.mdia.minf.stbl.stsd.entries) {
    const box = entry.avcC || entry.hvcC;
    if (box) {
      const stream = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
      box.write(stream);
      return new Uint8Array(stream.buffer, 8);
    }
  }
  return undefined;
}

// Clockwise display rotation (0/90/180/270) from the track's transformation
// matrix (16.16 fixed point: [a, b, u, c, d, v, x, y, w]).
function trackRotation(track) {
  const m = track.matrix;
  if (!m) return 0;
  const a = m[0] / 65536;
  const b = m[1] / 65536;
  const deg = ((Math.round((Math.atan2(b, a) * 180) / Math.PI) % 360) + 360) % 360;
  return deg === 90 || deg === 180 || deg === 270 ? deg : 0;
}

// AudioSpecificConfig from the esds box — the decoderConfig.description the
// muxer stores for passed-through AAC. Best effort: audio is skipped on failure.
function audioSpecificConfig(trak) {
  try {
    const entry = trak.mdia.minf.stbl.stsd.entries.find((e) => e.esds);
    const descs = entry.esds.esd.descs.flatMap((d) => [d, ...(d.descs || [])]);
    const dec = descs.find((d) => d.tag === 0x04);
    const dsi = (dec?.descs || []).find((d) => d.tag === 0x05);
    return dsi?.data ? new Uint8Array(dsi.data) : undefined;
  } catch {
    return undefined;
  }
}

export async function createMp4FrameSource(file) {
  if (typeof VideoDecoder === 'undefined') {
    throw new Error('WebCodecs VideoDecoder is not available in this browser.');
  }

  const mp4 = createFile();
  let info = null;
  let parseError = null;
  mp4.onReady = (i) => { info = i; };
  mp4.onError = (module, message) => { parseError = new Error(`MP4 parse error: ${message}`); };

  // Wake everything waiting on demux/decode progress.
  let waiters = [];
  const poke = () => waiters.splice(0).forEach((r) => r());
  const wait = () => Promise.race([
    new Promise((r) => waiters.push(r)),
    new Promise((r) => setTimeout(r, 25)), // safety valve against missed pokes
  ]);

  const videoSamples = [];
  const audioSamples = [];

  // Appends one slice at `off`; returns the position to read next (mp4box may
  // ask to skip ahead, e.g. past boxes it already has).
  const appendAt = async (off) => {
    const end = Math.min(off + READ_CHUNK, file.size);
    const ab = await file.slice(off, end).arrayBuffer();
    const next = mp4.appendBuffer(MP4BoxBuffer.fromArrayBuffer(ab, off));
    return Number.isFinite(next) && next > off ? Math.min(next, file.size) : end;
  };

  // Phase 1: append slices until the moov box is parsed (onReady fires).
  let offset = 0;
  while (!info && !parseError && offset < file.size) offset = await appendAt(offset);
  if (parseError) throw parseError;
  if (!info) throw new Error('Could not parse the file as MP4.');

  const vTrack = info.videoTracks[0];
  if (!vTrack) throw new Error('The file has no video track.');
  const aTrack = info.audioTracks?.find((t) => t.codec?.startsWith('mp4a'));

  const decoderConfig = {
    codec: vTrack.codec,
    codedWidth: vTrack.video.width,
    codedHeight: vTrack.video.height,
    description: videoDescription(mp4.getTrackById(vTrack.id)),
    hardwareAcceleration: 'no-preference',
  };
  const support = await VideoDecoder.isConfigSupported(decoderConfig).catch(() => null);
  if (!support?.supported) {
    throw new Error(`This browser cannot decode ${vTrack.codec} via WebCodecs.`);
  }

  const duration = (vTrack.movie_duration || info.duration) / (vTrack.movie_timescale || info.timescale);
  const frameCount = vTrack.nb_samples;
  const fps = frameCount / (vTrack.duration / vTrack.timescale || duration || 1);

  const rotation = trackRotation(vTrack);
  const codedW = vTrack.video.width;
  const codedH = vTrack.video.height;
  const outW = rotation % 180 ? codedH : codedW;
  const outH = rotation % 180 ? codedW : codedH;

  const audio = aTrack
    ? {
        codec: aTrack.codec,
        sampleRate: aTrack.audio.sample_rate,
        numberOfChannels: aTrack.audio.channel_count,
        description: audioSpecificConfig(mp4.getTrackById(aTrack.id)),
        timescale: aTrack.timescale,
        samples: audioSamples,
      }
    : null;

  mp4.onSamples = (id, user, samples) => {
    const list = user === 'video' ? videoSamples : audioSamples;
    for (const s of samples) {
      // Keep our own reference to the bytes: releaseUsedSamples below tells
      // mp4box to forget its copy (freeing its buffers), nulling s.data.
      list.push({ data: s.data, cts: s.cts, duration: s.duration, is_sync: s.is_sync });
    }
    mp4.releaseUsedSamples(id, samples[samples.length - 1].number);
    poke();
  };
  mp4.setExtractionOptions(vTrack.id, 'video', { nbSamples: 25 });
  if (audio) mp4.setExtractionOptions(aTrack.id, 'audio', { nbSamples: 200 });
  mp4.start();

  // mp4box frees media-data buffers it has parsed past, so anything appended
  // before extraction was configured is gone — seek back to the start and
  // re-append media data from the position it asks for (for faststart files,
  // right where the samples begin).
  let pumpOffset = 0;
  try { pumpOffset = mp4.seek(0, true).offset || 0; } catch { pumpOffset = 0; }

  // Phase 2: append in the background, pausing while the queue is deep.
  let stopPump = false;
  let pumpDone = false;
  const pump = (async () => {
    try {
      let off = pumpOffset;
      while (off < file.size && !stopPump) {
        off = await appendAt(off);
        while (videoSamples.length > SAMPLE_HIGH_WATER && !stopPump) await wait();
      }
      if (!stopPump) mp4.flush();
    } catch (e) {
      parseError = e;
    }
    pumpDone = true;
    poke();
  })();

  const vTimescale = vTrack.timescale;

  // Bake the container rotation into the pixels so consumers never see it.
  let rotCanvas = null;
  let rotCtx = null;
  const orient = (frame) => {
    if (!rotation) return frame;
    if (!rotCanvas) {
      rotCanvas =
        typeof OffscreenCanvas !== 'undefined'
          ? new OffscreenCanvas(outW, outH)
          : Object.assign(document.createElement('canvas'), { width: outW, height: outH });
      rotCtx = rotCanvas.getContext('2d');
    }
    rotCtx.save();
    rotCtx.translate(outW / 2, outH / 2);
    rotCtx.rotate((rotation * Math.PI) / 180);
    rotCtx.drawImage(frame, -codedW / 2, -codedH / 2);
    rotCtx.restore();
    const rotated = new VideoFrame(rotCanvas, {
      timestamp: frame.timestamp,
      duration: frame.duration ?? undefined,
    });
    frame.close();
    return rotated;
  };

  async function* frames(signal) {
    const out = [];
    let decodeError = null;
    const decoder = new VideoDecoder({
      output: (f) => { out.push(f); poke(); },
      error: (e) => { decodeError = e; poke(); },
    });
    decoder.configure(decoderConfig);
    let flushed = false;
    try {
      for (;;) {
        if (signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError');
        if (decodeError) throw decodeError;
        if (parseError) throw parseError;
        // Feed while the decoder has room and we're not sitting on many outputs.
        while (videoSamples.length && decoder.decodeQueueSize < 16 && out.length < 8) {
          const s = videoSamples.shift();
          decoder.decode(new EncodedVideoChunk({
            type: s.is_sync ? 'key' : 'delta',
            timestamp: Math.round((s.cts * 1e6) / vTimescale),
            duration: Math.round((s.duration * 1e6) / vTimescale),
            data: s.data,
          }));
          poke(); // the pump may be waiting for the sample queue to drain
        }
        if (out.length) { yield orient(out.shift()); continue; }
        if (pumpDone && !videoSamples.length && !decodeError) {
          if (!flushed) { flushed = true; await decoder.flush().catch(() => {}); continue; }
          if (!out.length) break;
        }
        await wait();
      }
    } finally {
      out.forEach((f) => f.close());
      try { decoder.close(); } catch { /* already closed */ }
    }
  }

  return {
    kind: 'webcodecs',
    width: outW,
    height: outH,
    rotation,
    fps,
    frameCount,
    duration,
    audio,
    frames,
    // Audio samples finish collecting when the whole file has been demuxed.
    waitDemuxDone: () => pump,
    close() { stopPump = true; poke(); },
  };
}
