// Frame extraction for the Continuous Video Studio.
//
// The chain works by grabbing the last frame of each generated clip and
// feeding it to the next generation as the start frame. Everything happens in
// the browser: the finished video is downloaded as a blob (replicate.delivery
// sends CORS headers, same as the image downloads in the Batch Studio), played
// into an off-screen <video>, and the wanted frame is drawn onto a canvas.

const FRAME_TIMEOUT_MS = 30 * 1000;

export async function fetchVideoBlob(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Could not download the video (HTTP ${resp.status}).`);
  return resp.blob();
}

// Extract a frame from a (blob-object-URL) video as a JPEG data URI.
// `position` is 'first' or 'last'.
export function extractFrame(videoObjectUrl, position) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';

    let settled = false;
    const timeout = setTimeout(() => {
      fail(new Error('Timed out reading a frame from the video.'));
    }, FRAME_TIMEOUT_MS);

    function cleanup() {
      clearTimeout(timeout);
      video.removeAttribute('src');
      video.load();
    }
    function fail(err) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    }
    function draw() {
      if (settled) return;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        if (!canvas.width || !canvas.height) throw new Error('The video has no readable frames.');
        canvas.getContext('2d').drawImage(video, 0, 0);
        const dataUri = canvas.toDataURL('image/jpeg', 0.92);
        settled = true;
        cleanup();
        resolve(dataUri);
      } catch (err) {
        fail(err);
      }
    }

    video.addEventListener('error', () =>
      fail(new Error('Could not decode the video in this browser.'))
    );
    video.addEventListener(
      'loadeddata',
      () => {
        if (position === 'first') {
          draw();
          return;
        }
        // Seek just short of the end — seeking to the exact duration can land
        // past the last decodable frame in some encodings.
        video.addEventListener('seeked', draw, { once: true });
        video.currentTime = Math.max(0, (video.duration || 0) - 0.05);
      },
      { once: true }
    );

    video.src = videoObjectUrl;
  });
}
