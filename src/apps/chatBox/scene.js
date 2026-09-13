// Painting the chat box on a canvas.
//
// The recording is not a screen capture: every frame is drawn here, at the
// target resolution, from the same numbers the DOM box is built from
// (design.js). That is what makes a 1080×1920 reel crisp — the text is laid out
// at 1080 wide rather than scaled up from a 720px screenshot — and it is what
// lets a frame be produced without a visible window, at whatever rate the
// encoder wants rather than in real time.
//
// The geometry is settled once per recording (`buildScene`), against the
// *finished* message, and the box is then drawn from its bottom edge up. So the
// controls row and the send button hold still while the box grows over it, the
// way a real composer does, instead of the whole composition drifting with
// every new line.
//
// Like the rest of the browser-media code in this repo (src/apps/video/frames.js,
// src/apps/imageChain/video.js) the painting itself has no automated coverage —
// node has no canvas — so the parts that are arithmetic (the frame size, the
// layout, the line wrapping) are exported separately and unit-tested, and the
// picture is checked by looking at it.

import {
  COLORS,
  DEFAULT_LAYOUT_WIDTH,
  FONT_MONO,
  FONT_SANS,
  FONT_SPECS,
  ICONS,
  METRICS,
} from './design.js';

// The shapes a reel, a post or a YouTube still is cut to. Anything else is
// typed in by hand.
export const RESOLUTION_PRESETS = [
  { label: 'Reel / TikTok · 1080×1920', width: 1080, height: 1920 },
  { label: 'Portrait post · 1080×1350', width: 1080, height: 1350 },
  { label: 'Square · 1080×1080', width: 1080, height: 1080 },
  { label: 'Landscape · 1920×1080', width: 1920, height: 1080 },
  { label: 'Story, light · 720×1280', width: 720, height: 1280 },
];

export const SIZE_LIMITS = [240, 2560];
export const BOX_WIDTH_LIMITS = [40, 100];
// Nearly the full width of the screen it is laid out on, the way a composer
// sits on a phone.
export const DEFAULT_BOX_WIDTH_PCT = 90;

// How much every metric is multiplied by to fill the frame: a 1080-wide
// recording of a 400-wide layout is drawn at 2.7×.
export const sceneScale = (frameWidth, layoutWidth = DEFAULT_LAYOUT_WIDTH) =>
  frameWidth / Math.max(1, layoutWidth);

// The box's width in CSS pixels — what the DOM box on the studio's stage is
// given — and in frame pixels, which is the same thing scaled.
export const boxCssWidth = (layoutWidth, boxWidthPct) =>
  Math.round((layoutWidth * boxWidthPct) / 100);

// H.264 wants even dimensions, and a resolution box is free text. Returns a
// usable even size inside the limits, or the fallback when it is not a number.
export function parseSize(raw, fallback) {
  const value = Number.parseInt(String(raw ?? '').trim(), 10);
  if (!Number.isFinite(value)) return fallback;
  const clamped = Math.min(SIZE_LIMITS[1], Math.max(SIZE_LIMITS[0], value));
  return clamped - (clamped % 2);
}

export const resolutionLabel = (width, height) => `${width}×${height}`;

// The download's filename stem, per run.
export const recordingBasename = (width, height) => `karmalab-chat-box-${width}x${height}`;

// …and its extension, from the type of the file that came out. Which container
// a recording is in depends on what the browser could encode (WebM on a
// Chromium without H.264), so the name follows the file rather than assuming.
export const extensionForType = (type) => (String(type || '').includes('webm') ? 'webm' : 'mp4');

// Load the fonts the canvas is about to ask for. A canvas silently falls back
// to a system font for anything the document hasn't loaded yet, and a video
// that shipped in Arial is not obviously wrong until it is next to the app.
export async function ensureFonts() {
  if (typeof document === 'undefined' || !document.fonts) return;
  try {
    await Promise.all(FONT_SPECS.map((spec) => document.fonts.load(spec)));
    await document.fonts.ready;
  } catch {
    /* no font loading API, or a face that will not load — paint anyway */
  }
}

const roundRect = (ctx, x, y, w, h, r) => {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
};

// One of design.js's 24×24 icon paths, drawn at `size` with its top-left at
// (x, y) — the same path data the DOM renders in an <svg>.
function drawIcon(ctx, path, x, y, size, color, width = 2) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke(new Path2D(path));
  ctx.restore();
}

