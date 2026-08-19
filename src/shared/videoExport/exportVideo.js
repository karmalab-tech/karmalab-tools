// Offline video export: decode → (optional) per-frame render → encode → MP4.
//
//   const { blob } = await exportVideo({
//     file,                       // the source File/Blob
//     render(frame, timeSec, w, h) → canvas   // optional processing step;
//                                 // omit it to re-encode the video untouched
//     onProgress({ phase, percent, speed }),  // speed = × realtime
//     signal,                     // AbortSignal to cancel
//   });
//
// Runs entirely in the browser. MP4/MOV sources go through the fast WebCodecs
// path (demux + GPU decode, typically several × realtime, original frame
// timing preserved, AAC audio passed through). Other containers fall back to
// seek-based decoding (slower, video only). Output is always MP4, full source
// resolution. Throws if WebCodecs is missing entirely — callers can then fall
// back to realtime MediaRecorder capture.

import { createMp4FrameSource } from './mp4FrameSource.js';
import { createSeekFrameSource } from './seekFrameSource.js';
import { createMp4Sink } from './mp4Sink.js';

const looksLikeMp4 = (file) =>
  /mp4|quicktime|m4v/i.test(file.type || '') || /\.(mp4|mov|m4v)$/i.test(file.name || '');

export async function exportVideo({ file, render, fallbackFps = 30, bitrate, onProgress, signal }) {
  onProgress?.({ phase: 'preparing', percent: 0 });

  let source = null;
  if (looksLikeMp4(file)) {
    try {
      source = await createMp4FrameSource(file);
    } catch (e) {
      console.warn('[videoExport] WebCodecs demux path unavailable, seeking instead:', e.message);
    }
  }
  if (!source) source = await createSeekFrameSource(file, { fps: fallbackFps });

  const { width, height } = source;
  const sink = await createMp4Sink({
    width,
    height,
    fps: Math.min(120, Math.max(1, source.fps || fallbackFps)),
    bitrate,
    audio: source.audio,
  });

  const started = performance.now();
  try {
    for await (const frame of source.frames(signal)) {
      const timeSec = frame.timestamp / 1e6;
      let outFrame = frame;
      if (render) {
        const canvas = render(frame, timeSec, width, height);
        outFrame = new VideoFrame(canvas, {
          timestamp: frame.timestamp,
          duration: frame.duration ?? Math.round(1e6 / (source.fps || fallbackFps)),
        });
        frame.close();
      }
      await sink.addFrame(outFrame);
      const elapsed = (performance.now() - started) / 1000;
      onProgress?.({
        phase: 'rendering',
        percent: Math.min(99, Math.round((timeSec / (source.duration || 1)) * 100)),
        speed: elapsed > 0.2 ? timeSec / elapsed : null,
      });
    }
    if (signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError');

    await source.waitDemuxDone();
    if (source.audio?.samples?.length) {
      try {
        sink.addRawAudio(source.audio);
      } catch (e) {
        console.warn('[videoExport] audio passthrough failed, exporting video only:', e);
      }
    }
    onProgress?.({ phase: 'finalizing', percent: 99 });
    const blob = await sink.finalize();
    onProgress?.({ phase: 'done', percent: 100 });
    return {
      blob,
      extension: 'mp4',
      codec: sink.codec,
      path: source.kind, // 'webcodecs' | 'seek'
      hasAudio: !!(source.audio && source.audio.samples.length),
      width,
      height,
    };
  } catch (e) {
    sink.abort();
    throw e;
  } finally {
    source.close();
  }
}
