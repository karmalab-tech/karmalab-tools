export function Brand({ title, subtitle, label = 'KarmaLab', href = 'https://www.karmalab.tech' }) {
  return (
    <header className="text-center mb-2">
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center justify-center gap-2 font-mono text-[13px] text-text-dim tracking-[0.08em] uppercase mb-2.5 no-underline transition-colors duration-150 hover:text-accent"
      >
        <span className="w-1.75 h-1.75 rounded-full bg-accent inline-block" /> {label}
      </a>
      <h1 className="text-[32px] font-medium m-0 tracking-[-0.01em]">{title}</h1>
      {subtitle && <p className="text-text-dim mt-2 mb-0 text-[15px]">{subtitle}</p>}
    </header>
  );
}
