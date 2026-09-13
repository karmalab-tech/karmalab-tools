// The typing sound, cut to the recording's own timeline.
//
// The sound is a set of short clips of a real keyboard — one per burst of
// typing (src/apps/chatBox/typing/, see sequences.js) — and a recording is laid
// out from them like this: wherever characters are landing, one of the clips is
// picked at random and played under them; wherever they are not, there is
// nothing. So the three things the sound has to do fall out of the arrangement
// rather than out of gating:
//
//   • **Only while typing.** A clip exists only under a run of keystrokes. The
//     beat before typing, the images dropping in, a breath at a full stop, the
//     pause before the send and the whole wait after it are silent.
//   • **In time with it.** Every clip is played from its own first keystroke
//     (`leadMs`, found by the onset detector when it is decoded), not from the
//     top of the file — a clip that opens with half a second of room tone would
//     otherwise put that half second under the first characters. The far end is
//     cut the same way: the audio stops a beat after the last character rather
//     than ringing on into the pause.
//   • **Never the same part twice.** Clips are picked without replacement until
//     they run out, so a recording is made of different bursts of typing, and
//     two recordings of the same message do not sound alike.
//
// All of it is pure array maths over Float32Arrays — no AudioContext, so the
// arrangement is unit-tested in node. Only `decodeClip` needs a browser.

// The envelope's resolution, and so the resolution of an onset.
export const ONSET_WINDOW_MS = 10;

// How long the sound carries on after the last character of a run. Enough for
// the keystroke to ring out, little enough that the silence lands with the
// pause rather than after it.
export const RUN_TAIL_MS = 110;

// Two keystrokes further apart than this (plus the tail) are two runs: typing
// through a sentence sounds continuous, a stop between sentences is a stop.
export const MERGE_GAP_MS = 70;

// A moment of the clip before its first keystroke, so the attack is not clipped.
export const PRE_ROLL_MS = 8;

// Ramps at the ends of every piece of audio placed: the clips are cut wherever
// the timeline says, and a hard edge is a click of its own.
export const FADE_IN_MS = 3;
export const FADE_OUT_MS = 18;

// RMS in `windowMs` slices — the shape of a clip, at a resolution where a
// keystroke is a few windows wide.
export function rmsEnvelope(samples, sampleRate, windowMs = ONSET_WINDOW_MS) {
  const win = Math.max(1, Math.round((windowMs / 1000) * sampleRate));
  const out = new Float32Array(Math.floor(samples.length / win));
  for (let w = 0; w < out.length; w++) {
    let sum = 0;
    for (let i = w * win; i < (w + 1) * win; i++) sum += samples[i] * samples[i];
    out[w] = Math.sqrt(sum / win);
  }
  return out;
}

// Where the keystrokes are in a clip, in milliseconds. The threshold comes from
// the clip's own levels (a quiet recording and a loud one both work), and the
// detector re-arms only once the level has dropped well under it, so one
// keystroke is one onset rather than three.
export function findOnsets(envelope, windowMs = ONSET_WINDOW_MS) {
  if (!envelope.length) return [];
  const sorted = Array.from(envelope).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const p90 = sorted[Math.floor(sorted.length * 0.9)];
  const threshold = Math.max(median * 4, p90 * 0.35);
  if (threshold <= 0) return [];

  const onsets = [];
  let armed = true;
  for (let i = 0; i < envelope.length; i++) {
    if (armed && envelope[i] > threshold) {
      onsets.push(i * windowMs);
      armed = false;
    } else if (envelope[i] < threshold * 0.5) {
      armed = true;
    }
  }
  return onsets;
}

// Where a clip's typing actually starts, and how much of it there is from
// there. Anything before the first keystroke is room tone and is never played.
export function clipTiming(samples, sampleRate) {
  const durationMs = (samples.length / sampleRate) * 1000;
  const onsets = findOnsets(rmsEnvelope(samples, sampleRate));
  const leadMs = onsets.length ? Math.max(0, onsets[0] - PRE_ROLL_MS) : 0;
  return { durationMs, leadMs, keystrokes: onsets.length, usableMs: durationMs - leadMs };
}