// Wrap `text` to `maxWidth`, honouring the newlines it already has. A word
// longer than the line (a URL, a pasted id) is broken across lines rather than
// run off the edge of the box.
export function wrapText(ctx, text, maxWidth) {
  const lines = [];
  for (const paragraph of String(text).split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(candidate).width > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
      while (ctx.measureText(line).width > maxWidth && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > maxWidth) cut -= 1;
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    lines.push(line);
  }
  return lines;
}

// Everything about the frame that does not change from moment to moment: the
// scale every metric is multiplied by, the box's width, and where the whole
// composition sits. `attachments` are already-decoded images (ImageBitmap or
// HTMLImageElement) so a frame is only drawing, never loading.
export function buildScene(ctx, options) {
  const {
    width,
    height,
    layoutWidth = DEFAULT_LAYOUT_WIDTH,
    boxWidthPct = DEFAULT_BOX_WIDTH_PCT,
    background = COLORS.bg,
    headline = '',
    placeholder = '',
    modelChip = '',
    attachments = [],
    finalText = '',
  } = options;

  const scale = sceneScale(width, layoutWidth);
  const m = Object.fromEntries(Object.entries(METRICS).map(([k, v]) => [k, v * scale]));
  const boxW = boxCssWidth(layoutWidth, boxWidthPct) * scale;
  const boxX = Math.round((width - boxW) / 2);
  const innerW = boxW - m.padLeft - m.padRight;

  const scene = {
    width,
    height,
    scale,
    m,
    boxX,
    boxW,
    innerW,
    background,
    headline,
    placeholder,
    modelChip,
    attachments,
    fontText: `${m.fontSize}px ${FONT_SANS}`,
    fontChip: `${m.chipFontSize}px ${FONT_MONO}`,
    fontHeadline: `${m.headlineFontSize}px ${FONT_SANS}`,
  };

  // The box at its tallest — the finished message — is what the composition is
  // centred on, so nothing has to move once it is.
  const tallest = boxHeight(ctx, scene, finalText);
  const headlineH = headline ? m.headlineFontSize * 1.2 : 0;
  const headlineBlock = headline ? headlineH + m.headlineGap : 0;
  const top = Math.round((height - (headlineBlock + tallest)) / 2);

  scene.headlineTop = top;
  scene.headlineH = headlineH;
  // The bottom edge never moves; the box grows up from it.
  scene.boxBottom = top + headlineBlock + tallest;
  return scene;
}

// How many lines of the message are shown, and how tall that makes the box.
// Past `maxTextLines` the box stops growing and shows the end of the message,
// the way the real composer scrolls.
export function textLines(ctx, scene, text) {
  ctx.font = scene.fontText;
  const lines = text ? wrapText(ctx, text, scene.innerW) : [''];
  return lines.slice(-METRICS.maxTextLines);
}

// How many thumbnails fit across the box, and how tall the strip of them is.
// The DOM box wraps its attachments; so does this, or a tenth image would
// quietly fall off the edge of the recording.
export const thumbsPerRow = (scene) =>
  Math.max(1, Math.floor((scene.innerW + scene.m.thumbGap) / (scene.m.thumb + scene.m.thumbGap)));

export function stripHeight(scene, count) {
  if (count <= 0) return 0;
  const rows = Math.ceil(count / thumbsPerRow(scene));
  return rows * scene.m.thumb + (rows - 1) * scene.m.thumbGap + scene.m.gap;
}

export function boxHeight(ctx, scene, text, attachCount = scene.attachments.length) {
  const { m } = scene;
  const lines = textLines(ctx, scene, text);
  const textH = Math.max(m.minTextHeight, lines.length * m.lineHeight);
  return m.padTop + stripHeight(scene, attachCount) + textH + m.gap + m.control + m.padBottom;
}

