// Fallback frame source for containers the MP4 demuxer can't open (e.g. WebM
// uploads): steps a hidden <video> element frame by frame via currentTime +
// 'seeked'. Reliable and frame-accurate at the chosen fps, but slower than
// the WebCodecs path — each seek re-decodes from the nearest keyframe. The
// browser doesn't expose the source frame rate, so the caller picks one.

export async function createSeekFrameSource(file, { fps = 30 } = {}) {
  if (typeof VideoFrame === 'undefined') {
    throw new Error('WebCodecs is not available in this browser.');
  }
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.src = url;
  await new Promise((resolve, reject) => {
    video.onloadedmetadata = resolve;
    video.onerror = () => reject(new Error('Could not load the video for export.'));
  });
  // WebM recordings often report Infinity until forced to the end once.
  if (!Number.isFinite(video.duration)) {
    await new Promise((resolve) => {
      video.onseeked = resolve;
      video.currentTime = 1e6;
      setTimeout(resolve, 3000);
    });
    video.currentTime = 0;
  }
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  if (!duration) throw new Error('Could not determine the video duration.');
  const frameCount = Math.max(1, Math.round(duration * fps));

  const cleanup = () => {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  };

  async function* frames(signal) {
    try {
      for (let i = 0; i < frameCount; i++) {
        if (signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError');
        const t = Math.min(i / fps, Math.max(duration - 0.001, 0));
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 2000); // some seeks never fire 'seeked'
          video.onseeked = () => { clearTimeout(timer); resolve(); };
          video.onerror = () => { clearTimeout(timer); reject(new Error('Seeking the video failed.')); };
          video.currentTime = t;
        });
        yield new VideoFrame(video, {
          timestamp: Math.round((i * 1e6) / fps),
          duration: Math.round(1e6 / fps),
        });
      }
    } finally {
      cleanup();
    }
  }

  return {
    kind: 'seek',
    width: video.videoWidth,
    height: video.videoHeight,
    fps,
    frameCount,
    duration,
    audio: null, // no demuxer here, so no audio passthrough
    frames,
    waitDemuxDone: async () => {},
    close: cleanup,
  };
}
