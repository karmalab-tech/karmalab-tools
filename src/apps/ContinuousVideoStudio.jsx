import { useRef, useState } from 'react';
import {
  ApiKeyModal,
  Brand,
  Button,
  ImageDrop,
  Input,
  Panel,
  Spinner,
  TopBar,
} from '../shared/components';
import {
  CONTROL,
  FIELD,
  FIELD_HELP,
  LABEL,
  MINI_BTN,
  SELECT,
  SELECT_CHEVRON,
  STATUS_PILL,
} from '../shared/fields.js';
import { useUnloadGuard } from '../shared/useUnloadGuard.js';
import { loadApiKey } from '../shared/apiKey.js';
import {
  VIDEO_POLL,
  createPrediction,
  extractOutputUrl,
  friendlyErrorMessage,
  pollPrediction,
} from '../shared/replicate.js';
import {
  MODEL_CONFIGS,
  MODEL_KEYS,
  buildVideoInput,
  defaultOptionValues,
} from '../shared/videoModels.js';
import { extractFrame, fetchVideoBlob } from './video/frames.js';

const MODES = [
  {
    value: 'auto',
    title: 'Auto-run',
    desc: 'Generates the whole chain back-to-back — set the number of clips below.',
  },
  {
    value: 'review',
    title: 'Review each clip',
    desc: 'Pauses after every clip so you can continue, retry it, or finish.',
  },
];

const frameExt = (dataUri) => {
  const m = /^data:image\/(\w+)/.exec(dataUri || '');
  const type = m ? m[1].toLowerCase() : 'jpeg';
  return type === 'jpeg' ? 'jpg' : type;
};

const clipNo = (index) => String(index + 1).padStart(2, '0');