// The stretches of the recording where characters are landing: one per burst of
// keystrokes, merged when they run together, and never past the send.
export function typingRuns(plan, { tailMs = RUN_TAIL_MS, mergeGapMs = MERGE_GAP_MS } = {}) {
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

// Pick clips without replacement, reshuffling only once they have all been
// used — so a recording is different bursts of typing, and only a very long one
// hears any of them twice. `random` is injected, which is what makes an
// arrangement reproducible in a test.
function picker(count, random) {
  let bag = [];
  let used = 0;
  return () => {
    if (!bag.length) {
      bag = Array.from({ length: count }, (_, i) => i);
      used += 1;
    }
    const index = Math.min(bag.length - 1, Math.floor(random() * bag.length));
    return { clip: bag.splice(index, 1)[0], round: used };
  };
}

// Which clip plays where. Each run is filled from its start with whole clips
// (played from their first keystroke), a fresh one each time it needs more, and
// the last of them is cut off when the run ends. `wrapped` says the typing ran
// through every clip and started reusing them.
export function arrangeClips(runs, clips, random = Math.random) {
  if (!clips.length) return { segments: [], wrapped: false };
  const next = picker(clips.length, random);
  const segments = [];
  let wrapped = false;

  for (const run of runs) {
    let at = run.startMs;
    while (at < run.endMs) {
      const { clip, round } = next();
      if (round > 1) wrapped = true;
      const available = clips[clip].usableMs;
      if (available <= 0) break;
      const durationMs = Math.min(available, run.endMs - at);
      segments.push({ atMs: at, clip, offsetMs: clips[clip].leadMs, durationMs });
      at += durationMs;
    }
  }
  return { segments, wrapped };
}

// The finished audio track: silence everywhere except the segments, each faded
// in quickly and out gently. `clips` are { samples, sampleRate } at the rate the
// track is encoded at. Segments are added rather than written over each other,
// so a fade-out and the next fade-in cannot cut each other off.
export function renderTrack(clips, segments, totalMs, sampleRate) {
  const out = new Float32Array(Math.max(1, Math.ceil((totalMs / 1000) * sampleRate)));
  const inRamp = Math.max(1, Math.round((FADE_IN_MS / 1000) * sampleRate));
  const outRamp = Math.max(1, Math.round((FADE_OUT_MS / 1000) * sampleRate));

  for (const segment of segments) {
    const source = clips[segment.clip];
    if (!source) continue;
    const at = Math.round((segment.atMs / 1000) * sampleRate);
    const from = Math.round((segment.offsetMs / 1000) * sampleRate);
    if (at < 0 || from < 0) continue;
    const length = Math.min(
      Math.round((segment.durationMs / 1000) * sampleRate),
      source.samples.length - from,
      out.length - at
    );
    if (length <= 0) continue;
    const rampIn = Math.min(inRamp, Math.floor(length / 2));
    const rampOut = Math.min(outRamp, Math.floor(length / 2));
    for (let i = 0; i < length; i++) {
      let gain = 1;
      if (i < rampIn) gain = i / rampIn;
      else if (i >= length - rampOut) gain = (length - 1 - i) / rampOut;
      out[at + i] += source.samples[from + i] * gain;
    }
  }
  return out;
}

// Decode one clip to a single channel at the rate the encoder wants, and find
// where its typing starts there and then. `decodeAudioData` resamples to the
// context's rate, so nothing here has to. Browser only; returns null for
// anything that will not decode.
export async function decodeClip(arrayBuffer, sampleRate, name = '') {
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
      name,
      samples,
      sampleRate: buffer.sampleRate,
      ...clipTiming(samples, buffer.sampleRate),
    };
  } catch {
    return null;
  }
}

// Everything the recorder needs to lay the sound under a plan, or null when
// there is nothing to play: no clips, or a message with no characters in it.
export function typingTrack(clips, plan, totalMs, random = Math.random) {
  if (!clips?.length || !plan.times.length) return null;
  const runs = typingRuns(plan);
  if (!runs.length) return null;
  const { segments, wrapped } = arrangeClips(runs, clips, random);
  if (!segments.length) return null;
  const sampleRate = clips[0].sampleRate;
  return {
    samples: renderTrack(clips, segments, totalMs, sampleRate),
    sampleRate,
    wrapped,
    runs: runs.length,
    segments: segments.length,
  };
}
