// The chat box's design, in numbers.
//
// The box is drawn twice: once as DOM (ChatBox.jsx — the real box you type into
// and drop images on) and once on a canvas (scene.js — the frames that go into
// the recorded video). Both read this file, so the video is the box on screen
// rather than something that merely resembles it. When a size changes here,
// it changes in both.
//
// METRICS are CSS pixels at scale 1 — the size the box has in a browser window
// LAYOUT_WIDTH wide. The recording multiplies every one of them by
// `frame width / layout width` (see scene.js), which is what makes a 1080×1920
// frame crisp rather than an upscaled screenshot — and what decides how big the
// box reads in it.
//
// The layout width is the whole of that decision. Lay the box out at 400 and a
// 1080-wide frame scales it 2.7×: phone proportions, the text as big in the
// frame as it is on a phone. Lay it out at 860 and the same frame scales it
// 1.26× and you get a desktop window shrunk into a reel, which is not what
// anybody wants to watch on a phone.

// A DESIGN is a look for the box: colours, fonts and the handful of metrics that
// make one composer feel different from another (corner radius, the send
// button's shape, how big the title is). Three ship — KarmaLab's own, and the
// colours, type and shape of Claude's and ChatGPT's composers (not their
// elements: the box is still this box, with the same attach button, chip and
// send button). COLORS, FONT_* and METRICS below are the KarmaLab design and the
// base every other design overrides, so a design only lists what it changes.
// Both renderers take the chosen design from `resolveDesign()`; nothing outside
// this file knows what any of them look like.

export const COLORS = {
  // The KarmaLab tokens from src/shared/theme.css. Canvas has no CSS variables,
  // so the values are repeated here rather than read from the stylesheet.
  bg: '#000000',
  panel: '#171717',
  panelBorder: '#2a2a2a',
  text: '#ffffff',
  dim: '#8a8a8a',
  accent: '#e44db8',
  accentDim: 'rgba(228, 77, 184, 0.12)',
  // The send button before there is anything to send.
  sendOffBg: '#3a3a3a',
  sendOffFg: '#6a6a6a',
  // The arrow (or spinner) on the send button once there is something to send.
  sendOnFg: '#000000',
  // The attach button and the chip: their outline, and the outline under the
  // pointer. A design with borderless controls makes the first transparent.
  controlBorder: '#2a2a2a',
  controlHover: '#4a4a4a',
  thumbBg: '#000000',
  thumbBorder: '#3a3a3a',
  shadow: 'rgba(0, 0, 0, 0.45)',
};

export const FONT_SANS = "'Space Grotesk', sans-serif";
export const FONT_MONO = "'JetBrains Mono', monospace";

// The weights and families the canvas needs loaded before it paints anything:
// an unloaded font silently falls back, and the video would ship in Arial.
export const FONT_SPECS = [
  `400 19px ${FONT_SANS}`,
  `400 46px ${FONT_SANS}`,
  `400 13px ${FONT_MONO}`,
];

// Which face each part of the box is set in: the message and its placeholder,
// the small text on the attach button and the chip, and the title above it.
const FONTS = { text: FONT_SANS, chip: FONT_MONO, headline: FONT_SANS };

// The screen the box is laid out on, in CSS pixels: a phone, by default, which
// is what a reel is watched on.
export const DEFAULT_LAYOUT_WIDTH = 400;
export const LAYOUT_WIDTH_LIMITS = [240, 1400];

// Change a number here and it changes in both renderers — the box on screen
// takes its sizes from this object too (ChatBox.jsx), so there is nowhere for
// the two to drift apart.
export const METRICS = {
  radius: 26,
  padTop: 18,
  padRight: 14,
  padBottom: 14,
  padLeft: 18,
  // Between the attachment strip, the text and the controls row.
  gap: 14,
  fontSize: 19,
  lineHeight: 27,
  // The text area is one line tall even when empty.
  minTextHeight: 30,
  // Past this the box stops growing and shows the end of the message, the way
  // the real composer scrolls.
  maxTextLines: 7,
  caretWidth: 2,
  thumb: 116,
  thumbRadius: 16,
  thumbGap: 8,
  control: 34,
  pillRadius: 17,
  // The send button's corner radius: half of `control` is a circle.
  sendRadius: 17,
  chipFontSize: 13,
  chipRadius: 16,
  chipPadX: 12,
  chipGap: 8,
  // The pill's own padding, which the canvas draws and the DOM pill wears.
  pillPadLeft: 10,
  pillPadRight: 14,
  pillGap: 7,
  iconSize: 16,
  sendIconSize: 16,
  chevronSize: 10,
  headlineFontSize: 46,
  headlineGap: 32,
  shadowBlur: 40,
  shadowOffsetY: 8,
};