// One frame. `state` is what timeline.js says the box looks like right now:
// { text, caretOn, sending, attachCount, dropProgress }.
export function paintFrame(ctx, scene, state) {
  const { m, width, height, boxX, boxW } = scene;
  const attachCount =
    state.attachCount === undefined ? scene.attachments.length : state.attachCount;
  // 0 while an image is still landing, 1 once it has settled.
  const landed = state.dropProgress === undefined ? 1 : state.dropProgress;

  ctx.save();
  ctx.fillStyle = scene.background;
  ctx.fillRect(0, 0, width, height);

  if (scene.headline) {
    ctx.font = scene.fontHeadline;
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(scene.headline, width / 2, scene.headlineTop + scene.headlineH / 2);
  }

  const boxH = boxHeight(ctx, scene, state.text, attachCount);
  const boxY = scene.boxBottom - boxH;

  // The panel: fill with the shadow the DOM box wears, then the border on top
  // (the shadow is turned off first, or the stroke would cast one too).
  ctx.save();
  ctx.shadowColor = COLORS.shadow;
  ctx.shadowBlur = m.shadowBlur;
  ctx.shadowOffsetY = m.shadowOffsetY;
  ctx.fillStyle = COLORS.panel;
  roundRect(ctx, boxX, boxY, boxW, boxH, m.radius);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = COLORS.panelBorder;
  ctx.lineWidth = Math.max(1, scene.scale);
  roundRect(ctx, boxX, boxY, boxW, boxH, m.radius);
  ctx.stroke();

  // The box lights up as an image lands on it, the way it does under a real
  // drag, and fades back over the landing.
  if (landed < 1 && attachCount > 0) {
    ctx.save();
    ctx.globalAlpha = 1 - landed;
    ctx.strokeStyle = COLORS.accent;
    ctx.lineWidth = Math.max(1.5, scene.scale * 1.5);
    roundRect(ctx, boxX, boxY, boxW, boxH, m.radius);
    ctx.stroke();
    ctx.restore();
  }

  const contentX = boxX + m.padLeft;
  let y = boxY + m.padTop;

  if (attachCount > 0) {
    const perRow = thumbsPerRow(scene);
    scene.attachments.slice(0, attachCount).forEach((image, i) => {
      const x = contentX + (i % perRow) * (m.thumb + m.thumbGap);
      const row = Math.floor(i / perRow) * (m.thumb + m.thumbGap);
      // The newest one scales and fades into place; the rest are settled.
      const progress = i === attachCount - 1 ? landed : 1;
      drawThumb(ctx, image, x, y + row, m.thumb, m.thumbRadius, scene.scale, progress);
    });
    y += stripHeight(scene, attachCount);
  }

  // The message (or the placeholder), plus the caret at the end of it.
  const lines = textLines(ctx, scene, state.text);
  const textH = Math.max(m.minTextHeight, lines.length * m.lineHeight);
  ctx.font = scene.fontText;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = state.text ? COLORS.text : COLORS.dim;
  const shown = state.text ? lines : [scene.placeholder];
  shown.forEach((line, i) => {
    ctx.fillText(line, contentX, y + i * m.lineHeight + m.lineHeight / 2);
  });

  if (state.caretOn) {
    const lastIndex = state.text ? lines.length - 1 : 0;
    const caretX = contentX + (state.text ? ctx.measureText(lines[lastIndex]).width : 0);
    const caretH = m.fontSize * 1.15;
    ctx.fillStyle = COLORS.text;
    ctx.fillRect(
      caretX + m.caretWidth,
      y + lastIndex * m.lineHeight + (m.lineHeight - caretH) / 2,
      m.caretWidth,
      caretH
    );
  }

  y += textH + m.gap;

  drawAttachButton(ctx, scene, contentX, y, attachCount);
  drawModelChip(ctx, scene, contentX + attachButtonWidth(ctx, scene, attachCount) + m.chipGap, y);
  drawSendButton(ctx, scene, boxX + boxW - m.padRight - m.control, y, state, attachCount);

  ctx.restore();
}

// One attachment. `progress` is its landing: below 1 it is drawn slightly
// small and see-through, about its own centre, so it settles into the strip
// instead of appearing from nowhere.
function drawThumb(ctx, image, x, y, size, radius, scale, progress = 1) {
  const eased = progress >= 1 ? 1 : 1 - (1 - progress) * (1 - progress);
  ctx.save();
  if (eased < 1) {
    const grow = 0.86 + 0.14 * eased;
    ctx.globalAlpha = eased;
    ctx.translate(x + size / 2, y + size / 2);
    ctx.scale(grow, grow);
    ctx.translate(-(x + size / 2), -(y + size / 2));
  }
  ctx.save();
  roundRect(ctx, x, y, size, size, radius);
  ctx.fillStyle = COLORS.thumbBg;
  ctx.fill();
  ctx.clip();
  // Cover, like the DOM's object-cover: fill the square, crop the overflow.
  const cover = Math.max(size / image.width, size / image.height);
  const w = image.width * cover;
  const h = image.height * cover;
  ctx.drawImage(image, x + (size - w) / 2, y + (size - h) / 2, w, h);
  ctx.restore();
  ctx.strokeStyle = COLORS.thumbBorder;
  ctx.lineWidth = Math.max(1, scale);
  roundRect(ctx, x, y, size, size, radius);
  ctx.stroke();
  ctx.restore();
}

