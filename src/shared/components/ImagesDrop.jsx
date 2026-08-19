import { useRef, useState } from 'react';

const svgStroke = { fill: 'none', stroke: 'currentColor' };

const StackIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" {...svgStroke} strokeWidth={1.8}>
    <rect x="7" y="3" width="14" height="14" rx="3" />
    <path d="M17 21H6a3 3 0 01-3-3V7" />
  </svg>
);

const CloseIcon = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" {...svgStroke} strokeWidth={2.4}>
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);

let counter = 0;
const nextId = () => `img${++counter}`;

const readFile = (file) =>
  new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve({ id: nextId(), dataUri: e.target.result, name: file.name });
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });

// Click-or-drop picker for a *list* of images (the single-image sibling is
// ImageDrop). `images` is an array of `{ id, dataUri, name }`; `onChange`
// receives the next array whenever images are added or removed. Files are added
// to the existing list, so several drops build one set.
export function ImagesDrop({
  images,
  onChange,
  disabled = false,
  emptyLabel = 'Click or drop images',
  hint = 'Several at once, or one drop at a time',
}) {
  const [dragover, setDragover] = useState(false);
  const [reading, setReading] = useState(false);
  const inputRef = useRef(null);

  async function handleFiles(fileList) {
    const files = Array.from(fileList || []).filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    setReading(true);
    const added = (await Promise.all(files.map(readFile))).filter(Boolean);
    setReading(false);
    if (added.length) onChange([...images, ...added]);
  }

  function remove(id) {
    onChange(images.filter((img) => img.id !== id));
  }

  return (
    <>
      <div
        className={[
          'border-[1.5px] border-dashed border-panel-border rounded-[14px] p-4.5 flex items-center gap-3.5 cursor-pointer transition-[border-color,background] duration-150 bg-panel-alt hover:border-accent',
          disabled && 'opacity-40 cursor-not-allowed pointer-events-none',
          dragover && 'border-accent',
          images.length && 'border-solid',
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={() => !disabled && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragover(true);
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          if (!disabled) setDragover(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragover(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragover(false);
          if (!disabled) handleFiles(e.dataTransfer.files);
        }}
      >
        <div className="w-13 h-13 rounded-[10px] shrink-0 flex items-center justify-center text-text-dim border border-panel-border">
          <StackIcon />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[14px] mb-0.5">
            {images.length
              ? `${images.length} ${images.length === 1 ? 'image' : 'images'} — click to add more`
              : emptyLabel}
          </div>
          <div className="text-[12px] text-text-dim font-mono whitespace-nowrap overflow-hidden text-ellipsis">
            {reading ? 'Reading files…' : hint}
          </div>
        </div>
      </div>

      {images.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-2 mt-2.5">
          {images.map((img, i) => (
            <div key={img.id} className="relative group">
              <img
                src={img.dataUri}
                alt=""
                title={img.name}
                className="w-full aspect-square object-cover rounded-[10px] border border-panel-border bg-black block"
              />
              <span className="absolute bottom-1 left-1 font-mono text-[10px] text-white bg-black/65 rounded px-1 py-px">
                {i + 1}
              </span>
              <button
                type="button"
                title={`Remove ${img.name}`}
                className="absolute -top-1.5 -right-1.5 w-5.5 h-5.5 rounded-full border border-panel-border bg-panel text-text-dim flex items-center justify-center cursor-pointer hover:border-error hover:text-error"
                onClick={() => remove(img.id)}
              >
                <CloseIcon />
              </button>
            </div>
          ))}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </>
  );
}
