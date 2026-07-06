const BASE = 'font-sans rounded-[14px] cursor-pointer flex items-center justify-center gap-2';

const VARIANTS = {
  primary:
    'flex-1 bg-accent text-black border-none font-semibold text-[15px] px-6 py-[13px] transition-[transform,opacity] duration-150 hover:not-disabled:-translate-y-px disabled:opacity-35 disabled:cursor-not-allowed',
  secondary:
    'bg-transparent text-text-dim border border-panel-border text-[15px] px-5 py-[13px] transition-colors duration-150 hover:not-disabled:border-[#4a4a4a] hover:not-disabled:text-text disabled:opacity-35 disabled:cursor-not-allowed',
};

export function Button({ variant = 'primary', className = '', children, ...props }) {
  const cls = [BASE, VARIANTS[variant], className].filter(Boolean).join(' ');
  return (
    <button type="button" className={cls} {...props}>
      {children}
    </button>
  );
}
