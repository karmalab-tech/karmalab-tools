import { useEffect, useMemo, useRef, useState } from 'react';
import { Spinner } from '../../shared/components';
import {
  DEFAULT_MODEL_CHIP,
  DEFAULT_PLACEHOLDER,
  ICONS,
  METRICS,
  resolveDesign,
} from './design.js';

// The chat box itself: the thing the studio records.
//
// **Every size in it comes from METRICS (design.js), as an inline style.** Not
// because inline styles are nice — the rest of this app is Tailwind utilities
// and stays that way for colours, layout and states — but because this box is
// drawn twice: here, and again on a canvas by scene.js for the video. A padding
// written out as `pl-[22px]` here and as `METRICS.padLeft` there is two numbers
// that have to be changed together, and the day one of them isn't, the
// recording quietly stops matching the box on screen. It happened. So the
// numbers live in design.js and both renderers read them, and a test keeps
// hardcoded pixel values out of this file.
//
// To restyle the box: change design.js. The box and the video both follow.
//
// The same goes for which design it wears (KarmaLab, Claude, ChatGPT): the
// colours reach the markup as CSS variables on the root, set from the design, so
// the classes stay Tailwind utilities (`bg-(--cb-panel)`) and a palette lives in
// design.js and nowhere else.
//
// Images are attached by dropping them on the box, by the paperclip, or by
// pasting: each one becomes a rounded square in a strip above the text, the way
// ChatGPT and Claude do it, and another drop adds to the strip rather than
// replacing it.

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

const Icon = ({ d, size = METRICS.iconSize, width = 2 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" {...stroke} strokeWidth={width}>
    <path d={d} />
  </svg>
);

let counter = 0;
const nextId = () => `att${++counter}`;

const readFile = (file) =>
  new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve({ id: nextId(), dataUri: e.target.result, name: file.name });
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });

// Files → attachments, dropping anything that isn't an image (a drag from a
// desktop can carry all sorts) and anything that failed to read.
export async function readImageFiles(fileList) {
  const files = Array.from(fileList || []).filter((f) => f.type.startsWith('image/'));
  if (!files.length) return [];
  return (await Promise.all(files.map(readFile))).filter(Boolean);
}

// The design's palette as the custom properties the markup's classes read.
const cssVars = (c) => ({
  '--cb-panel': c.panel,
  '--cb-border': c.panelBorder,
  '--cb-text': c.text,
  '--cb-dim': c.dim,
  '--cb-accent': c.accent,
  '--cb-accent-dim': c.accentDim,
  '--cb-send-off-bg': c.sendOffBg,
  '--cb-send-off-fg': c.sendOffFg,
  '--cb-send-fg': c.sendOnFg,
  '--cb-control-border': c.controlBorder,
  '--cb-control-hover': c.controlHover,
  '--cb-thumb-bg': c.thumbBg,
  '--cb-thumb-border': c.thumbBorder,
});

// The design's metrics and fonts, arranged as the style objects the markup needs.
const styles = ({ metrics: m, fonts, colors }) => ({
  headline: {
    fontSize: m.headlineFontSize,
    marginBottom: m.headlineGap,
    fontFamily: fonts.headline,
  },
  box: {
    boxShadow: `0 ${m.shadowOffsetY}px ${m.shadowBlur}px ${colors.shadow}`,
    borderRadius: m.radius,
    paddingTop: m.padTop,
    paddingRight: m.padRight,
    paddingBottom: m.padBottom,
    paddingLeft: m.padLeft,
    gap: m.gap,
  },
  strip: { gap: m.thumbGap },
  thumb: { width: m.thumb, height: m.thumb, borderRadius: m.thumbRadius },
  text: {
    fontSize: m.fontSize,
    lineHeight: `${m.lineHeight}px`,
    minHeight: m.minTextHeight,
    maxHeight: m.maxTextLines * m.lineHeight,
    fontFamily: fonts.text,
  },
  controls: { gap: m.chipGap },
  pill: { height: m.control, borderRadius: m.pillRadius, gap: m.pillGap, fontFamily: fonts.chip },
  pillIdle: { width: m.control },
  pillActive: { paddingLeft: m.pillPadLeft, paddingRight: m.pillPadRight },
  chip: {
    height: m.control,
    borderRadius: m.chipRadius,
    paddingLeft: m.chipPadX,
    paddingRight: m.chipPadX,
    fontSize: m.chipFontSize,
    gap: m.pillGap,
    fontFamily: fonts.chip,
  },
  send: { width: m.control, height: m.control, borderRadius: m.sendRadius },
  overlay: { borderRadius: m.radius, fontSize: m.chipFontSize, fontFamily: fonts.chip },
});

