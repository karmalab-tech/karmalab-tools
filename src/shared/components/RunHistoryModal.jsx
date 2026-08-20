import { useEffect } from 'react';
import { Panel } from './Panel.jsx';
import { Button } from './Button.jsx';
import { StatusPill } from './StatusPill.jsx';
import { FIELD_HELP } from '../fields.js';
import { formatRunTime, runCounts, runStatus, runSummary } from '../runs.js';

// The history of finished generations, shared by the three tools. Runs come
// from localStorage (see src/shared/runs.js), newest first; picking one loads it
// back into the tool, which then refreshes each item's status from Replicate.
export function RunHistoryModal({ open, runs, currentRunId, onSelect, onClose, onClear }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px] flex items-center justify-center p-5"
      onClick={onClose}
    >
      <Panel
        title="Generation history"
        className="w-full max-w-150 max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {runs.length === 0 ? (
          <div className="text-center px-5 py-8 text-text-dim text-[13.5px] font-mono">
            Nothing here yet — finished generations show up in this list.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {runs.map((r) => {
              const counts = runCounts(r.items);
              const isCurrent = r.id === currentRunId;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => onSelect(r.id)}
                  className={`text-left rounded-[14px] border p-3.5 cursor-pointer transition-colors duration-150 ${
                    isCurrent
                      ? 'border-accent bg-accent-dim'
                      : 'border-panel-border bg-panel-alt hover:border-[#4a4a4a]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2.5 mb-1">
                    <span className="text-[14px] font-medium truncate">{r.title}</span>
                    <StatusPill status={runStatus(r.items)} className="shrink-0" />
                  </div>
                  <div className="font-mono text-[11.5px] text-text-dim">
                    {formatRunTime(r.finishedAt || r.createdAt)} ·{' '}
                    {counts.total === 1 ? '1 item' : `${counts.total} items`} ·{' '}
                    {runSummary(r.items)}
                  </div>
                  {r.items[0]?.prompt && (
                    <div className="text-[12.5px] text-text-dim leading-[1.4] line-clamp-2 mt-1.5">
                      {r.items[0].prompt}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}

        <div className={`${FIELD_HELP} mt-4`}>
          Kept in this browser only. Opening a generation loads it back into the tool and refreshes
          it from Replicate — result links expire after a while, so an older one may no longer play.
        </div>
        <div className="flex gap-2 mt-4">
          {runs.length > 0 && (
            <Button variant="secondary" onClick={onClear}>
              Clear history
            </Button>
          )}
          <Button onClick={onClose}>Done</Button>
        </div>
      </Panel>
    </div>
  );
}
