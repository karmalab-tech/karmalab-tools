import { useEffect, useState } from 'react';
import { cachedBlob } from './outputCache.js';

// The image to show on a result card: the cached copy where there is one, the
// Replicate URL until then.
//
// It matters because Replicate deletes an output an hour after it ran. Without
// this, a run reopened from History is a grid of broken images even though the
// files are sitting in the cache and the downloads work fine.
//
// The object URL is revoked when the card goes away or moves on to another
// result, so a long history session doesn't leak them.
export function useCachedImage(key, fallbackUrl) {
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
