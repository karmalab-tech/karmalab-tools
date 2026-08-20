// Top navigation shared by the generation tools: tabs to switch between them
// (the Prompt Box mockup is deliberately not listed), the history button — only
// there once a tool has finished runs to show — and the API key button, which
// opens the shared ApiKeyModal.

const TOOLS = [
  { path: '/', label: 'Batch Images' },
  { path: '/batch-videos', label: 'Batch Videos' },
  { path: '/video-chain', label: 'Video Chain' },
];

const TAB =
  'font-mono text-[12px] rounded-full px-3.5 py-1.5 border no-underline transition-colors duration-150';

const BUTTON_TAB = `${TAB} border-panel-border text-text-dim hover:border-accent hover:text-accent bg-transparent cursor-pointer inline-flex items-center gap-2`;

export function TopBar({ active, apiKeySet, onApiKeyClick, historyCount = 0, onHistoryClick }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <nav className="flex gap-2">
        {TOOLS.map((t) => (
          <a
            key={t.path}
            href={t.path}
            className={`${TAB} ${
              t.path === active
                ? 'border-accent text-accent bg-accent-dim'
                : 'border-panel-border text-text-dim hover:border-accent hover:text-accent'
            }`}
          >
            {t.label}
          </a>
        ))}
      </nav>
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
    </div>
  );
}
