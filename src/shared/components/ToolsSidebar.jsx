import { useEffect, useRef } from 'react';
import { TOOLS } from '../tools.js';

// The tool switcher, as a sidebar rather than a row of tabs: with four tools
// (and room for more) the tabs crowded the top of the page and wrapped on a
// phone. One "Tools" button opens this; every entry is a full-width row with
// its name and a line about it, which reads and taps better on a small screen
// than a scrolling row of pills.
//
// Each tool is its own page (routing lives on the server, see server/routes.js),
// so these are plain links — no client-side router to keep in step.

const CloseIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);

export function ToolsSidebar({ open, active, onClose }) {
  const firstLinkRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    // Move focus into the panel, so a keyboard or screen reader lands on the
    // list rather than back at the top of the page behind it.
    firstLinkRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px] animate-klb-fade-in"
      onClick={onClose}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Tools"
        onClick={(e) => e.stopPropagation()}
        className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-panel border-r border-panel-border flex flex-col animate-klb-slide-in shadow-[8px_0_40px_rgba(0,0,0,0.5)]"
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-panel-border">
          <span className="font-mono text-[13px] tracking-[0.08em] uppercase text-text-dim">
            Tools
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close the tool list"
            className="w-9 h-9 -mr-2 rounded-xl border border-transparent bg-transparent text-text-dim flex items-center justify-center cursor-pointer transition-colors duration-150 hover:border-panel-border hover:text-text"
          >
            <CloseIcon />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-3 flex flex-col gap-1.5">
          {TOOLS.map((tool, i) => {
            const current = tool.path === active;
            return (
              <a
                key={tool.path}
                ref={i === 0 ? firstLinkRef : null}
                href={tool.path}
                aria-current={current ? 'page' : undefined}
                className={`block rounded-[14px] border px-3.5 py-3 no-underline transition-colors duration-150 ${
                  current
                    ? 'border-accent bg-accent-dim'
                    : 'border-transparent hover:border-panel-border hover:bg-panel-alt'
                }`}
              >
                <span className={`block text-[14.5px] ${current ? 'text-accent' : 'text-text'}`}>
                  {tool.label}
                </span>
                <span className="block text-[12px] text-text-dim leading-[1.4] mt-0.5">
                  {tool.blurb}
                </span>
              </a>
            );
          })}
        </nav>
      </aside>
    </div>
  );
}
