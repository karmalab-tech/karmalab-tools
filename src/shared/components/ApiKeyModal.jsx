import { useEffect } from 'react';
import { Panel } from './Panel.jsx';
import { Input } from './Input.jsx';
import { Button } from './Button.jsx';
import { FIELD_HELP } from '../fields.js';

// Modal for the shared Replicate API token, opened from the TopBar's key
// button. The token state lives in each tool (it's needed for requests);
// this component just edits it — saving as you type is the caller's job
// via `onChange` (see src/shared/apiKey.js).
export function ApiKeyModal({ open, value, onChange, onClose }) {
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
        title="Replicate API token"
        className="w-full max-w-130"
        onClick={(e) => e.stopPropagation()}
      >
        <Input
          revealable
          autoFocus
          value={value}
          placeholder="r8_••••••••••••••••••••••••••••••••"
          onChange={(e) => onChange(e.target.value)}
        />
        <div className={FIELD_HELP}>
          Saved in this browser's local storage as you type, shared by all the tools — never sent
          anywhere but Replicate. Get a token at{' '}
          <a href="https://replicate.com/account/api-tokens" target="_blank" rel="noreferrer">
            replicate.com/account/api-tokens
          </a>
          .
        </div>
        <Button onClick={onClose} className="mt-5 w-full">
          Done
        </Button>
      </Panel>
    </div>
  );
}
