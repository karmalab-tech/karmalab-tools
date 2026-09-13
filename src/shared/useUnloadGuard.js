import { useEffect } from 'react';

// While `active`, closing / reloading the tab triggers the browser's native
// "leave site?" confirmation. Driven by useGenerationRun while a generation has
// anything in flight: the prediction survives the tab, but the polling that
// tracks it does not — and in the video chain, neither does the frame that links
// one clip to the next.
export function useUnloadGuard(active) {
  useEffect(() => {
    if (!active) return;
    const handler = (e) => {
      e.preventDefault();
      e.returnValue = ''; // required by Chrome for the dialog to show
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [active]);
}
