// The typing sound, cut to the recording's own timeline.
//
// A keyboard clip is dropped on the studio and this decides where any of it is
// heard: only while characters are actually landing. The pauses are silent —
// the beat before typing starts, the images landing, a breath at a full stop,
// the pause before the send and the whole wait after it — and no part of the
// clip is used twice, because a cursor walks forward through the source rather
// than restarting it at every keystroke. Run out of clip and it wraps, which is
// the one case where something is heard twice; the studio says so up front
// rather than letting a two-second loop tick away under a ten-second message.
//
// The two halves are split so the arithmetic can be tested in node: `typingRuns`
// and `trackSegments` are pure, and `renderTrack` is plain array maths over a
// Float32Array — it never touches an AudioContext. Only `decodeMono` does, and
// only in the browser.

// How long one keystroke stays audible when nothing follows it closely. Long
// enough to carry the click and its tail, short enough that a pause reads as a
// pause.
export const KEY_TAIL_MS = 170;

// Two keystrokes closer than this are one run of sound: continuous typing
// should sound continuous, not like a stutter of gated clips.
export const MERGE_GAP_MS = 70;

// A short ramp at each end of a run, because the clip is cut at arbitrary
// points and a hard edge is a click.
export const FADE_MS = 6;

// The stretches of the recording where the typing sound is heard: one per burst
// of keystrokes, merged when they run together, and never past the send.
export function typingRuns(plan, { tailMs = KEY_TAIL_MS, mergeGapMs = MERGE_GAP_MS } = {}) {
  const runs = [];
  for (const time of plan.times) {
    const startMs = plan.typingStartMs + time;
    const endMs = Math.min(startMs + tailMs, plan.sendAtMs);
    if (endMs <= startMs) continue;
    const last = runs[runs.length - 1];
    if (last && startMs - last.endMs <= mergeGapMs) last.endMs = Math.max(last.endMs, endMs);
    else runs.push({ startMs, endMs });
  }
  return runs;
}

// Which part of the clip each run plays. The cursor only moves forward, so a
// recording never plays the same moment of the source twice — until the clip is
// shorter than the typing, when it starts over. `wrapped` says whether it had
// to.
export function trackSegments(runs, sourceMs) {
  const segments = [];
  let cursor = 0;
  let wrapped = false;
  for (const run of runs) {
    const wanted = run.endMs - run.startMs;
    if (cursor + wanted > sourceMs) {
      cursor = 0;
      wrapped = wrapped || runs.length > 0;
    }
    const durationMs = Math.min(wanted, sourceMs - cursor);
    if (durationMs <= 0) break;
    segments.push({ atMs: run.startMs, offsetMs: cursor, durationMs });
    cursor += durationMs;
  }
  return { segments, wrapped };
}

// How much of the clip a recording will get through, to compare against its
// length before anything is encoded.
export const neededMs = (runs) => runs.reduce((sum, r) => sum + (r.endMs - r.startMs), 0);

// The finished audio track: silence everywhere except the segments, each faded
// in and out. `source` is { samples, sampleRate } — one channel, already at the
// rate the track is encoded at.
export function renderTrack(source, segments, totalMs) {
  const { samples, sampleRate } = source;
  const out = new Float32Array(Math.max(1, Math.ceil((totalMs / 1000) * sampleRate)));
  const fade = Math.max(1, Math.round((FADE_MS / 1000) * sampleRate));

  for (const segment of segments) {
    const at = Math.round((segment.atMs / 1000) * sampleRate);
    const from = Math.round((segment.offsetMs / 1000) * sampleRate);
    const length = Math.min(
      Math.round((segment.durationMs / 1000) * sampleRate),
      samples.length - from,
      out.length - at
    );
    if (length <= 0) continue;
    const ramp = Math.min(fade, Math.floor(length / 2));
    for (let i = 0; i < length; i++) {
      let gain = 1;
      if (i < ramp) gain = i / ramp;
      else if (i >= length - ramp) gain = (length - 1 - i) / ramp;
      // Runs can only touch at their edges, so adding rather than assigning
      // keeps a fade-out and the next fade-in from cutting each other off.
      out[at + i] += samples[from + i] * gain;
    }
  }
  return out;
}

// Decode an uploaded clip to one channel at the rate the encoder wants.
// `decodeAudioData` resamples to the context's rate, so nothing here has to.
// Browser only — returns null for a file that will not decode.
export async function decodeMono(arrayBuffer, sampleRate) {
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Ctx) return null;
  try {
    const ctx = new Ctx(1, 1, sampleRate);
    const buffer = await ctx.decodeAudioData(arrayBuffer);
    const samples = new Float32Array(buffer.length);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const channel = buffer.getChannelData(c);
      for (let i = 0; i < channel.length; i++) samples[i] += channel[i] / buffer.numberOfChannels;
    }
    return {
      samples,
      sampleRate: buffer.sampleRate,
      durationMs: (buffer.length / buffer.sampleRate) * 1000,
    };
  } catch {
    return null;
  }
}

// Everything the recorder needs to lay the sound under a plan, or null when
// there is nothing to play (no clip, or a message with no characters in it).
export function typingTrack(source, plan, totalMs) {
  if (!source || !source.samples.length) return null;
  const runs = typingRuns(plan);
  if (!runs.length) return null;
  const sourceMs = (source.samples.length / source.sampleRate) * 1000;
  const { segments, wrapped } = trackSegments(runs, sourceMs);
  if (!segments.length) return null;
  return {
    samples: renderTrack(source, segments, totalMs),
    sampleRate: source.sampleRate,
    wrapped,
    neededMs: neededMs(runs),
    sourceMs,
  };
}
