const PANEL_CLASS =
  'bg-panel border border-panel-border rounded-[22px] px-6 py-[22px] shadow-[0_8px_40px_rgba(0,0,0,0.45)]';

export function Panel({ title, action, className = '', children, ...props }) {
  const cls = [PANEL_CLASS, className].filter(Boolean).join(' ');
  return (
    <section className={cls} {...props}>
      {(title || action) && (
        <div className="flex items-center justify-between mb-4">
          {title ? (
            <h2 className="text-[15px] font-medium m-0 font-mono tracking-[0.03em] text-text-dim uppercase">
              {title}
            </h2>
          ) : (
            <span />
          )}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
