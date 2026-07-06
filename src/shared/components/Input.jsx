import { useState } from 'react';
import { IconButton } from './IconButton.jsx';

const EyeIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const INPUT_CLASS =
  'w-full bg-panel-alt border border-panel-border rounded-xl text-text font-sans text-[15px] px-[14px] py-3 outline-none transition-[border-color] duration-150 focus:border-accent placeholder:text-[#555]';

// Text input primitive. Pass `revealable` for secret fields (API keys, tokens):
// it renders a password field with an eye IconButton that toggles visibility.
export function Input({ revealable = false, type = 'text', className = '', ...props }) {
  const [revealed, setRevealed] = useState(false);
  const inputType = revealable ? (revealed ? 'text' : 'password') : type;
  const input = (
    <input
      type={inputType}
      className={[INPUT_CLASS, revealable && 'flex-1', className].filter(Boolean).join(' ')}
      {...props}
    />
  );

  if (!revealable) return input;

  return (
    <div className="flex gap-2">
      {input}
      <IconButton title="Show / hide" onClick={() => setRevealed((s) => !s)}>
        <EyeIcon />
      </IconButton>
    </div>
  );
}