// The attach button is a 34px circle-ish pill with a paperclip in it, and turns
// into a wider pill with a count once something is attached — the DOM box's
// `active` pill.
function attachButtonWidth(ctx, scene, attachCount) {
  const { m } = scene;
  if (!attachCount) return m.control;
  ctx.font = scene.fontChip;
  const count = String(attachCount);
  return (
    10 * scene.scale +
    m.iconSize +
    7 * scene.scale +
    ctx.measureText(count).width +
    14 * scene.scale
  );
}

function drawAttachButton(ctx, scene, x, y, attachCount) {
  const { m } = scene;
  const w = attachButtonWidth(ctx, scene, attachCount);
  const active = attachCount > 0;

  if (active) {
    ctx.fillStyle = COLORS.accentDim;
    roundRect(ctx, x, y, w, m.control, m.pillRadius);
    ctx.fill();
  }
  ctx.strokeStyle = active ? COLORS.accent : COLORS.panelBorder;
  ctx.lineWidth = Math.max(1, scene.scale);
  roundRect(ctx, x, y, w, m.control, m.pillRadius);
  ctx.stroke();

  const color = active ? COLORS.accent : COLORS.dim;
  const iconX = active ? x + 10 * scene.scale : x + (m.control - m.iconSize) / 2;
  drawIcon(
    ctx,
    active ? ICONS.image : ICONS.clip,
    iconX,
    y + (m.control - m.iconSize) / 2,
    m.iconSize,
    color,
    2
  );

  if (active) {
    ctx.font = scene.fontChip;
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(attachCount), iconX + m.iconSize + 7 * scene.scale, y + m.control / 2);
  }
}

function drawModelChip(ctx, scene, x, y) {
  const { m } = scene;
  if (!scene.modelChip) return;
  ctx.font = scene.fontChip;
  const labelW = ctx.measureText(scene.modelChip).width;
  const chevron = 10 * scene.scale;
  const w = m.chipPadX * 2 + labelW + 6 * scene.scale + chevron;

  ctx.strokeStyle = COLORS.panelBorder;
  ctx.lineWidth = Math.max(1, scene.scale);
  roundRect(ctx, x, y, w, m.control, m.chipRadius);
  ctx.stroke();

  ctx.fillStyle = COLORS.dim;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(scene.modelChip, x + m.chipPadX, y + m.control / 2);
  drawIcon(
    ctx,
    ICONS.chevron,
    x + m.chipPadX + labelW + 6 * scene.scale,
    y + (m.control - chevron) / 2,
    chevron,
    COLORS.dim,
    2.4
  );
}

// The send button: accent once there is something to send, and a spinner from
// the moment it is pressed — the same two states the DOM button has.
function drawSendButton(ctx, scene, x, y, state, attachCount) {
  const { m } = scene;
  const live = state.text.trim().length > 0 || attachCount > 0;
  ctx.fillStyle = live ? COLORS.accent : COLORS.sendOffBg;
  ctx.beginPath();
  ctx.arc(x + m.control / 2, y + m.control / 2, m.control / 2, 0, Math.PI * 2);
  ctx.fill();

  if (state.sending) {
    drawSpinner(
      ctx,
      x + m.control / 2,
      y + m.control / 2,
      m.sendIconSize / 2,
      scene.scale,
      state.ms
    );
    return;
  }
  drawIcon(
    ctx,
    ICONS.arrowUp,
    x + (m.control - m.sendIconSize) / 2,
    y + (m.control - m.sendIconSize) / 2,
    m.sendIconSize,
    live ? '#000000' : COLORS.sendOffFg,
    2.5
  );
}

// The shared Spinner, drawn: a faint ring with a quarter of it solid, one turn
// every 700ms (src/shared/components/Spinner.jsx, --animate-klb-spin).
const SPIN_PERIOD_MS = 700;

function drawSpinner(ctx, cx, cy, radius, scale, ms) {
  const angle = ((ms % SPIN_PERIOD_MS) / SPIN_PERIOD_MS) * Math.PI * 2;
  ctx.save();
  ctx.lineWidth = 2 * scale;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = '#000000';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(cx, cy, radius, angle, angle + Math.PI / 2);
  ctx.stroke();
  ctx.restore();
}
