// The chat box's design, in numbers.
//
// The box is drawn twice: once as DOM (ChatBox.jsx — the real box you type into
// and drop images on) and once on a canvas (scene.js — the frames that go into
// the recorded video). Both read this file, so the video is the box on screen
// rather than something that merely resembles it. When a size changes here,
// it changes in both.
//
// METRICS are CSS pixels at scale 1 — the size the box has in the browser. The
// recording multiplies every one of them by a scale taken from the target
// resolution (see scene.js), which is what makes a 1080×1920 frame crisp rather
// than an upscaled screenshot.

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

export const METRICS = {
  // The box's own width. Everything else is laid out inside it.
  boxWidth: 720,
  radius: 26,
  padTop: 18,
  padRight: 18,
  padBottom: 14,
  padLeft: 22,
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
  thumb: 56,
  thumbRadius: 12,
  thumbGap: 8,
  control: 34,
  pillRadius: 17,
  chipFontSize: 13,
  chipRadius: 16,
  chipPadX: 12,
  chipGap: 8,
  iconSize: 16,
  sendIconSize: 16,
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
