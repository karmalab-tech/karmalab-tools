import { useEffect, useState } from 'react';
import { cachedBlob } from './outputCache.js';

// What a result card should show — an image, or a video: the cached copy where
// there is one, the URL the item came with until then.
//
// It matters because Replicate deletes an output an hour after it ran. Without
// this, a run reopened from History is a grid of broken images even though the
// files are sitting in the cache and the downloads work fine. For a tool whose
// results are made in the browser (the Chat Box Studio's recordings) the cache
// is not a fallback but the only copy that survives the page: a blob URL dies
// with the tab that made it.
//
// The object URL is revoked when the card goes away or moves on to another
// result, so a long history session doesn't leak them.
export function useCachedOutput(key, fallbackUrl) {
  const [cachedUrl, setCachedUrl] = useState('');

  useEffect(() => {
    if (!key) return undefined;
    let objectUrl = '';
    let live = true;
    cachedBlob(key).then((blob) => {
      if (!live || !blob) return;
      objectUrl = URL.createObjectURL(blob);
      setCachedUrl(objectUrl);
    });
    return () => {
      live = false;
      setCachedUrl('');
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [key]);

  return cachedUrl || fallbackUrl;
}
