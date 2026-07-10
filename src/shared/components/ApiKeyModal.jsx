import { useEffect, useState } from 'react';
import { Panel } from './Panel.jsx';
import { Input } from './Input.jsx';
import { Button } from './Button.jsx';
import { FIELD, FIELD_HELP, LABEL } from '../fields.js';
import { loadApiKey, loadOpenaiKey, saveApiKey, saveOpenaiKey } from '../apiKey.js';

// Modal for the shared API keys, opened from the TopBar's key button (or the
// key buttons inside the tools). Keys are saved to localStorage as you type
// (src/shared/apiKey.js); `onSaved` fires on every change so the host tool
// can re-read the ones it needs.
export function ApiKeyModal({ open, onClose, onSaved }) {
  const [replicateKey, setReplicateKey] = useState(() => loadApiKey());
  const [openaiKey, setOpenaiKey] = useState(() => loadOpenaiKey());

  // Re-read on open — another tab (or tool) may have changed the keys.
  useEffect(() => {
    if (!open) return;
    setReplicateKey(loadApiKey());
    setOpenaiKey(loadOpenaiKey());
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  function updateReplicate(value) {
    setReplicateKey(value);
    saveApiKey(value.trim());
    onSaved?.();
  }

  function updateOpenai(value) {
    setOpenaiKey(value);
    saveOpenaiKey(value.trim());
    onSaved?.();
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px] flex items-center justify-center p-5"
      onClick={onClose}
    >
      <Panel title="API keys" className="w-full max-w-130" onClick={(e) => e.stopPropagation()}>
        <div className={FIELD}>
          <label className={LABEL} htmlFor="replicateKeyInput">
            Replicate API token
          </label>
          <Input
            id="replicateKeyInput"
            revealable
            autoFocus
            value={replicateKey}
            placeholder="r8_••••••••••••••••••••••••••••••••"
            onChange={(e) => updateReplicate(e.target.value)}
          />
          <div className={FIELD_HELP}>
            Used for every generation. Get a token at{' '}
            <a href="https://replicate.com/account/api-tokens" target="_blank" rel="noreferrer">
              replicate.com/account/api-tokens
            </a>
            .
          </div>
        </div>

        <div className={FIELD}>
          <label className={LABEL} htmlFor="openaiKeyInput">
            OpenAI API key
          </label>
          <Input
            id="openaiKeyInput"
            revealable
            value={openaiKey}
            placeholder="sk-••••••••••••••••"
            onChange={(e) => updateOpenai(e.target.value)}
          />
          <div className={FIELD_HELP}>
            Only needed for OpenAI models (GPT Image in the Batch Studio) — Replicate bills them
            through your own OpenAI account. Leave empty if you don't use them.
          </div>
        </div>

        <div className={`${FIELD_HELP} mt-4`}>
          Keys are saved in this browser's local storage as you type, shared by all the tools —
          never sent anywhere but Replicate.
        </div>
        <Button onClick={onClose} className="mt-4 w-full">
          Done
        </Button>
      </Panel>
    </div>
  );
}
