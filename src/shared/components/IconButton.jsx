const BASE =
  'flex items-center justify-center cursor-pointer font-mono text-[13px] whitespace-nowrap shrink-0 [&>svg]:shrink-0';

const PILL_BASE =
  'rounded-[17px] gap-[7px] border transition-[border-color,color,background,padding,width] duration-150';

// Full class string per variant. Pill is stateful (idle / loading / active),
// so its classes are resolved from the `active` / `loading` flags.
function variantClasses(variant, { active, loading }) {
  switch (variant) {
    case 'square':
      return 'w-10 h-10 rounded-xl border border-panel-border bg-transparent text-text-dim transition-colors duration-150 hover:border-[#4a4a4a] hover:text-text [&>svg]:w-[17px] [&>svg]:h-[17px]';
    case 'round':
      return 'w-[34px] h-[34px] rounded-full bg-accent text-black transition-[transform,opacity,background] duration-150 hover:not-disabled:scale-105 disabled:bg-[#3a3a3a] disabled:text-[#6a6a6a] disabled:cursor-default [&>svg]:w-4 [&>svg]:h-4';
    case 'pill':
      if (loading)
        return `${PILL_BASE} w-auto py-0 pr-[14px] pl-[10px] border-[#4a4a4a] bg-transparent text-text-dim`;
      if (active)
        return `${PILL_BASE} w-auto py-0 pr-[14px] pl-[10px] border-accent bg-accent-dim text-accent`;
      return `${PILL_BASE} h-[34px] w-[34px] p-0 border-panel-border bg-transparent text-text-dim hover:border-[#4a4a4a] hover:text-text`;
    default:
      return '';
  }
}

export function IconButton({
  variant = 'square',
  active = false,
  loading = false,
  className = '',
  children,
  ...props
}) {
  const cls = [BASE, variantClasses(variant, { active, loading }), className]
    .filter(Boolean)
    .join(' ');
  return (
    <button type="button" className={cls} {...props}>
      {children}
    </button>
  );
}
