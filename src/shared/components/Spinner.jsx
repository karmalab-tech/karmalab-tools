const VARIANTS = {
  dark: 'border-2 border-black/25 border-t-black',
  light: 'border-2 border-text-dim/25 border-t-text-dim',
};

export function Spinner({ size = 16, variant = 'light', className = '', style, ...props }) {
  const cls = ['inline-block shrink-0 rounded-full animate-klb-spin', VARIANTS[variant], className]
    .filter(Boolean)
    .join(' ');
  return <span className={cls} style={{ width: size, height: size, ...style }} {...props} />;
}
