// Shared form-field styling: Tailwind utility strings reused by the tools for
// native <label>/<select>/<textarea>/<input> controls (the ones not covered by
// the shared Input component), plus the status pill and mini-button styles
// used on result cards.

export const CONTROL =
  'w-full bg-panel-alt border border-panel-border rounded-xl text-text font-sans text-[15px] px-[14px] py-3 outline-none transition-[border-color] duration-150 focus:border-accent placeholder:text-[#555]';

export const LABEL = 'block text-[13px] text-text-dim mb-1.5 font-mono';

export const FIELD = 'mb-4 last:mb-0';

export const FIELD_HELP =
  'text-[12px] text-text-dim mt-1.5 leading-[1.4] [&_a]:text-accent [&_a]:no-underline [&_a:hover]:underline';

export const SELECT = `${CONTROL} appearance-none pr-9 cursor-pointer`;

// The <select> chevron stays an inline background: the data-URI SVG contains
// spaces, which are awkward to escape into a Tailwind arbitrary value.
export const SELECT_CHEVRON = {
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%238a8a8a' stroke-width='1.5' fill='none' fill-rule='evenodd'/%3E%3C/svg%3E\")",
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 14px center',
};

export const STATUS_PILL = {
  base: 'self-start font-mono text-[11px] rounded-xl px-2.5 py-1 inline-flex items-center gap-1.5 border',
  queued: 'border-panel-border text-text-dim',
  running: 'text-accent border-accent bg-accent-dim',
  succeeded: 'text-success border-success bg-success-dim',
  failed: 'text-error border-error bg-error-dim',
  // Whole-run status only (the history list): some items landed, some failed.
  partial: 'text-warning border-warning bg-warning-dim',
};

export const MINI_BTN =
  'flex-1 bg-transparent border border-panel-border text-text-dim rounded-[10px] px-2 py-[7px] text-[11.5px] font-mono cursor-pointer text-center no-underline block transition-colors duration-150 hover:border-accent hover:text-accent';
