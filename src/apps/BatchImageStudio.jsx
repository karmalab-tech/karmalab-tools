import { useEffect, useRef, useState } from 'react';
import { Brand, Button, ImageDrop, Input, Panel, Spinner } from '../shared/components';
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
  const [promptsText, setPromptsText] = useState('');
  const [results, setResults] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [runHint, setRunHint] = useState({ text: '', isError: false });
  const [downloadLabel, setDownloadLabel] = useState('Download all (.zip)');

  const cancelRef = useRef(false);
  const counterRef = useRef(0);

  const cfg = MODEL_CONFIGS[modelKey];
  const supportsImage = !!cfg.imageField;
  const prompts = promptsText.split('\n').map((p) => p.trim()).filter(Boolean);
  const succeededResults = results.filter((r) => r.status === 'succeeded' && r.imageUrl);

  // Closing the tab loses the batch's progress tracking — intercept it while a
  // run is going (in-flight predictions are recovered on reopen, but finished
  // results that were never persisted are not).
  useUnloadGuard(isRunning);

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
            </div>
            <div className={FIELD}>
              <label className={LABEL} htmlFor="aspectSelect">
                Aspect ratio / size
              </label>
              <select
                id="aspectSelect"
                className={SELECT}
                style={SELECT_CHEVRON}
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
            <ImageDrop
              image={referenceImage}
              onChange={setReferenceImage}
              disabled={!supportsImage}
              setLabel="Reference image set"
              hint="Optional · used as a reference for supported models"
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
