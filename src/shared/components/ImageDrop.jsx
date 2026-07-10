import { useRef, useState } from 'react';

const svgStroke = { fill: 'none', stroke: 'currentColor' };

const ImagePlaceholderIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" {...svgStroke} strokeWidth={1.8}>
    <rect x="3" y="3" width="18" height="18" rx="3" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <path d="M21 15l-5-5L5 21" />
  </svg>
);

const CloseIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" {...svgStroke} strokeWidth={2}>
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);

// Click-or-drop image picker. `image` is `{ dataUri, name }` or null;
// `onChange` receives the same shape when a file is picked and null when the
// image is cleared. `hint` is the small line shown while no image is set.
export function ImageDrop({
  image,
  onChange,
  disabled = false,
  emptyLabel = 'Click or drop an image',
  setLabel = 'Image set',
  hint = '',
}) {
  const [dragover, setDragover] = useState(false);
  const inputRef = useRef(null);

  function handleFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => onChange({ dataUri: e.target.result, name: file.name });
    reader.readAsDataURL(file);
  }

  function clear(e) {
    e.stopPropagation();
    if (inputRef.current) inputRef.current.value = '';
    onChange(null);
  }

  return (
    <>
      <div
        className={[
          'border-[1.5px] border-dashed border-panel-border rounded-[14px] p-4.5 flex items-center gap-3.5 cursor-pointer transition-[border-color,background] duration-150 bg-panel-alt hover:border-accent',
          disabled && 'opacity-40 cursor-not-allowed pointer-events-none',
          dragover && 'border-accent',
          image && 'border-solid',
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
          if (!disabled) handleFile(e.dataTransfer.files[0]);
        }}
      >
        {image ? (
          <img
            className="w-13 h-13 rounded-[10px] object-cover bg-black shrink-0 border border-panel-border"
            src={image.dataUri}
            alt=""
          />
        ) : (
          <div className="w-13 h-13 rounded-[10px] shrink-0 flex items-center justify-center text-text-dim border border-panel-border">
            <ImagePlaceholderIcon />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="text-[14px] mb-0.5">{image ? setLabel : emptyLabel}</div>
          <div className="text-[12px] text-text-dim font-mono whitespace-nowrap overflow-hidden text-ellipsis">
            {image ? image.name : hint}
          </div>
        </div>
        {image && (
          <button
            type="button"
            className="w-7.5 h-7.5 rounded-full border border-panel-border bg-transparent text-text-dim flex items-center justify-center cursor-pointer shrink-0 hover:border-error hover:text-error"
            title="Remove image"
            onClick={clear}
          >
            <CloseIcon />
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFile(e.target.files[0])}
      />
    </>
  );
}
