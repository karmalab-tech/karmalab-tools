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
import { loadApiKey, loadOpenaiKey } from '../shared/apiKey.js';
import { downloadUrl, downloadZip } from '../shared/download.js';
import { useGenerationRun } from '../shared/useGenerationRun.js';
import { MODEL_CONFIGS, MODEL_KEYS, EXTRA_FIELD_KEYS } from './batch/models.js';
import {
  MAX_CONCURRENT,
  buildInput,
  createPrediction,
  pollPrediction,
  extractImageUrl,
  friendlyErrorMessage,
} from './batch/replicate.js';
import { loadKey, saveKey, storage } from './batch/storage.js';

const firstAspect = (modelKey) => MODEL_CONFIGS[modelKey].aspectOptions[0].value;

const pad = (n) => String(n).padStart(2, '0');

const imageName = (item) => `${item.basename || `image-${item.id}`}.png`;

function ResultCard({ result }) {
  const [downloading, setDownloading] = useState(false);
  const { prompt, status, outputUrl, error } = result;

  async function download() {
    setDownloading(true);
    await downloadUrl(outputUrl, imageName(result));
    setDownloading(false);
  }

  return (
    <div className="bg-panel-alt border border-panel-border rounded-2xl overflow-hidden flex flex-col">
      <div className="w-full aspect-square bg-black flex items-center justify-center relative overflow-hidden">
        {status === 'succeeded' && outputUrl ? (
          <img src={outputUrl} alt="" className="w-full h-full object-cover block" />
        ) : status === 'failed' ? (
          <div className="text-error font-mono text-2xl">!</div>
        ) : (
          <Spinner variant="light" />
        )}
      </div>
      <div className="pt-3 px-3.5 pb-3.5 flex flex-col gap-2">
        <StatusPill status={status} />
        <div className="text-[12.5px] text-text-dim leading-[1.4] line-clamp-2" title={prompt}>
          {prompt}
        </div>
        {error && <div className="text-[11.5px] text-error leading-[1.4] font-mono">{error}</div>}
        {status === 'succeeded' && outputUrl && (
          <div className="flex gap-1.5 mt-0.5">
            <a className={MINI_BTN} href={outputUrl} target="_blank" rel="noopener noreferrer">
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
  const [apiKey, setApiKey] = useState(() => loadApiKey());
  const [openaiKey, setOpenaiKey] = useState(() => loadOpenaiKey());
  const [keyModalOpen, setKeyModalOpen] = useState(false);
  const [modelKey, setModelKey] = useState(MODEL_KEYS[0]);
  const [aspect, setAspect] = useState(() => firstAspect(MODEL_KEYS[0]));
  const [extraValues, setExtraValues] = useState(() =>
    Object.fromEntries(EXTRA_FIELD_KEYS.map((k) => [k, loadKey(`extra.${k}`)]))
  );
  const [suffix, setSuffix] = useState('');
  const [referenceImage, setReferenceImage] = useState(null); // { dataUri, name }
  const [promptsText, setPromptsText] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [runHint, setRunHint] = useState({ text: '', isError: false });
  const [downloadLabel, setDownloadLabel] = useState('Download all (.zip)');

  const cancelRef = useRef(false);
  const counterRef = useRef(0);

  // The run itself — its cards, their persistence, recovering an unfinished run
  // when the tab is reopened, the history of past runs, the tab title and the
  // warning on closing the tab mid-run.
  const gen = useGenerationRun({
    storage,
    missingOutput: 'No image returned by the model.',
    onNotice: (text, isError) => setRunHint({ text, isError }),
  });

  const cfg = MODEL_CONFIGS[modelKey];
  const supportsImage = !!cfg.imageField;
  const prompts = promptsText
    .split('\n')
    .map((p) => p.trim())
    .filter(Boolean);
  const succeeded = gen.items.filter((r) => r.status === 'succeeded' && r.outputUrl);
  const busy = isRunning || gen.refreshing;

  function refreshKeys() {
    setApiKey(loadApiKey());
    setOpenaiKey(loadOpenaiKey());
  }

  function changeModel(nextKey) {
    setModelKey(nextKey);
    setAspect(firstAspect(nextKey));
  }

  function updateExtra(key, value) {
    setExtraValues((prev) => ({ ...prev, [key]: value }));
    saveKey(`extra.${key}`, value.trim());
  }

  async function handleGenerate() {
    if (busy) return;
    if (!apiKey.trim()) {
      setRunHint({ text: 'Add your Replicate API token first.', isError: true });
      setKeyModalOpen(true);
      return;
    }
    const needsOpenaiKey = (cfg.extraFields || []).some((f) => f.type === 'apiKey');
    if (needsOpenaiKey && !openaiKey.trim()) {
      setRunHint({ text: 'This model needs your OpenAI API key — add it first.', isError: true });
      setKeyModalOpen(true);
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

    // A new run replaces the one on screen, which moves to the history list.
    const items = prompts.map((prompt, i) => ({
      id: `r${++counterRef.current}`,
      predictionId: null,
      status: 'queued',
      prompt,
      basename: `image-${pad(i + 1)}`,
      outputUrl: null,
      error: null,
    }));
    gen.startRun({
      title: `${items.length} image${items.length === 1 ? '' : 's'} · ${cfg.label}`,
      items,
    });

    const modelId = modelKey;
    const key = apiKey.trim();
    const snapshot = {
      suffix,
      aspect,
      referenceImageDataUri: referenceImage?.dataUri || null,
      // The OpenAI key lives in the shared key storage, not extraValues —
      // merge it in so buildInput picks it up like any other extra field.
      extraValues: { ...extraValues, openai_api_key: openaiKey },
    };

    async function runOne(item) {
      if (cancelRef.current) {
        gen.updateItem(item.id, { status: 'failed', error: 'Cancelled before it started.' });
        return false;
      }
      gen.updateItem(item.id, { status: 'running' });
      try {
        const input = buildInput(cfg, { promptText: item.prompt, ...snapshot });
        const prediction = await createPrediction(modelId, input, key);
        // Storing the prediction id is what makes the card recoverable: the run
        // is persisted on every change, so a closed tab can fetch it back.
        gen.updateItem(item.id, { predictionId: prediction.id });
        const finalData = await pollPrediction(prediction.id, key, () => cancelRef.current);
        const outputUrl = extractImageUrl(finalData.output);
        if (!outputUrl) throw new Error('No image returned by the model.');
        gen.updateItem(item.id, { status: 'succeeded', outputUrl });
        return true;
      } catch (err) {
        gen.updateItem(item.id, { status: 'failed', error: friendlyErrorMessage(err) });
        return false;
      }
    }

    let cursor = 0;
    let done = 0;
    async function worker() {
      while (cursor < items.length) {
        if (cancelRef.current) return;
        const idx = cursor++;
        const ok = await runOne(items[idx]);
        if (ok) done += 1;
      }
    }
    const workers = [];
    for (let i = 0; i < Math.min(MAX_CONCURRENT, items.length); i++) workers.push(worker());
    await Promise.all(workers);

    setIsRunning(false);
    gen.finishRun();
    setRunHint({
      text: cancelRef.current
        ? `Cancelled — ${done} of ${items.length} finished. Anything still generating on Replicate is picked back up when you reload.`
        : `${done} of ${items.length} generated successfully.`,
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
      await downloadZip(
        'karmalab-images.zip',
        succeeded.map((r) => ({ name: imageName(r), url: r.outputUrl }))
      );
    } catch (e) {
      alert('Could not build the zip file: ' + e.message);
    }
    setDownloadLabel('Download all (.zip)');
  }

  return (
    <div className="flex justify-center px-5 pt-10 pb-20">
      <div className="w-full max-w-225 flex flex-col gap-5">
        <TopBar
          active="/"
          apiKeySet={!!apiKey.trim()}
          onApiKeyClick={() => setKeyModalOpen(true)}
          historyCount={gen.history.length}
          onHistoryClick={gen.openHistory}
        />
        <Brand
          title="Batch Image Studio"
          subtitle="Paste a list of prompts, pick a model, generate them all in parallel."
        />

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
              {f.type === 'apiKey' ? (
                <button
                  type="button"
                  id={`extra_${f.key}`}
                  onClick={() => setKeyModalOpen(true)}
                  className={`${CONTROL} cursor-pointer text-left inline-flex items-center gap-2.5 hover:border-accent ${
                    openaiKey.trim() ? '' : 'text-text-dim'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full inline-block shrink-0 ${
                      openaiKey.trim() ? 'bg-success' : 'bg-error'
                    }`}
                  />
                  {openaiKey.trim()
                    ? 'OpenAI API key set — manage in API keys'
                    : 'Add your OpenAI API key…'}
                </button>
              ) : (
                <Input
                  id={`extra_${f.key}`}
                  type={f.type || 'text'}
                  placeholder={f.placeholder || ''}
                  value={extraValues[f.key] || ''}
                  onChange={(e) => updateExtra(f.key, e.target.value)}
                />
              )}
              {f.help && <div className={FIELD_HELP}>{f.help}</div>}
            </div>
          ))}
        </Panel>

        <Panel title="Prompts">
          <div className={FIELD}>
            <label className={LABEL} htmlFor="suffixInput">
              List of prompts (one per line)
            </label>
            <textarea
              value={promptsText}
              className={`${CONTROL} resize-y min-h-40 leading-[1.6] text-[14.5px]`}
              onChange={(e) => setPromptsText(e.target.value)}
              placeholder={
                'One prompt per line, e.g.\na fox reading a book in a library\na neon city street in the rain\na bowl of ramen, top-down shot'
              }
            />
          </div>

          <div className={FIELD}>
            <label className={LABEL} htmlFor="suffixInput">
              Prompt suffix (appended to every prompt) - optional
            </label>
            <Input
              id="suffixInput"
              placeholder="e.g. cinematic lighting, ultra detailed, 8k"
              value={suffix}
              onChange={(e) => setSuffix(e.target.value)}
            />
          </div>

          <div className={FIELD}>
            <label className={LABEL}>Reference image (used for every generation) - optional</label>
            <ImageDrop
              image={referenceImage}
              onChange={setReferenceImage}
              disabled={!supportsImage}
              setLabel="Reference image set"
              hint={
                supportsImage
                  ? 'Will be used as a reference'
                  : 'This model does not support a reference image — it will be ignored.'
              }
            />
          </div>

          <div className="flex gap-2.5 items-center mt-4.5">
            <Button onClick={handleGenerate} disabled={prompts.length == 0 || busy}>
              {busy ? (
                <>
                  <Spinner variant="dark" /> Generating…
                </>
              ) : (
                `Generate ${prompts.length} image${prompts.length === 1 ? '' : 's'}`
              )}
            </Button>
            {isRunning && (
              <Button variant="secondary" onClick={cancel}>
                Cancel
              </Button>
            )}
          </div>
          <div className={`${FIELD_HELP} text-center mt-2.5`}>
            Anything still generating when the tab closes is picked back up on reload, and finished
            runs stay in History.
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
          title={gen.viewingHistory ? 'Results · from history' : 'Results'}
          action={
            succeeded.length > 0 ? (
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
          {gen.items.length === 0 ? (
            <div className="text-center px-5 py-10 text-text-dim text-[13.5px] font-mono">
              No images yet — add prompts above and hit generate.
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3.5 mt-1">
              {gen.items.map((r) => (
                <ResultCard key={r.id} result={r} />
              ))}
            </div>
          )}
        </Panel>
      </div>

      <ApiKeyModal
        open={keyModalOpen}
        onSaved={refreshKeys}
        onClose={() => setKeyModalOpen(false)}
      />
      <RunHistoryModal {...gen.historyModal} />
    </div>
  );
}
