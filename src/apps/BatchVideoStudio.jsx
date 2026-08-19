import { useEffect, useRef, useState } from 'react';
import {
  ApiKeyModal,
  Brand,
  Button,
  ImageDrop,
  ImagesDrop,
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
  MAX_CONCURRENT,
  VIDEO_POLL,
  createPrediction,
  extractOutputUrl,
  friendlyErrorMessage,
  getPrediction,
  pollPrediction,
} from '../shared/replicate.js';
import {
  MODEL_CONFIGS,
  MODEL_KEYS,
  buildVideoInput,
  defaultOptionValues,
} from '../shared/videoModels.js';
import { MODES, buildItems, splitPrompts } from './batchVideo/items.js';
import { addJob, loadJobs, removeJob } from './batchVideo/storage.js';

// Replicate status → the UI's status vocabulary (queued / running / …).
const uiStatus = (status) =>
  status === 'processing' ? 'running' : status === 'starting' ? 'queued' : status;

function triggerDownload(href, filename) {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function ResultCard({ result }) {
  const [downloading, setDownloading] = useState(false);
  const { label, prompt, status, videoUrl, startFrame, basename, error } = result;

  async function download() {
    setDownloading(true);
    try {
      const resp = await fetch(videoUrl);
      const blob = await resp.blob();
      const objUrl = URL.createObjectURL(blob);
      triggerDownload(objUrl, `${basename}.mp4`);
      URL.revokeObjectURL(objUrl);
    } catch {
      window.open(videoUrl, '_blank');
    }
    setDownloading(false);
  }

  return (
    <div className="bg-panel-alt border border-panel-border rounded-2xl overflow-hidden flex flex-col">
      <div className="w-full aspect-video bg-black flex items-center justify-center relative overflow-hidden">
        {status === 'succeeded' && videoUrl ? (
          <video
            src={videoUrl}
            controls
            playsInline
            className="w-full h-full object-contain block"
          />
        ) : (
          <>
            {/* While it generates, the start frame previews what's coming. */}
            {startFrame && (
              <img
                src={startFrame}
                alt=""
                className="absolute inset-0 w-full h-full object-cover opacity-30"
              />
            )}
            {status === 'failed' ? (
              <div className="text-error font-mono text-2xl relative">!</div>
            ) : (
              <div className="relative">
                <Spinner variant="light" />
              </div>
            )}
          </>
        )}
      </div>
      <div className="pt-3 px-3.5 pb-3.5 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span
            className="font-mono text-[12px] text-text whitespace-nowrap overflow-hidden text-ellipsis"
            title={label}
          >
            {label}
          </span>
          <span
            className={`${STATUS_PILL.base} ${STATUS_PILL[status] || STATUS_PILL.queued} shrink-0`}
          >
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
        <div className="text-[12.5px] text-text-dim leading-[1.4] line-clamp-2" title={prompt}>
          {prompt}
        </div>
        {error && <div className="text-[11.5px] text-error leading-[1.4] font-mono">{error}</div>}
        {status === 'succeeded' && videoUrl && (
          <div className="flex gap-1.5 mt-0.5">
            <a className={MINI_BTN} href={videoUrl} target="_blank" rel="noopener noreferrer">
              Open
            </a>
            <button type="button" className={MINI_BTN} onClick={download}>
              {downloading ? '…' : 'Download'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function BatchVideoStudio() {
  const [apiKey, setApiKey] = useState(() => loadApiKey());
  const [keyModalOpen, setKeyModalOpen] = useState(false);
  const [modelKey, setModelKey] = useState(MODEL_KEYS[0]);
  const [optionValues, setOptionValues] = useState(() => defaultOptionValues(MODEL_KEYS[0]));
  const [mode, setMode] = useState('prompts');

  // Mode 'prompts': many prompts + one optional shared start frame.
  const [promptsText, setPromptsText] = useState('');
  const [sharedFrame, setSharedFrame] = useState(null); // { dataUri, name }
  // Mode 'frames': one prompt + many start frames.
  const [prompt, setPrompt] = useState('');
  const [frames, setFrames] = useState([]); // [{ id, dataUri, name }]

  const [results, setResults] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [runHint, setRunHint] = useState({ text: '', isError: false });
  const [downloadLabel, setDownloadLabel] = useState('Download all (.zip)');

  const cancelRef = useRef(false);
  const counterRef = useRef(0);

  const cfg = MODEL_CONFIGS[modelKey];
  const byPrompts = mode === 'prompts';
  const prompts = splitPrompts(promptsText);
  const count = byPrompts ? prompts.length : frames.length;
  const succeededResults = results.filter((r) => r.status === 'succeeded' && r.videoUrl);

  // Closing the tab loses the batch's progress tracking — intercept it while a
  // run is going (in-flight predictions are recovered on reopen, but finished
  // results that were never persisted are not).
  useUnloadGuard(isRunning);

  function changeModel(nextKey) {
    setModelKey(nextKey);
    setOptionValues(defaultOptionValues(nextKey));
  }

  function updateOption(field, rawValue) {
    const option = field.options.find((o) => String(o.value) === rawValue);
    if (!option) return;
    setOptionValues((prev) => ({ ...prev, [field.key]: option.value }));
  }

  function updateResult(id, patch) {
    setResults((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  // On open: if a token is saved and there are pending predictions from a
  // previous session, load them back and resume tracking any still in flight.
  // Videos take minutes, so this is the normal way a long batch finishes.
  // Results are keyed by prediction id here so a fresh run (keyed r1, r2, …)
  // never collides with a restored one.
  useEffect(() => {
    const key = loadApiKey().trim();
    const jobs = loadJobs();
    if (!key || !jobs.length) return;

    let stopped = false;

    setResults((prev) => {
      const known = new Set(prev.map((r) => r.id));
      const restored = jobs
        .filter((j) => !known.has(j.predictionId))
        .map((j) => ({
          id: j.predictionId,
          label: j.label,
          basename: j.basename,
          prompt: j.prompt,
          status: 'running',
          videoUrl: null,
          startFrame: null, // start frames are too big to persist
          error: null,
        }));
      return restored.length ? [...prev, ...restored] : prev;
    });

    async function resume(job) {
      const id = job.predictionId;
      const finish = (data) => {
        const videoUrl = extractOutputUrl(data.output);
        updateResult(
          id,
          videoUrl
            ? { status: 'succeeded', videoUrl }
            : { status: 'failed', error: 'No video returned by the model.' }
        );
        removeJob(id);
      };
      try {
        const data = await getPrediction(id, key);
        if (data.status === 'succeeded') {
          finish(data);
          return;
        }
        if (data.status === 'failed' || data.status === 'canceled') {
          updateResult(id, { status: 'failed', error: data.error || `Prediction ${data.status}` });
          removeJob(id);
          return;
        }
        // Still queued/running on Replicate — reflect it and resume polling.
        updateResult(id, { status: uiStatus(data.status) });
        const finalData = await pollPrediction(id, key, () => stopped, VIDEO_POLL);
        if (stopped) return;
        finish(finalData);
      } catch (err) {
        if (stopped) return;
        // Leave the job stored so a later reload can retry (e.g. transient
        // network/proxy errors); just surface the problem on the card.
        updateResult(id, { status: 'failed', error: friendlyErrorMessage(err) });
      }
    }

    jobs.forEach(resume);
    return () => {
      stopped = true;
    };
    // Run once on mount.
  }, []);

  async function handleGenerate() {
    if (isRunning) return;
    const key = apiKey.trim();
    if (!key) {
      setRunHint({ text: 'Add your Replicate API token first.', isError: true });
      setKeyModalOpen(true);
      return;
    }
    if (byPrompts) {
      if (!prompts.length) {
        setRunHint({ text: 'Add at least one prompt.', isError: true });
        return;
      }
      if (cfg.requiresImage && !sharedFrame) {
        setRunHint({ text: 'This model needs a start frame — upload one first.', isError: true });
        return;
      }
    } else {
      if (!prompt.trim()) {
        setRunHint({ text: 'Write the prompt first.', isError: true });
        return;
      }
      if (!frames.length) {
        setRunHint({ text: 'Upload at least one start frame.', isError: true });
        return;
      }
    }

    const items = buildItems({ mode, promptsText, sharedFrame, prompt, frames }).map((item) => ({
      ...item,
      id: `r${++counterRef.current}`,
    }));

    setRunHint({ text: '', isError: false });
    setDownloadLabel('Download all (.zip)');
    cancelRef.current = false;
    setIsRunning(true);

    setResults((prev) => [
      ...prev,
      ...items.map((it) => ({
        id: it.id,
        label: it.label,
        basename: it.basename,
        prompt: it.prompt,
        startFrame: it.startFrame,
        status: 'queued',
        videoUrl: null,
        error: null,
      })),
    ]);

    // The settings can change while the batch runs — freeze what it sends.
    const snapshot = { modelId: modelKey, cfg, optionValues: { ...optionValues } };

    async function runOne(item) {
      if (cancelRef.current) {
        updateResult(item.id, { status: 'failed', error: 'Cancelled before it started.' });
        return false;
      }
      updateResult(item.id, { status: 'running' });
      let predictionId = null;
      try {
        const input = buildVideoInput(snapshot.cfg, {
          prompt: item.prompt,
          optionValues: snapshot.optionValues,
          startFrameDataUri: item.startFrame,
        });
        const prediction = await createPrediction(snapshot.modelId, input, key);
        predictionId = prediction.id;
        // Persist the in-flight prediction so a closed tab (or a reload during a
        // long render) can pick it back up.
        addJob({
          predictionId,
          prompt: item.prompt,
          label: item.label,
          basename: item.basename,
        });
        updateResult(item.id, { predictionId });
        const finalData = await pollPrediction(
          predictionId,
          key,
          () => cancelRef.current,
          VIDEO_POLL
        );
        const videoUrl = extractOutputUrl(finalData.output);
        if (!videoUrl) throw new Error('No video returned by the model.');
        updateResult(item.id, { status: 'succeeded', videoUrl });
        removeJob(predictionId);
        return true;
      } catch (err) {
        updateResult(item.id, { status: 'failed', error: friendlyErrorMessage(err) });
        // A UI cancel only stops our polling — the prediction is still running on
        // Replicate, so keep the job to resume it next time. Real failures are done.
        if (predictionId && !cancelRef.current) removeJob(predictionId);
        return false;
      }
    }

    let cursor = 0;
    let succeeded = 0;
    async function worker() {
      while (cursor < items.length) {
        if (cancelRef.current) return;
        const idx = cursor++;
        const ok = await runOne(items[idx]);
        if (ok) succeeded += 1;
      }
    }
    const workers = [];
    for (let i = 0; i < Math.min(MAX_CONCURRENT, items.length); i++) workers.push(worker());
    await Promise.all(workers);

    setIsRunning(false);
    setRunHint({
      text: cancelRef.current
        ? `Cancelled — ${succeeded} of ${items.length} finished. Anything still rendering on Replicate is picked back up when you reload.`
        : `${succeeded} of ${items.length} generated successfully.`,
      isError: false,
    });
  }

  function cancel() {
    cancelRef.current = true;
    setRunHint({ text: 'Cancelling — finishing in-flight requests…', isError: false });
  }

  async function downloadAll() {
    setDownloadLabel('Zipping…');
    try {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      await Promise.all(
        succeededResults.map(async (r) => {
          try {
            const resp = await fetch(r.videoUrl);
            zip.file(`${r.basename}.mp4`, await resp.blob());
          } catch {
            /* skip failed fetch */
          }
        })
      );
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      triggerDownload(url, 'karmalab-videos.zip');
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
          active="/batch-videos"
          apiKeySet={!!apiKey.trim()}
          onApiKeyClick={() => setKeyModalOpen(true)}
        />
        <Brand
          title="Batch Video Studio"
          subtitle="Generate a batch of videos — one per prompt, or one per start frame."
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

        <Panel title="Batch">
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

          {byPrompts ? (
            <>
              <div className={FIELD}>
                <label className={LABEL} htmlFor="promptsInput">
                  Prompts — one per line
                </label>
                <textarea
                  id="promptsInput"
                  value={promptsText}
                  className={`${CONTROL} resize-y min-h-40 leading-[1.6] text-[14.5px]`}
                  onChange={(e) => setPromptsText(e.target.value)}
                  placeholder={
                    'One prompt per line, e.g.\na slow dolly through a neon-lit alley in the rain\na drone shot rising over a foggy pine forest\nclose-up of espresso pouring into a glass cup'
                  }
                />
              </div>

              <div className={FIELD}>
                <label className={LABEL}>Start frame (used for every video)</label>
                <ImageDrop
                  image={sharedFrame}
                  onChange={setSharedFrame}
                  setLabel="Start frame set"
                  hint={
                    cfg.requiresImage
                      ? 'Required by this model — every video animates from it'
                      : 'Optional · without it every video is text-to-video'
                  }
                />
                <div className={FIELD_HELP}>
                  Sent as the start frame of every generation in this batch.
                </div>
              </div>
            </>
          ) : (
            <>
              <div className={FIELD}>
                <label className={LABEL} htmlFor="sharedPromptInput">
                  Prompt (used for every start frame)
                </label>
                <textarea
                  id="sharedPromptInput"
                  value={prompt}
                  className={`${CONTROL} resize-y min-h-28 leading-[1.6] text-[14.5px]`}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="e.g. slow push in, subtle camera shake, the light shifts as the scene comes alive"
                />
              </div>

              <div className={FIELD}>
                <label className={LABEL}>Start frames — one video per image</label>
                <ImagesDrop
                  images={frames}
                  onChange={setFrames}
                  emptyLabel="Click or drop your start frames"
                  hint="Pick several at once — each one becomes its own video"
                />
                <div className="font-mono text-[12px] text-text-dim mt-2.5 text-right">
                  {frames.length} {frames.length === 1 ? 'start frame' : 'start frames'}
                </div>
              </div>
            </>
          )}

          <div className="flex gap-2.5 items-center mt-4.5">
            <Button onClick={handleGenerate} disabled={prompts.length == 0 || isRunning}>
              {isRunning ? (
                <>
                  <Spinner variant="dark" /> Generating…
                </>
              ) : count ? (
                `Generate ${count} ${count === 1 ? 'video' : 'videos'}`
              ) : (
                'Generate videos'
              )}
            </Button>
            {isRunning && (
              <Button variant="secondary" onClick={cancel}>
                Cancel
              </Button>
            )}
          </div>

          <div className={`${FIELD_HELP} text-center mt-2.5`}>
            Video renders take minutes each — {MAX_CONCURRENT} run at a time, and anything still
            rendering when the tab closes is picked back up on reload.
          </div>
          {runHint.text && (
            <div
              className={`font-mono text-[11.5px] text-center mt-1 ${
                runHint.isError ? 'text-error' : 'text-text-dim'
              }`}
            >
              {runHint.text}
            </div>
          )}
        </Panel>

        <Panel
          title="Results"
          action={
            succeededResults.length > 0 ? (
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
          {results.length === 0 ? (
            <div className="text-center px-5 py-10 text-text-dim text-[13.5px] font-mono">
              No videos yet — set up the batch above and hit generate.
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(290px,1fr))] gap-3.5 mt-1">
              {results.map((r) => (
                <ResultCard key={r.id} result={r} />
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
