export function Brand({ title, subtitle, label = 'KarmaLab' }) {
  return (
    <header className="text-center mb-2">
      <div className="flex items-center justify-center gap-2 font-mono text-[13px] text-text-dim tracking-[0.08em] uppercase mb-2.5">
        <span className="w-1.75 h-1.75 rounded-full bg-accent inline-block" /> {label}
      </div>
      <h1 className="text-[32px] font-medium m-0 tracking-[-0.01em]">{title}</h1>
      {subtitle && <p className="text-text-dim mt-2 mb-0 text-[15px]">{subtitle}</p>}
    </header>
  );
}