export function ChatBox({
  text,
  onTextChange,
  boxRef,
  attachments = [],
  onAttachmentsChange,
  placeholder = DEFAULT_PLACEHOLDER,
  modelChip = DEFAULT_MODEL_CHIP,
  headline = '',
  design = 'karma',
  sending = false,
  readOnly = false,
  onSubmit,
}) {
  const [dragging, setDragging] = useState(false);
  const textareaRef = useRef(null);
  const fileRef = useRef(null);
  // dragenter/dragleave fire for every child the pointer crosses; counting them
  // is what keeps the highlight from flickering on the way in.
  const dragDepth = useRef(0);
  const resolved = useMemo(() => resolveDesign(design), [design]);
  const s = useMemo(() => styles(resolved), [resolved]);
  const vars = useMemo(() => cssVars(resolved.colors), [resolved]);

  // Grow with the text, up to the height the composer scrolls at.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
    el.scrollTop = el.scrollHeight;
  }, [text]);

  async function addFiles(fileList) {
    const added = await readImageFiles(fileList);
    if (added.length) onAttachmentsChange?.([...attachments, ...added]);
  }

  function remove(id) {
    onAttachmentsChange?.(attachments.filter((a) => a.id !== id));
  }

  function endDrag() {
    dragDepth.current = 0;
    setDragging(false);
  }

  const attached = attachments.length > 0;
  const canSend = text.trim().length > 0 || attached;

  return (
    <div className="w-full flex flex-col items-center" style={vars}>
      {headline && (
        <h1
          className="font-normal text-(color:--cb-text) text-center tracking-[-0.01em] m-0"
          style={s.headline}
        >
          {headline}
        </h1>
      )}

      <div
        ref={boxRef}
        data-testid="chat-box"
        style={s.box}
        className={[
          'relative w-full border flex flex-col',
          'transition-[border-color,background-color] duration-150',
          dragging
            ? 'border-(color:--cb-accent) bg-(--cb-accent-dim)'
            : 'border-(color:--cb-border) bg-(--cb-panel)',
        ].join(' ')}
        onDragEnter={(e) => {
          e.preventDefault();
          dragDepth.current += 1;
          if (!readOnly) setDragging(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={(e) => {
          e.preventDefault();
          dragDepth.current -= 1;
          if (dragDepth.current <= 0) endDrag();
        }}
        onDrop={(e) => {
          e.preventDefault();
          endDrag();
          if (!readOnly) addFiles(e.dataTransfer.files);
        }}
        onPaste={(e) => {
          const files = Array.from(e.clipboardData?.files || []);
          if (!readOnly && files.length) {
            e.preventDefault();
            addFiles(files);
          }
        }}
      >
        {attached && (
          <div className="flex flex-wrap" style={s.strip}>
            {attachments.map((a) => (
              <div key={a.id} className="relative group">
                <img
                  src={a.dataUri}
                  alt=""
                  title={a.name}
                  style={s.thumb}
                  className="object-cover block bg-(--cb-thumb-bg) border border-(color:--cb-thumb-border)"
                />
                {!readOnly && (
                  <button
                    type="button"
                    title={`Remove ${a.name}`}
                    onClick={() => remove(a.id)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-(--cb-panel) border border-(color:--cb-border) text-(color:--cb-dim) flex items-center justify-center cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity duration-150 hover:border-error hover:text-error"
                  >
                    <Icon d={ICONS.close} size={10} width={2.4} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        <textarea
          ref={textareaRef}
          value={text}
          rows={1}
          readOnly={readOnly}
          placeholder={placeholder}
          style={s.text}
          className="w-full bg-transparent border-none outline-none resize-none text-(color:--cb-text) font-normal p-0 placeholder:text-(color:--cb-dim)"
          onChange={(e) => onTextChange?.(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (canSend) onSubmit?.();
            }
          }}
        />

        <div className="flex items-center justify-between">
          <div className="flex items-center" style={s.controls}>
            {/* The attach pill: a circle with a paperclip, or a wider pill with
                a count once something is attached. */}
            <button
              type="button"
              title="Attach an image"
              onClick={() => !readOnly && fileRef.current?.click()}
              style={{ ...s.pill, ...(attached ? s.pillActive : s.pillIdle) }}
              className={[
                'flex items-center justify-center cursor-pointer border shrink-0',
                'transition-[border-color,color,background] duration-150 [&>svg]:shrink-0',
                attached
                  ? 'border-(color:--cb-accent) bg-(--cb-accent-dim) text-(color:--cb-accent)'
                  : 'border-(color:--cb-control-border) bg-transparent text-(color:--cb-dim) hover:border-(color:--cb-control-hover) hover:text-(color:--cb-text)',
              ].join(' ')}
            >
              {attached ? (
                <>
                  <Icon d={ICONS.image} />
                  <span style={{ fontSize: METRICS.chipFontSize }}>{attachments.length}</span>
                </>
              ) : (
                <Icon d={ICONS.clip} />
              )}
            </button>

            {modelChip && (
              <button
                type="button"
                style={s.chip}
                className="text-(color:--cb-dim) border border-(color:--cb-control-border) bg-transparent flex items-center cursor-pointer shrink-0"
              >
                {modelChip}
                <Icon d={ICONS.chevron} size={10} width={2.4} />
              </button>
            )}
          </div>

          <button
            type="button"
            title="Send"
            disabled={!canSend}
            onClick={() => canSend && onSubmit?.()}
            style={s.send}
            className={[
              'flex items-center justify-center shrink-0',
              'transition-[transform,opacity,background] duration-150',
              canSend
                ? 'bg-(--cb-accent) text-(color:--cb-send-fg) cursor-pointer hover:scale-105'
                : 'bg-(--cb-send-off-bg) text-(color:--cb-send-off-fg) cursor-default',
            ].join(' ')}
          >
            {sending ? (
              <Spinner
                size={METRICS.sendIconSize}
                variant="dark"
                style={{
                  borderColor: 'color-mix(in srgb, currentColor 25%, transparent)',
                  borderTopColor: 'currentColor',
                }}
              />
            ) : (
              <Icon d={ICONS.arrowUp} size={METRICS.sendIconSize} width={2.5} />
            )}
          </button>
        </div>

        {dragging && (
          <div
            style={s.overlay}
            className="absolute inset-0 border-[1.5px] border-dashed border-(color:--cb-accent) bg-black/45 flex items-center justify-center pointer-events-none text-(color:--cb-accent)"
          >
            Drop to attach
          </div>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
