import { useEffect, useRef, useState } from 'react';
import { IconButton, Spinner } from '../shared/components';

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

const ClipIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" {...stroke}>
    <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
  </svg>
);

const FileIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" {...stroke}>
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);

const SendIcon = () => (
  <svg viewBox="0 0 24 24" {...stroke} strokeWidth={2.5}>
    <line x1="12" y1="19" x2="12" y2="5" />
    <polyline points="5 12 12 5 19 12" />
  </svg>
);

const ChevronIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" {...stroke}>
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

// Mockup states for the attach button: idle -> loading -> active -> idle.
const ATTACH_UPLOAD_MS = 1200;

export default function PromptBox() {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [attach, setAttach] = useState('idle'); // 'idle' | 'loading' | 'active'
  const textareaRef = useRef(null);

  const canSend = text.trim().length > 0;

  function autoGrow() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Fake upload: after a beat in "loading", flip to "active".
  useEffect(() => {
    if (attach !== 'loading') return;
    const timer = setTimeout(() => setAttach('active'), ATTACH_UPLOAD_MS);
    return () => clearTimeout(timer);
  }, [attach]);

  function send() {
    if (!canSend) return;
    setSending((s) => !s);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function toggleAttach() {
    setAttach((s) => (s === 'idle' ? 'loading' : 'idle'));
  }

  return (
    <div className="flex items-center justify-center min-h-screen p-6">
      <div className="w-full max-w-180 flex flex-col items-center gap-8">
        <h1 className="text-[46px] font-normal text-white text-center tracking-[-0.01em] m-0">
          Hi Karma!
        </h1>

        <div className="w-full bg-panel border border-panel-border rounded-[26px] pt-4.5 pr-4.5 pb-3.5 pl-5.5 flex flex-col gap-3.5 shadow-[0_8px_40px_rgba(0,0,0,0.45)]">
          <textarea
            ref={textareaRef}
            value={text}
            rows={1}
            placeholder="How can I help you today?"
            className="w-full bg-transparent border-none outline-none resize-none text-text font-sans text-[19px] font-normal leading-normal min-h-7.5 max-h-50 p-0 placeholder:text-text-dim"
            onChange={(e) => {
              setText(e.target.value);
              autoGrow();
            }}
            onKeyDown={handleKeyDown}
          />

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <IconButton
                variant="pill"
                title="Attach"
                active={attach === 'active'}
                loading={attach === 'loading'}
                onClick={toggleAttach}
              >
                {attach === 'loading' ? (
                  <>
                    <Spinner size={14} variant="light" />
                    <span>Uploading…</span>
                  </>
                ) : attach === 'active' ? (
                  <>
                    <FileIcon />
                    <span>beach_video.mp4</span>
                  </>
                ) : (
                  <ClipIcon />
                )}
              </IconButton>

              <button
                type="button"
                className="font-mono text-[13px] text-text-dim border border-panel-border rounded-2xl px-3 py-1.5 bg-transparent flex items-center gap-1.5 cursor-pointer"
              >
                Labrador 4.6
                <ChevronIcon />
              </button>
            </div>

            <IconButton
              variant="round"
              title="Send"
              disabled={!canSend}
              onClick={send}
            >
              {sending ? <Spinner size={14} variant="dark" /> : <SendIcon />}
            </IconButton>
          </div>
        </div>
      </div>
    </div>
  );
}
