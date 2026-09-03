import { useEffect, useState } from 'react';
import { Button, Input, Panel } from '../../shared/components';
import { FIELD, FIELD_HELP, LABEL } from '../../shared/fields.js';
import {
  DEFAULT_MS_PER_IMAGE,
  MAX_MS_PER_IMAGE,
  MIN_MS_PER_IMAGE,
  parseDurationMs,
  probeEncoding,
  totalDurationMs,
  videoSupport,
} from './video.js';

// The two ways a finished chain comes off the page: as one video with each
// image held for a moment, or as the images themselves in a zip.
//
// The video is built in this browser (see video.js), so the controls that shape
// it live here rather than being options on a download button.

const seconds = (ms) => `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;

const SECTION = 'border border-panel-border rounded-[14px] bg-panel-alt p-4';

const SECTION_TITLE = 'font-mono text-[12px] tracking-[0.03em] uppercase text-text-dim mb-3';

export function DownloadModal({ open, imageCount, onClose, onDownloadVideo, onDownloadZip }) {
  const [msText, setMsText] = useState(String(DEFAULT_MS_PER_IMAGE));
  const [loop, setLoop] = useState(false);
  const [videoLabel, setVideoLabel] = useState('');
  const [zipLabel, setZipLabel] = useState('');
  const [error, setError] = useState('');
  // What this browser will encode, asked once the modal is open: MP4 where
  // there is an H.264 encoder, WebM where there isn't, null where nothing will.
  const [encoding, setEncoding] = useState(undefined);

  useEffect(() => {
    if (!open || !videoSupport()) return;
    let live = true;
    probeEncoding().then((found) => live && setEncoding(found));
    return () => {
      live = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const supported = videoSupport();
  const msPerImage = parseDurationMs(msText);
  const busy = !!videoLabel || !!zipLabel;

  async function buildVideo() {
    if (busy) return;
    if (!msPerImage) {
      setError(`Hold each image for between ${MIN_MS_PER_IMAGE} and ${MAX_MS_PER_IMAGE} ms.`);
      return;
    }
    setError('');
    setVideoLabel('Starting…');
    try {
      await onDownloadVideo({
        msPerImage,
        loop,
        onProgress: ({ stage, done, total }) =>
          setVideoLabel(
            stage === 'loading'
              ? `Fetching images ${done + 1}/${total}…`
              : stage === 'encoding'
                ? `Encoding frame ${done + 1}/${total}…`
                : 'Saving…'
          ),
      });
    } catch (err) {
      setError(err.message || 'Could not build the video.');
    }
    setVideoLabel('');
  }

  async function buildZip() {
    if (busy) return;
    setError('');
    setZipLabel('Zipping…');
    try {
      await onDownloadZip();
    } catch (err) {
      setError(err.message || 'Could not build the zip file.');
    }
    setZipLabel('');
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px] flex items-center justify-center p-5"
      onClick={onClose}
    >
      <Panel
        title="Download the chain"
        className="w-full max-w-135 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-3.5">
          <section className={SECTION}>
            <h3 className={SECTION_TITLE}>Video</h3>
            {supported ? (
              <>
                <div className={FIELD}>
                  <label className={LABEL} htmlFor="msPerImage">
                    Duration per image (ms)
                  </label>
                  <Input
                    id="msPerImage"
                    type="number"
                    min={String(MIN_MS_PER_IMAGE)}
                    max={String(MAX_MS_PER_IMAGE)}
                    step="10"
                    value={msText}
                    onChange={(e) => setMsText(e.target.value)}
                  />
                </div>
                <label className="flex items-start gap-2.5 cursor-pointer mb-4">
                  <input
                    type="checkbox"
                    className="mt-0.5 w-4 h-4 accent-accent cursor-pointer"
                    checked={loop}
                    onChange={(e) => setLoop(e.target.checked)}
                  />
                  <span>
                    <span className="text-[14px] block">Loop</span>
                    <span className={FIELD_HELP}>
                      Plays down the chain and back up it, so the video loops without a jump.
                    </span>
                  </span>
                </label>
                <div className={`${FIELD_HELP} !mt-0 mb-3`}>
                  {imageCount} {imageCount === 1 ? 'image' : 'images'}
                  {msPerImage
                    ? ` · ${seconds(totalDurationMs(imageCount, msPerImage, loop))} of video`
                    : ''}
                  {encoding ? ` · ${encoding.label}` : ''}
                  <br />
                  Encoded here in your browser — nothing is uploaded.
                </div>
                <Button
                  onClick={buildVideo}
                  disabled={busy || encoding === null}
                  className="w-full"
                >
                  {videoLabel ||
                    (encoding === null
                      ? 'No video encoder in this browser'
                      : `Download${encoding ? ` .${encoding.container}` : ' video'}`)}
                </Button>
              </>
            ) : (
              <div className={`${FIELD_HELP} !mt-0`}>
                This browser can&apos;t encode video — it has no WebCodecs
                <code className="mx-1">VideoEncoder</code>. The images below still download as a
                zip; a recent Chrome, Edge or Safari can build the video.
              </div>
            )}
          </section>

          <section className={SECTION}>
            <h3 className={SECTION_TITLE}>Images</h3>
            <div className={`${FIELD_HELP} !mt-0 mb-3`}>
              Every step as a PNG, numbered in chain order.
            </div>
            <Button variant="secondary" onClick={buildZip} disabled={busy} className="w-full">
              {zipLabel || 'Download .zip'}
            </Button>
          </section>

          {error && (
            <div className="font-mono text-[11.5px] text-error text-center leading-[1.5]">
              {error}
            </div>
          )}

          <Button variant="secondary" onClick={onClose} className="self-center !px-5 !py-2">
            Close
          </Button>
        </div>
      </Panel>
    </div>
  );
}
