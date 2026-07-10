import { useEffect } from 'react';

// While `active`, closing / reloading the tab triggers the browser's native
// "leave site?" confirmation. Used by the tools while a generation run is in
// progress, since in-memory results (and the frame chain in the video tool)
// would be lost with the tab.
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