function triggerDownload(href, filename) {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function FrameThumb({ label, dataUri, filename }) {
  return (
    <div className="flex-1 min-w-0">
      <div className="font-mono text-[10.5px] text-text-dim mb-1">{label}</div>
      {dataUri ? (
        <img
          src={dataUri}
          alt=""
          title={`Download ${label.toLowerCase()}`}
          className="w-full aspect-video object-cover rounded-[10px] border border-panel-border bg-black cursor-pointer hover:border-accent"
          onClick={() => triggerDownload(dataUri, filename)}
        />
      ) : (
        <div className="w-full aspect-video rounded-[10px] border border-dashed border-panel-border" />
      )}
    </div>
  );
}

function ClipCard({ clip }) {
  const { index, status, startFrame, endFrame, videoUrl, remoteUrl, error } = clip;
  const n = clipNo(index);

  return (
    <div className="bg-panel-alt border border-panel-border rounded-2xl overflow-hidden flex flex-col">
      <div className="w-full aspect-video bg-black flex items-center justify-center relative overflow-hidden">
        {status === 'succeeded' && videoUrl ? (
          <video src={videoUrl} controls playsInline className="w-full h-full object-contain block" />
        ) : status === 'failed' ? (
          <div className="text-error font-mono text-2xl">!</div>
        ) : (
          <Spinner variant="light" />
        )}
      </div>
      <div className="pt-3 px-3.5 pb-3.5 flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[12px] text-text">Clip {index + 1}</span>
          <span className={`${STATUS_PILL.base} ${STATUS_PILL[status] || STATUS_PILL.queued}`}>
            {(status === 'queued' || status === 'running') && (
              <span
                className={`w-1.5 h-1.5 rounded-full bg-current ${
                  status === 'running' ? 'animate-klb-pulse' : ''
                }`}
              />
            )}
            {status}
          </span>
        </div>
        <div className="flex gap-2.5">
          <FrameThumb
            label="Start frame"
            dataUri={startFrame}
            filename={`clip-${n}-start-frame.${frameExt(startFrame)}`}
          />
          <FrameThumb
            label="End frame"
            dataUri={endFrame}
            filename={`clip-${n}-end-frame.${frameExt(endFrame)}`}
          />
        </div>
        {error && (
          <div className="text-[11.5px] text-error leading-[1.4] font-mono">{error}</div>
        )}
        {status === 'succeeded' && (
          <div className="flex gap-1.5 mt-0.5">
            {remoteUrl && (
              <a className={MINI_BTN} href={remoteUrl} target="_blank" rel="noopener noreferrer">
                Open
              </a>
            )}
            {videoUrl && (
              <button
                type="button"
                className={MINI_BTN}
                onClick={() => triggerDownload(videoUrl, `clip-${n}.mp4`)}
              >
                Video
              </button>
            )}
            {startFrame && (
              <button
                type="button"
                className={MINI_BTN}
                onClick={() =>
                  triggerDownload(startFrame, `clip-${n}-start-frame.${frameExt(startFrame)}`)
                }
              >
                Start
              </button>
            )}
            {endFrame && (
              <button
                type="button"
                className={MINI_BTN}
                onClick={() =>
                  triggerDownload(endFrame, `clip-${n}-end-frame.${frameExt(endFrame)}`)
                }
              >
                End
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ContinuousVideoStudio() {
  const [apiKey, setApiKey] = useState(() => loadApiKey());
  const [keyModalOpen, setKeyModalOpen] = useState(false);
  const [modelKey, setModelKey] = useState(MODEL_KEYS[0]);
  const [optionValues, setOptionValues] = useState(() => defaultOptionValues(MODEL_KEYS[0]));
  const [prompt, setPrompt] = useState('');
  const [firstFrame, setFirstFrame] = useState(null); // { dataUri, name }
  const [mode, setMode] = useState('auto');
  const [autoSteps, setAutoSteps] = useState('4');

  const [clips, setClips] = useState([]);
  const [phase, setPhase] = useState('idle'); // idle | running | awaiting | done
  // Review mode, set after each clip: { index, startFrame, endFrame, ok }.
  const [pending, setPending] = useState(null);
  const [runHint, setRunHint] = useState({ text: '', isError: false });
  const [downloadLabel, setDownloadLabel] = useState('Download all (.zip)');

  const cancelRef = useRef(false);
  const counterRef = useRef(0);
  const blobsRef = useRef(new Map()); // clip id -> video Blob (for the zip)

  const cfg = MODEL_CONFIGS[modelKey];
  const isRunning = phase === 'running';
  const chainActive = phase === 'running' || phase === 'awaiting';
  const succeededClips = clips.filter((c) => c.status === 'succeeded');

  // The chain lives in this tab: closing it loses the blobs and the end frame
  // the next clip would start from. Intercept close/reload while it's going.
  useUnloadGuard(chainActive);

  function changeModel(nextKey) {
    setModelKey(nextKey);
    setOptionValues(defaultOptionValues(nextKey));
  }

  function updateOption(field, rawValue) {
    const option = field.options.find((o) => String(o.value) === rawValue);
    if (!option) return;
    setOptionValues((prev) => ({ ...prev, [field.key]: option.value }));
  }

  function updateClip(id, patch) {
    setClips((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  // Generate one clip: create + poll the prediction, download the video and
  // pull its frames. Returns { ok, endFrame } — endFrame feeds the next clip.
  async function runClip(index, startFrame, key) {
    const id = `c${++counterRef.current}`;
    setClips((prev) => [
      ...prev,
      {
        id,
        index,
        status: 'queued',
        startFrame,
        endFrame: null,
        videoUrl: null,
        remoteUrl: null,
        error: null,
      },
    ]);
    try {
      const input = buildVideoInput(cfg, { prompt: prompt.trim(), optionValues, startFrameDataUri: startFrame });
      updateClip(id, { status: 'running' });
      const prediction = await createPrediction(modelKey, input, key);
      updateClip(id, { predictionId: prediction.id });
      const finalData = await pollPrediction(prediction.id, key, () => cancelRef.current, VIDEO_POLL);
      const remoteUrl = extractOutputUrl(finalData.output);
      if (!remoteUrl) throw new Error('No video returned by the model.');

      const blob = await fetchVideoBlob(remoteUrl);
      const videoUrl = URL.createObjectURL(blob);
      blobsRef.current.set(id, blob);
      const endFrame = await extractFrame(videoUrl, 'last');
      // Text-to-video first clip: pull the actual start frame from the video
      // so the downloads always include both frames.
      const actualStart = startFrame || (await extractFrame(videoUrl, 'first'));
      updateClip(id, {
        status: 'succeeded',
        videoUrl,
        remoteUrl,
        endFrame,
        startFrame: actualStart,
      });
      return { ok: true, endFrame };
    } catch (err) {
      updateClip(id, { status: 'failed', error: friendlyErrorMessage(err) });
      return { ok: false, endFrame: null };
    }
  }

  async function runAuto(total, initialFrame, key) {
    let frame = initialFrame;
    for (let i = 0; i < total; i++) {
      const res = await runClip(i, frame, key);
      if (cancelRef.current) {
        setPhase('done');
        setRunHint({ text: `Cancelled — ${i} of ${total} clips finished.`, isError: false });
        return;
      }
      if (!res.ok) {
        setPhase('done');
        setRunHint({ text: `Stopped — clip ${i + 1} of ${total} failed.`, isError: true });
        return;
      }
      frame = res.endFrame;
    }
    setPhase('done');
    setRunHint({ text: `All ${total} clips generated — download them below.`, isError: false });
  }

  async function runReviewStep(index, startFrame, key) {
    const res = await runClip(index, startFrame, key);
    if (cancelRef.current) {
      setPending(null);
      setPhase('done');
      setRunHint({ text: 'Cancelled.', isError: false });
      return;
    }
    setPending({ index, startFrame, endFrame: res.endFrame, ok: res.ok });
    setPhase('awaiting');
    setRunHint(
      res.ok
        ? { text: `Clip ${index + 1} is ready — review it below, then continue, retry, or finish.`, isError: false }
        : { text: `Clip ${index + 1} failed — retry it or finish the chain.`, isError: true }
    );
  }

  function startRun() {
    if (chainActive) return;
    const key = apiKey.trim();
    if (!key) {
      setRunHint({ text: 'Add your Replicate API token first.', isError: true });
      setKeyModalOpen(true);
      return;
    }
    if (!prompt.trim()) {
      setRunHint({ text: 'Write a prompt first.', isError: true });
      return;
    }
    if (cfg.requiresImage && !firstFrame) {
      setRunHint({ text: 'This model needs a start frame — upload one first.', isError: true });
      return;
    }
    const total = parseInt(autoSteps, 10);
    if (mode === 'auto' && (!Number.isFinite(total) || total < 1)) {
      setRunHint({ text: 'Set how many clips to generate (at least 1).', isError: true });
      return;
    }

    // A new chain replaces the previous one — free its blobs and object URLs.
    clips.forEach((c) => c.videoUrl && URL.revokeObjectURL(c.videoUrl));
    blobsRef.current = new Map();
    counterRef.current = 0;
    setClips([]);
    setPending(null);
    setDownloadLabel('Download all (.zip)');
    setRunHint({ text: '', isError: false });
    cancelRef.current = false;
    setPhase('running');

    const initialFrame = firstFrame?.dataUri || null;
    if (mode === 'auto') runAuto(total, initialFrame, key);
    else runReviewStep(0, initialFrame, key);
  }

  function cancel() {
    cancelRef.current = true;
    setRunHint({ text: 'Cancelling — finishing the current request…', isError: false });
  }

  function continueChain() {
    if (!pending?.ok) return;
    setPhase('running');
    runReviewStep(pending.index + 1, pending.endFrame, apiKey.trim());
  }

  function retryClip() {
    if (!pending) return;
    // Drop the clip being retried before re-running the same step.
    setClips((prev) => {
      const last = prev[prev.length - 1];
      if (last) {
        if (last.videoUrl) URL.revokeObjectURL(last.videoUrl);
        blobsRef.current.delete(last.id);
      }
      return prev.slice(0, -1);
    });
    setPhase('running');
    runReviewStep(pending.index, pending.startFrame, apiKey.trim());
  }

  function finishChain() {
    const done = clips.filter((c) => c.status === 'succeeded').length;
    setPending(null);
    setPhase('done');
    setRunHint({
      text: `Chain finished — ${done} ${done === 1 ? 'clip' : 'clips'} generated.`,
      isError: false,
    });
  }

  async function downloadAll() {
    setDownloadLabel('Zipping…');
    try {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      for (const c of succeededClips) {
        const n = clipNo(c.index);
        const blob = blobsRef.current.get(c.id);
        if (blob) zip.file(`clip-${n}.mp4`, blob);
        if (c.startFrame)
          zip.file(`clip-${n}-start-frame.${frameExt(c.startFrame)}`, c.startFrame.split(',')[1], {
            base64: true,
          });
        if (c.endFrame)
          zip.file(`clip-${n}-end-frame.${frameExt(c.endFrame)}`, c.endFrame.split(',')[1], {
            base64: true,
          });
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      triggerDownload(url, 'karmalab-video-chain.zip');
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('Could not build the zip file: ' + e.message);
    }
    setDownloadLabel('Download all (.zip)');
  }

  return (
    <div className="flex justify-center px-5 pt-10 pb-20">
      <div className="w-full max-w-225 flex flex-col gap-5">
        <TopBar
          active="/video-chain"
          apiKeySet={!!apiKey.trim()}
          onApiKeyClick={() => setKeyModalOpen(true)}
        />
        <Brand
          title="Continuous Video Studio"
          subtitle="Chain video clips — each one starts from the last frame of the previous."
        />

        <Panel title="Generation settings">
          <div className={FIELD}>
            <label className={LABEL} htmlFor="modelSelect">
              Model
            </label>
            <select
              id="modelSelect"
              className={SELECT}
              style={SELECT_CHEVRON}
              value={modelKey}
              onChange={(e) => changeModel(e.target.value)}
            >
              {MODEL_KEYS.map((k) => (
                <option key={k} value={k}>
                  {MODEL_CONFIGS[k].label}
                </option>
              ))}
            </select>
            {cfg.note && <div className={FIELD_HELP}>{cfg.note}</div>}
          </div>

          <div className="grid grid-cols-1 min-[620px]:grid-cols-2 gap-x-4">
            {cfg.fields.map((f) => (
              <div className={`${FIELD} !mb-4`} key={f.key}>
                <label className={LABEL} htmlFor={`opt_${f.key}`}>
                  {f.label}
                </label>
                <select
                  id={`opt_${f.key}`}
                  className={SELECT}
                  style={SELECT_CHEVRON}
                  value={String(optionValues[f.key])}
                  onChange={(e) => updateOption(f, e.target.value)}
                >
                  {f.options.map((o) => (
                    <option key={String(o.value)} value={String(o.value)}>
                      {o.label}
                    </option>
                  ))}
                </select>
                {f.help && <div className={FIELD_HELP}>{f.help}</div>}
              </div>
            ))}
          </div>

        </Panel>

        <Panel title="Prompt & first frame">

          <div className={FIELD}>
            <label className={LABEL} htmlFor="promptInput">
              Prompt (used for every clip)
            </label>
            <textarea
              id="promptInput"
              value={prompt}
              className={`${CONTROL} resize-y min-h-28 leading-[1.6] text-[14.5px]`}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. a slow cinematic dolly through a neon-lit alley in the rain"
            />
          </div>

          <div className={FIELD}>
            <label className={LABEL}>First frame (starts the chain)</label>
            <ImageDrop
              image={firstFrame}
              onChange={setFirstFrame}
              setLabel="First frame set"
              hint={
                cfg.requiresImage
                  ? 'Required by this model — the first clip animates from it'
                  : 'Optional · without it the first clip is text-to-video'
              }
            />
            <div className={FIELD_HELP}>
              Every following clip automatically starts from the end frame of the one before it.
            </div>
          </div>
        </Panel>

        <Panel title="Run">
          <div className={FIELD}>
            <div className="grid grid-cols-1 min-[620px]:grid-cols-2 gap-3">
              {MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setMode(m.value)}
                  className={`text-left rounded-[14px] border p-4 cursor-pointer transition-colors duration-150 ${
                    mode === m.value
                      ? 'border-accent bg-accent-dim'
                      : 'border-panel-border bg-panel-alt hover:border-[#4a4a4a]'
                  }`}
                >
                  <div className="text-[14.5px] font-medium mb-1">{m.title}</div>
                  <div className="text-[12px] text-text-dim leading-[1.4]">{m.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {mode === 'auto' && (
            <div className={FIELD}>
              <label className={LABEL} htmlFor="stepsInput">
                Number of clips
              </label>
              <Input
                id="stepsInput"
                type="number"
                min="1"
                max="50"
                value={autoSteps}
                onChange={(e) => setAutoSteps(e.target.value)}
              />
            </div>
          )}

          <div className="flex gap-2.5 items-center mt-4.5">
            <Button onClick={startRun} disabled={chainActive}>
              {isRunning ? (
                <>
                  <Spinner variant="dark" /> Generating…
                </>
              ) : phase === 'awaiting' ? (
                'Waiting for review below…'
              ) : clips.length ? (
                'Start a new chain'
              ) : (
                'Start the chain'
              )}
            </Button>
            {isRunning && (
              <Button variant="secondary" onClick={cancel}>
                Cancel
              </Button>
            )}
          </div>

          {chainActive ? (
            <div className="mt-3.5 border border-warning bg-warning-dim text-warning rounded-xl px-4 py-3 text-[12.5px] font-mono leading-[1.5] flex gap-2.5">
              <span>⚠</span>
              <span>
                Keep this page open — the chain runs in this tab, and closing it loses the videos
                and the frame that links one clip to the next.
              </span>
            </div>
          ) : (
            <div className={`${FIELD_HELP} text-center`}>
              Once generation starts, don't close this page — the chain runs entirely in this tab.
            </div>
          )}
          {runHint.text && (
            <div
              className={`font-mono text-[11.5px] text-center mt-2 ${
                runHint.isError ? 'text-error' : 'text-text-dim'
              }`}
            >
              {runHint.text}
            </div>
          )}
        </Panel>

        <Panel
          title="Clips"
          action={
            succeededClips.length > 0 ? (
              <Button
                variant="secondary"
                onClick={downloadAll}
                style={{ padding: '8px 16px', fontSize: 13 }}
              >
                {downloadLabel}
              </Button>
            ) : null
          }
        >
          {phase === 'awaiting' && pending && (
            <div className="border border-accent bg-accent-dim rounded-[14px] p-4 mb-4 flex flex-col min-[620px]:flex-row min-[620px]:items-center gap-3">
              <div className="flex-1 text-[13px] leading-[1.5]">
                {pending.ok
                  ? `Clip ${pending.index + 1} finished. Continue the chain from its end frame, retry it, or finish here.`
                  : `Clip ${pending.index + 1} failed. Retry it, or finish the chain with what you have.`}
              </div>
              <div className="flex gap-2 shrink-0">
                {pending.ok && (
                  <Button onClick={continueChain} className="!flex-none !px-4 !py-2.5 !text-[13px]">
                    Continue
                  </Button>
                )}
                <Button
                  variant="secondary"
                  onClick={retryClip}
                  className="!px-4 !py-2.5 !text-[13px]"
                >
                  Retry clip
                </Button>
                <Button
                  variant="secondary"
                  onClick={finishChain}
                  className="!px-4 !py-2.5 !text-[13px]"
                >
                  Finish
                </Button>
              </div>
            </div>
          )}

          {clips.length === 0 ? (
            <div className="text-center px-5 py-10 text-text-dim text-[13.5px] font-mono">
              No clips yet — set up the chain above and start it.
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(290px,1fr))] gap-3.5 mt-1">
              {clips.map((c) => (
                <ClipCard key={c.id} clip={c} />
              ))}
            </div>
          )}
        </Panel>
      </div>

      <ApiKeyModal
        open={keyModalOpen}
        onSaved={() => setApiKey(loadApiKey())}
        onClose={() => setKeyModalOpen(false)}
      />
    </div>
  );
}
