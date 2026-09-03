import { useState } from 'react';
import { ToolsSidebar } from './ToolsSidebar.jsx';
import { toolLabel } from '../tools.js';

// The bar every generation tool wears: the button that opens the tool list, the
// history button — only there once a tool has finished runs to show — and the
// API key button, which opens the shared ApiKeyModal.
//
// Switching tools used to be a tab per tool. That stopped scaling at four (and
// wrapped on a phone), so the tools moved into a sidebar behind one button and
// the bar keeps to three controls at any width.

const TAB =
  'font-mono text-[12px] rounded-full px-3.5 py-1.5 border no-underline transition-colors duration-150';

const BUTTON_TAB = `${TAB} border-panel-border text-text-dim hover:border-accent hover:text-accent bg-transparent cursor-pointer inline-flex items-center gap-2`;

const MenuIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M3 6h18M3 12h18M3 18h18" />
  </svg>
);

export function TopBar({ active, apiKeySet, onApiKeyClick, historyCount = 0, onHistoryClick }) {
  const [toolsOpen, setToolsOpen] = useState(false);
  const current = toolLabel(active);

  return (
    <div className="flex items-center justify-between gap-3">
      <button
        type="button"
        onClick={() => setToolsOpen(true)}
        className={BUTTON_TAB}
        aria-haspopup="dialog"
        aria-expanded={toolsOpen}
        title={current ? `${current} — switch tool` : 'Switch tool'}
      >
        <MenuIcon />
        Tools
      </button>
      <div className="flex items-center gap-2">
        {historyCount > 0 && (
          <button
            type="button"
            onClick={onHistoryClick}
            className={BUTTON_TAB}
            title="Past generations from this browser"
          >
            History
            <span className="font-mono text-[11px] rounded-full border border-panel-border px-1.5">
              {historyCount}
            </span>
          </button>
        )}
        <button
          type="button"
          onClick={onApiKeyClick}
          className={BUTTON_TAB}
          title={apiKeySet ? 'Replicate API token is set' : 'Add your Replicate API token'}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full inline-block ${
              apiKeySet ? 'bg-success' : 'bg-error'
            }`}
          />
          API keys
        </button>
      </div>
      <ToolsSidebar open={toolsOpen} active={active} onClose={() => setToolsOpen(false)} />
    </div>
  );
}
