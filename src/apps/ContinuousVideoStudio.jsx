import { useRef, useState } from 'react';
import {
  ApiKeyModal,
  Brand,
  Button,
  ImageDrop,
  Input,
  Panel,
  RunHistoryModal,
  Spinner,
  StatusPill,
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
} from '../shared/fields.js';
import { loadApiKey } from '../shared/apiKey.js';
import { downloadUrl, downloadZip, triggerDownload } from '../shared/download.js';
import { useGenerationRun } from '../shared/useGenerationRun.js';
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
import { storage } from './video/storage.js';

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

// A recovered chain can be watched and downloaded, but not extended: the frame
// that links one clip to the next is extracted in this tab and never persisted.
const RESTORE_HINT = 'The chain stopped where the tab closed — start a new one to keep going.';

const frameExt = (dataUri) => {
  const m = /^data:image\/(\w+)/.exec(dataUri || '');
  const type = m ? m[1].toLowerCase() : 'jpeg';
  return type === 'jpeg' ? 'jpg' : type;
};

const clipNo = (index) => String((index ?? 0) + 1).padStart(2, '0');

const clipName = (clip) => `${clip.basename || `clip-${clipNo(clip.index)}`}.mp4`;

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

function ClipCard({ clip, cacheKey }) {
  const { index, status, startFrame, endFrame, videoUrl, outputUrl, error } = clip;
  const n = clipNo(index);
  // `videoUrl` is the in-memory blob of a clip generated in this tab; a clip
  // restored from a previous session plays from Replicate instead.
  const playable = videoUrl || outputUrl;
  const restored = status === 'succeeded' && !startFrame && !endFrame;

  return (
    <div className="bg-panel-alt border border-panel-border rounded-2xl overflow-hidden flex flex-col">
      <div className="w-full aspect-video bg-black flex items-center justify-center relative overflow-hidden">
        {status === 'succeeded' && playable ? (
          <video
            src={playable}
            controls
            playsInline
            className="w-full h-full object-contain block"
          />
        ) : status === 'failed' ? (
          <div className="text-error font-mono text-2xl">!</div>
        ) : (
          <Spinner variant="light" />
        )}
      </div>
      <div className="pt-3 px-3.5 pb-3.5 flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[12px] text-text">Clip {(index ?? 0) + 1}</span>
          <StatusPill status={status} />
        </div>
        {restored ? (
          <div className="font-mono text-[11px] text-text-dim leading-[1.4]">
            Recovered from a previous session — its start and end frames were not kept.
          </div>
        ) : (
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
        )}
        {error && <div className="text-[11.5px] text-error leading-[1.4] font-mono">{error}</div>}
        {status === 'succeeded' && (
          <div className="flex gap-1.5 mt-0.5">
            {outputUrl && (
              <a className={MINI_BTN} href={outputUrl} target="_blank" rel="noopener noreferrer">
                Open
              </a>
            )}
            {playable && (
              <button
                type="button"
                className={MINI_BTN}
                onClick={() =>
                  videoUrl
                    ? triggerDownload(videoUrl, clipName(clip))
                    : downloadUrl(outputUrl, clipName(clip), cacheKey)
                }
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

  const [phase, setPhase] = useState('idle'); // idle | running | awaiting | done
  // Review mode, set after each clip: { index, startFrame, endFrame, ok }.
  const [pending, setPending] = useState(null);
  const [runHint, setRunHint] = useState({ text: '', isError: false });
  const [downloadLabel, setDownloadLabel] = useState('Download all (.zip)');

  const cancelRef = useRef(false);
  const counterRef = useRef(0);
  const blobsRef = useRef(new Map()); // clip id -> video Blob (for the zip)

  const isRunning = phase === 'running';
  const chainActive = phase === 'running' || phase === 'awaiting';

  // The chain itself — its clips, their persistence, recovering an unfinished
  // chain when the tab is reopened, the history of past chains, the tab title,
  // and the warning on closing the tab (`guard` covers a chain paused for a
  // review, which has an end frame to lose even with nothing in flight).
  const gen = useGenerationRun({
    storage,
    pollOptions: VIDEO_POLL,
    guard: chainActive,
    missingOutput: 'No video returned by the model.',
    restoreHint: RESTORE_HINT,
    onNotice: (text, isError) => setRunHint({ text, isError }),
  });

  const cfg = MODEL_CONFIGS[modelKey];
  const clips = gen.items;
  const succeededClips = clips.filter((c) => c.status === 'succeeded');
  const busy = chainActive || gen.refreshing;

  function changeModel(nextKey) {
    setModelKey(nextKey);
    setOptionValues(defaultOptionValues(nextKey));
  }

  function updateOption(field, rawValue) {
    const option = field.options.find((o) => String(o.value) === rawValue);
    if (!option) return;
    setOptionValues((prev) => ({ ...prev, [field.key]: option.value }));
  }

  // Generate one clip: create + poll the prediction, download the video and
  // pull its frames. Returns { ok, endFrame } — endFrame feeds the next clip.
  async function runClip(index, startFrame, key) {
    const id = `c${++counterRef.current}`;
    gen.appendItems([
      {
        id,
        index,
        predictionId: null,
        status: 'queued',
        prompt: prompt.trim(),
        basename: `clip-${clipNo(index)}`,
        startFrame,
        endFrame: null,
        videoUrl: null,
        outputUrl: null,
        error: null,
      },
    ]);
    try {
      const input = buildVideoInput(cfg, {
        prompt: prompt.trim(),
        optionValues,
        startFrameDataUri: startFrame,
      });
      gen.updateItem(id, { status: 'running' });
      const prediction = await createPrediction(modelKey, input, key);
      // Storing the prediction id is what makes the clip recoverable: the chain
      // is persisted on every change, so a closed tab can fetch it back.
      gen.updateItem(id, { predictionId: prediction.id });
      const finalData = await pollPrediction(
        prediction.id,
        key,
        () => cancelRef.current,
        VIDEO_POLL
      );
      const outputUrl = extractOutputUrl(finalData.output);
      if (!outputUrl) throw new Error('No video returned by the model.');

      const blob = await fetchVideoBlob(outputUrl);
      const videoUrl = URL.createObjectURL(blob);
      blobsRef.current.set(id, blob);
      const endFrame = await extractFrame(videoUrl, 'last');
      // Text-to-video first clip: pull the actual start frame from the video
      // so the downloads always include both frames.
      const actualStart = startFrame || (await extractFrame(videoUrl, 'first'));
      gen.updateItem(id, {
        status: 'succeeded',
        videoUrl,
        outputUrl,
        endFrame,
        startFrame: actualStart,
      });
      return { ok: true, endFrame };
    } catch (err) {
      gen.updateItem(id, { status: 'failed', error: friendlyErrorMessage(err) });
      return { ok: false, endFrame: null };
    }
  }

  function endChain(hint) {
    setPhase('done');
    gen.finishRun();
    setRunHint(hint);
  }

  async function runAuto(total, initialFrame, key) {
    let frame = initialFrame;
    for (let i = 0; i < total; i++) {
      const res = await runClip(i, frame, key);
      if (cancelRef.current) {
        endChain({ text: `Cancelled — ${i} of ${total} clips finished.`, isError: false });
        return;
      }
      if (!res.ok) {
        endChain({ text: `Stopped — clip ${i + 1} of ${total} failed.`, isError: true });
        return;
      }
      frame = res.endFrame;
    }
    endChain({ text: `All ${total} clips generated — download them below.`, isError: false });
  }

  async function runReviewStep(index, startFrame, key) {
    const res = await runClip(index, startFrame, key);
    if (cancelRef.current) {
      setPending(null);
      endChain({ text: 'Cancelled.', isError: false });
      return;
    }
    setPending({ index, startFrame, endFrame: res.endFrame, ok: res.ok });
    setPhase('awaiting');
    setRunHint(
      res.ok
        ? {
            text: `Clip ${index + 1} is ready — review it below, then continue, retry, or finish.`,
            isError: false,
          }
        : { text: `Clip ${index + 1} failed — retry it or finish the chain.`, isError: true }
    );
  }

  function startRun() {
    if (busy) return;
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

    // A new chain replaces the previous one (which moves to the history list) —
    // free its blobs and object URLs.
    clips.forEach((c) => c.videoUrl && URL.revokeObjectURL(c.videoUrl));
    blobsRef.current = new Map();
    counterRef.current = 0;
    gen.startRun({ title: `Chain · ${cfg.label}`, items: [] });
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
    gen.setItems((prev) => {
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
    const done = succeededClips.length;
    setPending(null);
    endChain({
      text: `Chain finished — ${done} ${done === 1 ? 'clip' : 'clips'} generated.`,
      isError: false,
    });
  }

  async function downloadAll() {
    setDownloadLabel('Zipping…');
    try {
      const entries = [];
      for (const c of succeededClips) {
        const n = clipNo(c.index);
        const blob = blobsRef.current.get(c.id);
        // A clip generated in this tab is already in memory; a recovered one is
        // fetched back from Replicate.
        if (blob) entries.push({ name: clipName(c), blob });
        else if (c.outputUrl)
          entries.push({ name: clipName(c), url: c.outputUrl, key: gen.outputKey(c) });
        if (c.startFrame)
          entries.push({
            name: `clip-${n}-start-frame.${frameExt(c.startFrame)}`,
            base64: c.startFrame.split(',')[1],
          });
        if (c.endFrame)
          entries.push({
            name: `clip-${n}-end-frame.${frameExt(c.endFrame)}`,
            base64: c.endFrame.split(',')[1],
          });
      }
      // Replicate deletes a result an hour after it was made, so anything the
      // cache missed can be gone by download time. Say which, rather than
      // handing over a zip that is quietly short.
      const { missing } = await downloadZip('karmalab-video-chain.zip', entries);
      if (missing.length) {
        setRunHint({
          text: `${missing.length} file(s) could not be included — Replicate deletes results an hour after they are made, and these were not cached.`,
          isError: true,
        });
      }
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
          historyCount={gen.history.length}
          onHistoryClick={gen.openHistory}
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
            <Button onClick={startRun} disabled={busy}>
              {isRunning || gen.refreshing ? (
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
                Keep this page open — the chain runs in this tab. Closing it loses the frame that
                links one clip to the next, so the chain stops there; the clip being generated is
                picked back up on reload.
              </span>
            </div>
          ) : (
            <div className={`${FIELD_HELP} text-center`}>
              Don't close this page once generation starts — the chain is built in this tab. Past
              chains stay in History.
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
          title={gen.viewingHistory ? 'Clips · from history' : 'Clips'}
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
                <ClipCard key={c.id} clip={c} cacheKey={gen.outputKey(c)} />
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
      <RunHistoryModal {...gen.historyModal} />
    </div>
  );
}
