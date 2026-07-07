import { useEffect, useRef, useState } from 'react';
import { Brand, Button, Input, Panel, Spinner } from '../shared/components';
import { MODEL_CONFIGS, MODEL_KEYS, EXTRA_FIELD_KEYS } from './batch/models.js';
import {
  MAX_CONCURRENT,
  buildInput,
  createPrediction,
  getPrediction,
  pollPrediction,
  extractImageUrl,
} from './batch/replicate.js';
import { addJob, loadJobs, loadKey, removeJob, saveKey } from './batch/storage.js';

// Replicate status → the UI's status vocabulary (queued / running / …).
const uiStatus = (status) =>
  status === 'processing' ? 'running' : status === 'starting' ? 'queued' : status;

// Shared field styling reused across the native <label>/<select>/<textarea>
// controls (the ones not covered by the shared Input component).
const CONTROL =
  'w-full bg-panel-alt border border-panel-border rounded-xl text-text font-sans text-[15px] px-[14px] py-3 outline-none transition-[border-color] duration-150 focus:border-accent placeholder:text-[#555]';
const LABEL = 'block text-[13px] text-text-dim mb-1.5 font-mono';
const FIELD = 'mb-4 last:mb-0';
const FIELD_HELP =
  'text-[12px] text-text-dim mt-1.5 leading-[1.4] [&_a]:text-accent [&_a]:no-underline [&_a:hover]:underline';
const SELECT = `${CONTROL} appearance-none pr-9 cursor-pointer`;

// The <select> chevron stays an inline background: the data-URI SVG contains
// spaces, which are awkward to escape into a Tailwind arbitrary value.
const selectChevron = {
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%238a8a8a' stroke-width='1.5' fill='none' fill-rule='evenodd'/%3E%3C/svg%3E\")",
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 14px center',
};

const STATUS_PILL = {
  base: 'self-start font-mono text-[11px] rounded-xl px-2.5 py-1 inline-flex items-center gap-1.5 border',
  queued: 'border-panel-border text-text-dim',
  running: 'text-accent border-accent bg-accent-dim',
  succeeded: 'text-success border-success bg-success-dim',
  failed: 'text-error border-error bg-error-dim',
};

const MINI_BTN =
  'flex-1 bg-transparent border border-panel-border text-text-dim rounded-[10px] px-2 py-[7px] text-[11.5px] font-mono cursor-pointer text-center no-underline block transition-colors duration-150 hover:border-accent hover:text-accent';

const svgStroke = { fill: 'none', stroke: 'currentColor' };

const ImagePlaceholderIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" {...svgStroke} strokeWidth={1.8}>
    <rect x="3" y="3" width="18" height="18" rx="3" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <path d="M21 15l-5-5L5 21" />
  </svg>
);

const CloseIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" {...svgStroke} strokeWidth={2}>
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);

const firstAspect = (modelKey) => MODEL_CONFIGS[modelKey].aspectOptions[0].value;

