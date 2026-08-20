import { useRef, useState } from 'react';
import {
  ApiKeyModal,
  Brand,
  Button,
  ImageDrop,
  ImagesDrop,
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
import { downloadUrl, downloadZip } from '../shared/download.js';
import { useGenerationRun } from '../shared/useGenerationRun.js';
import {
  MAX_CONCURRENT,
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
import { MODES, buildItems, splitPrompts } from './batchVideo/items.js';
import { storage } from './batchVideo/storage.js';

const videoName = (item) => `${item.basename || `video-${item.id}`}.mp4`;

function ResultCard({ result }) {
  const [downloading, setDownloading] = useState(false);
  const { label, prompt, status, outputUrl, startFrame, error } = result;

  async function download() {
    setDownloading(true);
    await downloadUrl(outputUrl, videoName(result));
    setDownloading(false);
  }

  return (
    <div className="bg-panel-alt border border-panel-border rounded-2xl overflow-hidden flex flex-col">
      <div className="w-full aspect-video bg-black flex items-center justify-center relative overflow-hidden">
        {status === 'succeeded' && outputUrl ? (
          <video
            src={outputUrl}
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
          <StatusPill status={status} className="shrink-0" />
        </div>
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

  const [isRunning, setIsRunning] = useState(false);
  const [runHint, setRunHint] = useState({ text: '', isError: false });
  const [downloadLabel, setDownloadLabel] = useState('Download all (.zip)');

  const cancelRef = useRef(false);
  const counterRef = useRef(0);

  // The run itself — its cards, their persistence, recovering an unfinished run
  // when the tab is reopened, the history of past runs, the tab title and the
  // warning on closing the tab mid-run. Videos take minutes, so recovery is the
  // normal way a long batch finishes.
  const gen = useGenerationRun({
    storage,
    pollOptions: VIDEO_POLL,
    missingOutput: 'No video returned by the model.',
    onNotice: (text, isError) => setRunHint({ text, isError }),
  });

  const cfg = MODEL_CONFIGS[modelKey];
  const byPrompts = mode === 'prompts';
  const prompts = splitPrompts(promptsText);
  const count = byPrompts ? prompts.length : frames.length;
  const succeeded = gen.items.filter((r) => r.status === 'succeeded' && r.outputUrl);
  const busy = isRunning || gen.refreshing;

  function changeModel(nextKey) {
    setModelKey(nextKey);
    setOptionValues(defaultOptionValues(nextKey));
  }

  function updateOption(field, rawValue) {
    const option = field.options.find((o) => String(o.value) === rawValue);
    if (!option) return;
    setOptionValues((prev) => ({ ...prev, [field.key]: option.value }));
  }

  async function handleGenerate() {
    if (busy) return;
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

    // One flat list of run items, whichever mode built them.
    const items = buildItems({ mode, promptsText, sharedFrame, prompt, frames }).map((item) => ({
      ...item,
      id: `r${++counterRef.current}`,
      predictionId: null,
      status: 'queued',
      outputUrl: null,
      error: null,
    }));

    setRunHint({ text: '', isError: false });
    setDownloadLabel('Download all (.zip)');
    cancelRef.current = false;
    setIsRunning(true);

    // A new run replaces the one on screen, which moves to the history list.
    gen.startRun({
      title: `${items.length} video${items.length === 1 ? '' : 's'} · ${cfg.label}`,
      items,
    });

    // The settings can change while the batch runs — freeze what it sends.
    const snapshot = { modelId: modelKey, cfg, optionValues: { ...optionValues } };

    async function runOne(item) {
      if (cancelRef.current) {
        gen.updateItem(item.id, { status: 'failed', error: 'Cancelled before it started.' });
        return false;
      }
      gen.updateItem(item.id, { status: 'running' });
      try {
        const input = buildVideoInput(snapshot.cfg, {
          prompt: item.prompt,
          optionValues: snapshot.optionValues,
          startFrameDataUri: item.startFrame,
        });
        const prediction = await createPrediction(snapshot.modelId, input, key);
        // Storing the prediction id is what makes the card recoverable: the run
        // is persisted on every change, so a closed tab (or a reload during a
        // long render) can pick it back up.
        gen.updateItem(item.id, { predictionId: prediction.id });
        const finalData = await pollPrediction(
          prediction.id,
          key,
          () => cancelRef.current,
          VIDEO_POLL
        );
        const outputUrl = extractOutputUrl(finalData.output);
        if (!outputUrl) throw new Error('No video returned by the model.');
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
        ? `Cancelled — ${done} of ${items.length} finished. Anything still rendering on Replicate is picked back up when you reload.`
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
        'karmalab-videos.zip',
        succeeded.map((r) => ({ name: videoName(r), url: r.outputUrl }))
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
          active="/batch-videos"
          apiKeySet={!!apiKey.trim()}
          onApiKeyClick={() => setKeyModalOpen(true)}
          historyCount={gen.history.length}
          onHistoryClick={gen.openHistory}
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
            <Button onClick={handleGenerate} disabled={count == 0 || busy}>
              {busy ? (
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
            Video renders take minutes each — {MAX_CONCURRENT} run at a time. Anything still
            rendering when the tab closes is picked back up on reload, and finished runs stay in
            History.
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
              No videos yet — set up the batch above and hit generate.
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(290px,1fr))] gap-3.5 mt-1">
              {gen.items.map((r) => (
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
      <RunHistoryModal {...gen.historyModal} />
    </div>
  );
}
