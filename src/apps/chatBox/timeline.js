// What happens, and when, in a chat box recording.
//
// A recording is four stretches of time: an empty box for a beat, the message
// typed a character at a time, a pause with the message sitting there, then the
// send — after which the button spins for a few seconds and that is the video.
//
// This module is the whole of that, and it is pure: `planRecording` turns the
// settings into a plan (when each character lands, when the send happens, how
// long the video is) and `stateAt` answers what the box looks like at a given
// millisecond. The recorder (record.js) only walks frames and hands each state
// to the painter, and the preview in the studio plays the same plan through the
// real DOM box — so both are the same animation, and this is the part that can
// be tested without a browser.

export const DEFAULTS = {
  // ~14 characters a second is a brisk but human pace (≈170 words a minute).
  cps: 14,
  startDelayMs: 700,
  pauseBeforeSendMs: 600,
  waitAfterSendMs: 2500,
  fps: 30,
};

// Each bound is [min, max]; the studio's number boxes are free text, so
// everything is clamped rather than trusted.
export const LIMITS = {
  cps: [1, 60],
  startDelayMs: [0, 10000],
  pauseBeforeSendMs: [0, 10000],
  waitAfterSendMs: [0, 30000],
  fps: [10, 60],
};

// A cursor on for half a second and off for half a second.
export const CARET_PERIOD_MS = 1060;

// Long enough for any reel, short enough that a stray zero in a box can't ask
// the browser to encode an hour of video.
export const MAX_DURATION_MS = 120000;

// A number box is free text: "", "abc" and "-3" are not settings. Returns the
// value clamped into its range, or the fallback when it isn't a number at all.
export function clampSetting(raw, [min, max], fallback) {
  const value = Number.parseFloat(String(raw ?? '').trim());
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

// Deterministic jitter. The same settings produce the same video, which is what
// makes the typing rhythm testable and a re-render reproducible.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// How much longer than an average keystroke to wait *after* typing this
// character. Real typing is not metronomic: it breathes at punctuation and
// stops at the end of a sentence, and a video of a perfectly even typist reads
// as a machine.
function pauseAfter(char) {
  if (char === '\n') return 3;
  if (char === '.' || char === '!' || char === '?') return 3.5;
  if (char === ',' || char === ';' || char === ':') return 1.6;
  return 0;
}

// When each character appears, in milliseconds from the moment typing starts.
// `times[i]` is when character i is on screen, so the count of times at or
// below a moment is the text visible at it.
export function keystrokeTimes(text, cps, seed = 1) {
  const interval = 1000 / cps;
  const rand = mulberry32(seed);
  const times = [];
  let t = 0;
  for (const char of text) {
    // ±40% around the average, so the pace wanders without drifting off it.
    t += interval * (0.6 + rand() * 0.8);
    times.push(t);
    t += interval * pauseAfter(char);
  }
  return times;
}

// The settings, resolved into the shape the recorder and the preview both walk.
export function planRecording({
  text = '',
  cps = DEFAULTS.cps,
  startDelayMs = DEFAULTS.startDelayMs,
  pauseBeforeSendMs = DEFAULTS.pauseBeforeSendMs,
  waitAfterSendMs = DEFAULTS.waitAfterSendMs,
  fps = DEFAULTS.fps,
  seed = 1,
} = {}) {
  const chars = Array.from(text);
  const times = keystrokeTimes(text, cps, seed);
  // The last character is held for one more keystroke before the pause starts,
  // so the message doesn't jump straight from its last letter into the wait.
  const typingMs = times.length ? times[times.length - 1] + 1000 / cps : 0;
  const typingStartMs = startDelayMs;
  const sendAtMs = typingStartMs + typingMs + pauseBeforeSendMs;
  const totalMs = sendAtMs + waitAfterSendMs;
  return {
    chars,
    times,
    fps,
    typingStartMs,
    typingMs,
    sendAtMs,
    totalMs,
    frameCount: Math.max(1, Math.round((totalMs / 1000) * fps)),
  };
}

// How many characters of the message are on screen at `ms`. The times are
// ascending, so this is a scan from wherever the last frame got to — but frames
// are walked in order, so a plain count is cheap enough and keeps this pure.
function charsAt(ms, plan) {
  const since = ms - plan.typingStartMs;
  if (since < 0) return 0;
  let count = 0;
  while (count < plan.times.length && plan.times[count] <= since) count += 1;
  return count;
}

// What the box looks like at a moment: how much of the message is typed, which
// phase it is in, and whether the caret is showing.
//
// The caret sits solid while the characters are landing (a blinking cursor
// under a fast typist looks like a rendering bug), blinks while the box waits,
// and goes away at the send — that, plus the spinner, is what reads as
// "submitted".
export function stateAt(ms, plan) {
  const sending = ms >= plan.sendAtMs;
  const typing = !sending && ms >= plan.typingStartMs && ms < plan.typingStartMs + plan.typingMs;
  const charCount = sending ? plan.chars.length : charsAt(ms, plan);
  const blinkOn = Math.floor(ms / (CARET_PERIOD_MS / 2)) % 2 === 0;
  return {
    ms,
    charCount,
    text: plan.chars.slice(0, charCount).join(''),
    phase: sending ? 'sending' : typing ? 'typing' : charCount ? 'pause' : 'idle',
    sending,
    caretOn: !sending && (typing || blinkOn),
  };
}

export const durationSeconds = (plan) => plan.totalMs / 1000;