function ResultCard({ result }) {
  const [downloading, setDownloading] = useState(false);
  const { id, prompt, status, imageUrl, error } = result;

  async function download() {
    setDownloading(true);
    try {
      const resp = await fetch(imageUrl);
      const blob = await resp.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = `karmalab-${id}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
    } catch {
      window.open(imageUrl, '_blank');
    }
    setDownloading(false);
  }

  return (
    <div className="bg-panel-alt border border-panel-border rounded-2xl overflow-hidden flex flex-col">
      <div className="w-full aspect-square bg-black flex items-center justify-center relative overflow-hidden">
        {status === 'succeeded' && imageUrl ? (
          <img src={imageUrl} alt="" className="w-full h-full object-cover block" />
        ) : status === 'failed' ? (
          <div className="text-error font-mono text-2xl">!</div>
        ) : (
          <Spinner variant="light" />
        )}
      </div>
      <div className="pt-3 px-3.5 pb-3.5 flex flex-col gap-2">
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
        <div
          className="text-[12.5px] text-text-dim leading-[1.4] line-clamp-2"
          title={prompt}
        >
          {prompt}
        </div>
        {error && (
          <div className="text-[11.5px] text-error leading-[1.4] font-mono">{error}</div>
        )}
        {status === 'succeeded' && imageUrl && (
          <div className="flex gap-1.5 mt-0.5">
            <a
              className={MINI_BTN}
              href={imageUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
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

export default function BatchImageStudio() {
  const [apiKey, setApiKey] = useState(() => loadKey('replicateToken'));
  const [modelKey, setModelKey] = useState(MODEL_KEYS[0]);
  const [aspect, setAspect] = useState(() => firstAspect(MODEL_KEYS[0]));
  const [extraValues, setExtraValues] = useState(() =>
    Object.fromEntries(EXTRA_FIELD_KEYS.map((k) => [k, loadKey(`extra.${k}`)]))
  );
  const [suffix, setSuffix] = useState('');
  const [referenceImage, setReferenceImage] = useState(null); // { dataUri, name }
  const [dragover, setDragover] = useState(false);
  const [promptsText, setPromptsText] = useState('');
  const [results, setResults] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [runHint, setRunHint] = useState({ text: '', isError: false });
  const [downloadLabel, setDownloadLabel] = useState('Download all (.zip)');

  const cancelRef = useRef(false);
  const counterRef = useRef(0);
  const fileInputRef = useRef(null);

  const cfg = MODEL_CONFIGS[modelKey];
  const supportsImage = !!cfg.imageField;
  const prompts = promptsText.split('\n').map((p) => p.trim()).filter(Boolean);
  const succeededResults = results.filter((r) => r.status === 'succeeded' && r.imageUrl);

  function updateApiKey(value) {
    setApiKey(value);
    saveKey('replicateToken', value.trim());
  }

  function changeModel(nextKey) {
    setModelKey(nextKey);
    setAspect(firstAspect(nextKey));
  }

  function updateExtra(key, value) {
    setExtraValues((prev) => ({ ...prev, [key]: value }));
    saveKey(`extra.${key}`, value.trim());
  }

  function handleFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => setReferenceImage({ dataUri: e.target.result, name: file.name });
    reader.readAsDataURL(file);
  }

  function clearImage() {
    setReferenceImage(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function updateResult(id, patch) {
    setResults((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  // On open: if a token is saved and there are pending predictions from a
  // previous session, load them back (with their prompts) and resume tracking
  // any that are still in flight. Results are keyed by prediction id here so a
  // fresh Generate run (keyed r1, r2, …) never collides with a restored one.
  useEffect(() => {
    const key = loadKey('replicateToken').trim();
    const jobs = loadJobs();
    if (!key || !jobs.length) return;

    let stopped = false;

    setResults((prev) => {
      const known = new Set(prev.map((r) => r.id));
      const restored = jobs
        .filter((j) => !known.has(j.predictionId))
        .map((j) => ({
          id: j.predictionId,
          prompt: j.prompt,
          status: 'running',
          imageUrl: null,
          error: null,
        }));
      return restored.length ? [...prev, ...restored] : prev;
    });

    async function resume(job) {
      const id = job.predictionId;
      try {
        const data = await getPrediction(id, key);
        if (data.status === 'succeeded') {
          const imageUrl = extractImageUrl(data.output);
          updateResult(
            id,
            imageUrl
              ? { status: 'succeeded', imageUrl }
              : { status: 'failed', error: 'No image returned by the model.' }
          );
          removeJob(id);
          return;
        }
        if (data.status === 'failed' || data.status === 'canceled') {
          updateResult(id, { status: 'failed', error: data.error || `Prediction ${data.status}` });
          removeJob(id);
          return;
        }
        // Still queued/running on Replicate — reflect it and resume polling.
        updateResult(id, { status: uiStatus(data.status) });
        const finalData = await pollPrediction(id, key, () => stopped);
        if (stopped) return;
        const imageUrl = extractImageUrl(finalData.output);
        updateResult(
          id,
          imageUrl
            ? { status: 'succeeded', imageUrl }
            : { status: 'failed', error: 'No image returned by the model.' }
        );
        removeJob(id);
      } catch (err) {
        if (stopped) return;
        // Leave the job stored so a later reload can retry (e.g. transient
        // network/proxy errors); just surface the problem on the card.
        updateResult(id, { status: 'failed', error: err.message || 'Could not load this job.' });
      }
    }

    jobs.forEach(resume);
    return () => {
      stopped = true;
    };
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleGenerate() {
    if (isRunning) return;
    if (!apiKey.trim()) {
      setRunHint({ text: 'Add your Replicate API token first.', isError: true });
      return;
    }
    if (!prompts.length) {
      setRunHint({ text: 'Add at least one prompt.', isError: true });
      return;
    }

    setRunHint({ text: '', isError: false });
    setDownloadLabel('Download all (.zip)');
    cancelRef.current = false;
    setIsRunning(true);

    const items = prompts.map((prompt) => ({ id: `r${++counterRef.current}`, prompt }));
    setResults((prev) => [
      ...prev,
      ...items.map((it) => ({ id: it.id, prompt: it.prompt, status: 'queued', imageUrl: null, error: null })),
    ]);

    const modelId = modelKey;
    const key = apiKey.trim();
    const snapshot = {
      suffix,
      aspect,
      referenceImageDataUri: referenceImage?.dataUri || null,
      extraValues,
    };

    async function runOne(item) {
      if (cancelRef.current) {
        updateResult(item.id, { status: 'failed', error: 'Cancelled before it started.' });
        return false;
      }
      updateResult(item.id, { status: 'running' });
      let predictionId = null;
      try {
        const input = buildInput(cfg, { promptText: item.prompt, ...snapshot });
        const prediction = await createPrediction(modelId, input, key);
        predictionId = prediction.id;
        // Persist the in-flight prediction so it can be recovered if the tab is
        // closed before it finishes; the result carries its id for the same run.
        addJob({ predictionId, prompt: item.prompt });
        updateResult(item.id, { predictionId });
        const finalData = await pollPrediction(predictionId, key, () => cancelRef.current);
        const imageUrl = extractImageUrl(finalData.output);
        if (!imageUrl) throw new Error('No image returned by the model.');
        updateResult(item.id, { status: 'succeeded', imageUrl });
        removeJob(predictionId);
        return true;
      } catch (err) {
        let message = err.message || 'Something went wrong.';
        if (/Failed to fetch|NetworkError|Load failed/i.test(message)) {
          message =
            'Request blocked before reaching Replicate — almost always the proxy. Make sure you are on the dev server (yarn dev) or the built server (yarn start).';
        }
        updateResult(item.id, { status: 'failed', error: message });
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
        ? `Cancelled — ${succeeded} of ${items.length} finished.`
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
        succeededResults.map(async (r, i) => {
          try {
            const resp = await fetch(r.imageUrl);
            const blob = await resp.blob();
            zip.file(`image-${i + 1}-${r.id}.png`, blob);
          } catch {
            /* skip failed fetch */
          }
        })
      );
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'karmalab-images.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('Could not build the zip file: ' + e.message);
    }
    setDownloadLabel('Download all (.zip)');
  }

  return (
    <div className="flex justify-center px-5 pt-10 pb-20">
      <div className="w-full max-w-225 flex flex-col gap-5">
        <Brand
          title="Batch Image Studio"
          subtitle="Paste a list of prompts, pick a model, generate them all in parallel."
        />

        <Panel title="Replicate API token">
          <div className={FIELD}>
            <Input
              revealable
              value={apiKey}
              placeholder="r8_••••••••••••••••••••••••••••••••"
              onChange={(e) => updateApiKey(e.target.value)}
            />
            <div className={FIELD_HELP}>
              Saved in this browser's local storage so you don't have to re-enter it — never sent
              anywhere but Replicate. Get a token at{' '}
              <a href="https://replicate.com/account/api-tokens" target="_blank" rel="noreferrer">
                replicate.com/account/api-tokens
              </a>
              .
            </div>
          </div>
        </Panel>

        <Panel title="Generation settings">
          <div className="grid grid-cols-1 min-[620px]:grid-cols-2 gap-4">
            <div className={FIELD}>
              <label className={LABEL} htmlFor="modelSelect">
                Model
              </label>
              <select
                id="modelSelect"
                className={SELECT}
                style={selectChevron}
                value={modelKey}
                onChange={(e) => changeModel(e.target.value)}
              >
                {MODEL_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {MODEL_CONFIGS[k].label}
                  </option>
                ))}
              </select>
            </div>
            <div className={FIELD}>
              <label className={LABEL} htmlFor="aspectSelect">
                Aspect ratio / size
              </label>
              <select
                id="aspectSelect"
                className={SELECT}
                style={selectChevron}
                value={aspect}
                onChange={(e) => setAspect(e.target.value)}
              >
                {cfg.aspectOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {cfg.aspectNote && <div className={FIELD_HELP}>{cfg.aspectNote}</div>}
            </div>
          </div>

          {(cfg.extraFields || []).map((f) => (
            <div className={FIELD} key={f.key}>
              <label className={LABEL} htmlFor={`extra_${f.key}`}>
                {f.label}
              </label>
              <Input
                id={`extra_${f.key}`}
                revealable={f.type === 'password'}
                type={f.type || 'text'}
                placeholder={f.placeholder || ''}
                value={extraValues[f.key] || ''}
                onChange={(e) => updateExtra(f.key, e.target.value)}
              />
              {f.help && <div className={FIELD_HELP}>{f.help}</div>}
            </div>
          ))}

          <div className={FIELD}>
            <label className={LABEL} htmlFor="suffixInput">
              Prompt suffix (appended to every prompt)
            </label>
            <Input
              id="suffixInput"
              placeholder="e.g. cinematic lighting, ultra detailed, 8k"
              value={suffix}
              onChange={(e) => setSuffix(e.target.value)}
            />
          </div>

          <div className={FIELD}>
            <label className={LABEL}>Reference image (used for every generation)</label>
            <div
              className={[
                'border-[1.5px] border-dashed border-panel-border rounded-[14px] p-4.5 flex items-center gap-3.5 cursor-pointer transition-[border-color,background] duration-150 bg-panel-alt hover:border-accent',
                !supportsImage && 'opacity-40 cursor-not-allowed pointer-events-none',
                dragover && 'border-accent',
                referenceImage && 'border-solid',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => supportsImage && fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                if (supportsImage) setDragover(true);
              }}
              onDragEnter={(e) => {
                e.preventDefault();
                if (supportsImage) setDragover(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setDragover(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDragover(false);
                if (supportsImage) handleFile(e.dataTransfer.files[0]);
              }}
            >
              {referenceImage ? (
                <img
                  className="w-13 h-13 rounded-[10px] object-cover bg-black shrink-0 border border-panel-border"
                  src={referenceImage.dataUri}
                  alt=""
                />
              ) : (
                <div className="w-13 h-13 rounded-[10px] shrink-0 flex items-center justify-center text-text-dim border border-panel-border">
                  <ImagePlaceholderIcon />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-[14px] mb-0.5">
                  {referenceImage ? 'Reference image set' : 'Click or drop an image'}
                </div>
                <div className="text-[12px] text-text-dim font-mono whitespace-nowrap overflow-hidden text-ellipsis">
                  {referenceImage
                    ? referenceImage.name
                    : 'Optional · used as a reference for supported models'}
                </div>
              </div>
              {referenceImage && (
                <button
                  type="button"
                  className="w-7.5 h-7.5 rounded-full border border-panel-border bg-transparent text-text-dim flex items-center justify-center cursor-pointer shrink-0 hover:border-error hover:text-error"
                  title="Remove image"
                  onClick={(e) => {
                    e.stopPropagation();
                    clearImage();
                  }}
                >
                  <CloseIcon />
                </button>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => handleFile(e.target.files[0])}
            />
            <div className={FIELD_HELP}>
              {supportsImage
                ? `Sent as ${cfg.imageIsArray ? 'an array containing this image' : 'a single reference image'} with every generation.`
                : 'This model does not support a reference image — it will be ignored.'}
            </div>
          </div>
        </Panel>

        <Panel title="Prompts">
          <textarea
            value={promptsText}
            className={`${CONTROL} resize-y min-h-40 leading-[1.6] text-[14.5px]`}
            onChange={(e) => setPromptsText(e.target.value)}
            placeholder={
              'One prompt per line, e.g.\na fox reading a book in a library\na neon city street in the rain\na bowl of ramen, top-down shot'
            }
          />
          <div className="font-mono text-[12px] text-text-dim mt-2.5 text-right">
            {prompts.length} {prompts.length === 1 ? 'prompt' : 'prompts'}
          </div>

          <div className="flex gap-2.5 items-center mt-4.5">
            <Button onClick={handleGenerate} disabled={isRunning}>
              {isRunning ? (
                <>
                  <Spinner variant="dark" /> Generating…
                </>
              ) : (
                'Generate images'
              )}
            </Button>
            {isRunning && (
              <Button variant="secondary" onClick={cancel}>
                Cancel
              </Button>
            )}
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
              No images yet — add prompts above and hit generate.
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3.5 mt-1">
              {results.map((r) => (
                <ResultCard key={r.id} result={r} />
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