// The icons, as 24×24 stroke paths. The DOM renders them in an <svg>, the
// canvas turns the same strings into a Path2D — one shape, two renderers.
export const ICONS = {
  clip: 'M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48',
  chevron: 'M6 9l6 6 6-6',
  arrowUp: 'M12 19V5M5 12l7-7 7 7',
  close: 'M18 6L6 18M6 6l12 12',
  image:
    'M3 5a2 2 0 012-2h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2z M3 16l4.5-4.5a2 2 0 012.8 0L15 16 M14 12l1.5-1.5a2 2 0 012.8 0L21 13',
};

// What the box says when it is empty and what the chip under it is called.
// Both are settings in the studio; these are what it opens on.
export const DEFAULT_PLACEHOLDER = 'How can I help you today?';
export const DEFAULT_HEADLINE = 'Hi Karma!';
export const DEFAULT_MODEL_CHIP = 'Labrador 4.6';

// ----- designs -------------------------------------------------------------

// Anthropic's faces ship with the app (src/shared/theme.css declares them), so
// the box and the canvas both have them. ChatGPT is set in the system's UI font,
// which is what chatgpt.com does too.
const ANTHROPIC_SANS = "'Anthropic Sans', system-ui, sans-serif";
const ANTHROPIC_SERIF = "'Anthropic Serif', Georgia, serif";
const SYSTEM_UI =
  "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

// Colours were sampled from a dark-mode screenshot of each product's composer.
export const DESIGNS = {
  karma: {
    label: 'KarmaLab',
    colors: {},
    fonts: {},
    metrics: {},
  },
  claude: {
    label: 'Claude',
    // Warm greys and the orange of its spark. The controls have no outline.
    colors: {
      bg: '#151515',
      panel: '#20201f',
      panelBorder: '#363635',
      text: '#f0efec',
      dim: '#898782',
      accent: '#cc7c5e',
      accentDim: 'rgba(204, 124, 94, 0.14)',
      sendOffBg: '#363635',
      sendOffFg: '#898782',
      sendOnFg: '#ffffff',
      controlBorder: 'transparent',
      controlHover: '#404040',
      thumbBorder: '#363635',
      shadow: 'rgba(0, 0, 0, 0.28)',
    },
    fonts: { text: ANTHROPIC_SANS, chip: ANTHROPIC_SANS, headline: ANTHROPIC_SERIF },
    // A softer, squarer composer and a rounded-square send button; the title is
    // the serif and wants room.
    metrics: {
      radius: 22,
      pillRadius: 9,
      chipRadius: 9,
      sendRadius: 9,
      chipFontSize: 14,
      headlineFontSize: 42,
      headlineGap: 34,
      shadowBlur: 24,
      shadowOffsetY: 4,
    },
  },
  chatgpt: {
    label: 'ChatGPT',
    // Black, a charcoal pill and a blue send button. The controls have no outline.
    colors: {
      bg: '#000000',
      panel: '#1b1b1b',
      panelBorder: '#292929',
      text: '#ededed',
      dim: '#afafaf',
      accent: '#3c66bf',
      accentDim: 'rgba(60, 102, 191, 0.16)',
      sendOffBg: '#303030',
      sendOffFg: '#8a8a8a',
      sendOnFg: '#ffffff',
      controlBorder: 'transparent',
      controlHover: '#3a3a3a',
      thumbBorder: '#292929',
      shadow: 'rgba(0, 0, 0, 0)',
    },
    fonts: { text: SYSTEM_UI, chip: SYSTEM_UI, headline: SYSTEM_UI },
    // A pill that stays a pill as it grows: a radius that big reads round on a
    // box this short.
    metrics: {
      radius: 30,
      padLeft: 22,
      pillRadius: 17,
      chipRadius: 17,
      chipFontSize: 14,
      headlineFontSize: 36,
      headlineGap: 30,
    },
  },
};

export const DESIGN_IDS = Object.keys(DESIGNS);
export const DEFAULT_DESIGN = 'karma';

// An unknown id (a setting left over from a design that no longer exists) is the
// default design rather than an error.
export const normalizeDesign = (id) => (DESIGNS[id] ? id : DEFAULT_DESIGN);

// A design with everything filled in from the KarmaLab base: what the DOM box
// and the painter actually read. `fontSpecs` is what the canvas has to have
// loaded before the first frame — a face that is not loaded falls back silently.
export function resolveDesign(id) {
  const key = normalizeDesign(id);
  const design = DESIGNS[key];
  const colors = { ...COLORS, ...design.colors };
  const fonts = { ...FONTS, ...design.fonts };
  const metrics = { ...METRICS, ...design.metrics };
  const fontSpecs = [
    `400 ${metrics.fontSize}px ${fonts.text}`,
    `400 ${metrics.headlineFontSize}px ${fonts.headline}`,
    `400 ${metrics.chipFontSize}px ${fonts.chip}`,
  ];
  return { id: key, label: design.label, colors, fonts, metrics, fontSpecs };
}
