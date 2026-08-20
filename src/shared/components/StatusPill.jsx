import { STATUS_PILL } from '../fields.js';

// The status badge on every result card, and on each row of the history modal.
// Queued and running get a dot — pulsing while it runs — so a card that is
// waiting reads as waiting rather than as finished.
export function StatusPill({ status, className = '' }) {
  const cls = [STATUS_PILL.base, STATUS_PILL[status] || STATUS_PILL.queued, className]
    .filter(Boolean)
    .join(' ');
  return (
    <span className={cls}>
      {(status === 'queued' || status === 'running') && (
        <span
          className={`w-1.5 h-1.5 rounded-full bg-current ${
            status === 'running' ? 'animate-klb-pulse' : ''
          }`}
        />
      )}
      {status}
    </span>
  );
}
