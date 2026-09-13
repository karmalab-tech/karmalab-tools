import { useEffect, useRef, useState } from 'react';
import { IconButton, Spinner } from '../../shared/components';
import { DEFAULT_MODEL_CHIP, DEFAULT_PLACEHOLDER, ICONS } from './design.js';

// The chat box itself: the thing the studio records.
//
// Every size in the markup below is a METRICS value written out as a Tailwind
// arbitrary value (26px radius, 19px text, 34px controls, 56px thumbnails…) —
// the box's own width comes from whoever renders it, since that is the layout
// width the studio is set to. They are spelled out rather than interpolated because Tailwind
// needs to see the class strings, so a change in design.js means a change here
// too — and scene.js, which paints the same box on a canvas, reads those
// numbers directly.
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

const Icon = ({ d, size = 16, width = 2 }) => (
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

export function ChatBox({
  text,
  onTextChange,
  boxRef,
  attachments = [],
  onAttachmentsChange,
  placeholder = DEFAULT_PLACEHOLDER,
  modelChip = DEFAULT_MODEL_CHIP,
  headline = '',
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

  const canSend = text.trim().length > 0 || attachments.length > 0;

  return (
    <div className="w-full flex flex-col items-center">
      {headline && (
        <h1 className="text-[46px] font-normal text-white text-center tracking-[-0.01em] m-0 mb-[32px]">
          {headline}
        </h1>
      )}

      <div
        ref={boxRef}
        data-testid="chat-box"
        className={[
          'relative w-full bg-panel border rounded-[26px] pt-[18px] pr-[18px] pb-[14px] pl-[22px]',
          'flex flex-col gap-[14px] shadow-[0_8px_40px_rgba(0,0,0,0.45)]',
          'transition-[border-color,background-color] duration-150',
          dragging ? 'border-accent bg-accent-dim' : 'border-panel-border',
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
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-[8px]">
            {attachments.map((a) => (
              <div key={a.id} className="relative group">
                <img
                  src={a.dataUri}
                  alt=""
                  title={a.name}
                  className="w-[56px] h-[56px] rounded-[12px] object-cover block bg-black border border-[#3a3a3a]"
                />
                {!readOnly && (
                  <button
                    type="button"
                    title={`Remove ${a.name}`}
                    onClick={() => remove(a.id)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-panel border border-panel-border text-text-dim flex items-center justify-center cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity duration-150 hover:border-error hover:text-error"
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
          className="w-full bg-transparent border-none outline-none resize-none text-text font-sans text-[19px] font-normal leading-[27px] min-h-[30px] max-h-[189px] p-0 placeholder:text-text-dim"
          onChange={(e) => onTextChange?.(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (canSend) onSubmit?.();
            }
          }}
        />

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-[8px]">
            <IconButton
              variant="pill"
              title="Attach an image"
              active={attachments.length > 0}
              onClick={() => !readOnly && fileRef.current?.click()}
            >
              {attachments.length > 0 ? (
                <>
                  <Icon d={ICONS.image} />
                  <span>{attachments.length}</span>
                </>
              ) : (
                <Icon d={ICONS.clip} />
              )}
            </IconButton>

            <button
              type="button"
              className="font-mono text-[13px] text-text-dim border border-panel-border rounded-[16px] px-[12px] py-1.5 bg-transparent flex items-center gap-1.5 cursor-pointer"
            >
              {modelChip}
              <Icon d={ICONS.chevron} size={10} />
            </button>
          </div>

          <IconButton
            variant="round"
            title="Send"
            disabled={!canSend}
            onClick={() => canSend && onSubmit?.()}
          >
            {sending ? (
              <Spinner size={16} variant="dark" />
            ) : (
              <Icon d={ICONS.arrowUp} width={2.5} />
            )}
          </IconButton>
        </div>

        {dragging && (
          <div className="absolute inset-0 rounded-[26px] border-[1.5px] border-dashed border-accent bg-black/45 flex items-center justify-center pointer-events-none">
            <span className="font-mono text-[13px] text-accent">Drop to attach</span>
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
