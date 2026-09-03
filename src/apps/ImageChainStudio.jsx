import { useEffect, useRef, useState } from 'react';
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
import {
  CHAIN_MODEL_KEYS,
  EXTRA_FIELD_KEYS,
  MODEL_CONFIGS,
  buildImageInput,
} from '../shared/imageModels.js';
import {
  createPrediction,
  extractOutputUrl,
  friendlyErrorMessage,
  pollPrediction,
} from '../shared/replicate.js';
import {
  MAX_STEPS,
  chainSource,
  chainTitle,
  imageName,
  nextStepIndex,
  parseStepCount,
  sourceLabel,
  stepBasename,
  stepId,
  stepLabel,
} from './imageChain/chain.js';
import { loadKey, saveKey, storage } from './imageChain/storage.js';

const needsOpenaiKey = (cfg) => (cfg.extraFields || []).some((f) => f.type === 'apiKey');

// What the tool opens on: an image-to-image editing model, which is what a
// chain wants — every step is handed the previous image and asked to take it
// one step further. Falls back to the first chainable model if it ever leaves
// the catalogue.
const PREFERRED_MODEL = 'black-forest-labs/flux-kontext-pro';
const DEFAULT_MODEL = CHAIN_MODEL_KEYS.includes(PREFERRED_MODEL)
  ? PREFERRED_MODEL
  : CHAIN_MODEL_KEYS[0];

const firstAspect = (modelKey) => MODEL_CONFIGS[modelKey].aspectOptions[0].value;

// The model and aspect are remembered per browser: a chain is continued across
// reloads, and coming back to a different model would quietly change what the
// next step generates. Anything unrecognised (an old value, a model that has
// since gone) falls back to the default.
const savedModel = () => {
  const saved = loadKey('model');
  return CHAIN_MODEL_KEYS.includes(saved) ? saved : DEFAULT_MODEL;
};

const savedAspect = (modelKey) => {
  const saved = loadKey('aspect');
  const options = MODEL_CONFIGS[modelKey].aspectOptions;
  return options.some((o) => o.value === saved) ? saved : options[0].value;
};

// A mini-button that is unavailable while the chain is generating.
const MINI_BTN_ACTION = `${MINI_BTN} disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-panel-border disabled:hover:text-text-dim`;

function StepCard({ step, busy, onRetry }) {
  const [downloading, setDownloading] = useState(false);
  const { index, label, status, outputUrl, error, from } = step;

  async function download() {
    setDownloading(true);
    await downloadUrl(outputUrl, imageName(step));
    setDownloading(false);
  }

  return (
    <div className="bg-panel-alt border border-panel-border rounded-2xl overflow-hidden flex flex-col">
      <div className="w-full aspect-square bg-black flex items-center justify-center relative overflow-hidden">
        {status === 'succeeded' && outputUrl ? (
          // Contained rather than cropped: the point of a chain is watching the
          // image drift from step to step, framing included.
          <img src={outputUrl} alt="" className="w-full h-full object-contain block" />
        ) : status === 'failed' ? (
          <div className="text-error font-mono text-2xl">!</div>
        ) : (
          <Spinner variant="light" />
        )}
      </div>
      <div className="pt-3 px-3.5 pb-3.5 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[12px] text-text">{label || stepLabel(index ?? 0)}</span>
          <StatusPill status={status} />
        </div>
        <div className="font-mono text-[11px] text-text-dim leading-[1.4]">
          {from ? `Continues ${from}` : 'Starts the chain'}
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
        {status === 'failed' && (
          <div className="flex gap-1.5 mt-0.5">
            <button
              type="button"
              className={MINI_BTN_ACTION}
              onClick={() => onRetry(step)}
              disabled={busy}
              title={
                busy
                  ? 'Wait for the current step to finish'
                  : 'Generate this step again from the same image'
              }
            >
              Retry this step
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ImageChainStudio() {
  const [apiKey, setApiKey] = useState(() => loadApiKey());
  const [openaiKey, setOpenaiKey] = useState(() => loadOpenaiKey());
  const [keyModalOpen, setKeyModalOpen] = useState(false);
  const [modelKey, setModelKey] = useState(savedModel);
  const [aspect, setAspect] = useState(() => savedAspect(savedModel()));
  const [extraValues, setExtraValues] = useState(() =>
    Object.fromEntries(EXTRA_FIELD_KEYS.map((k) => [k, loadKey(`extra.${k}`)]))
  );
  const [prompt, setPrompt] = useState('');
  const [firstReference, setFirstReference] = useState(null); // { dataUri, name }
  const [stepsText, setStepsText] = useState('4');
  const [isRunning, setIsRunning] = useState(false);
  const [runHint, setRunHint] = useState({ text: '', isError: false });
  const [downloadLabel, setDownloadLabel] = useState('Download all (.zip)');

  const cancelRef = useRef(false);
  const promptTouchedRef = useRef(false);

  // The chain itself — its steps, their persistence, recovering an unfinished
  // chain when the tab is reopened, the history of past chains, the tab title
  // and the warning on closing the tab mid-step.
  const gen = useGenerationRun({
    storage,
    missingOutput: 'No image returned by the model.',
    onNotice: (text, isError) => setRunHint({ text, isError }),
  });

  const cfg = MODEL_CONFIGS[modelKey];
  const steps = gen.items;
  const succeeded = steps.filter((s) => s.status === 'succeeded' && s.outputUrl);
  const busy = isRunning || gen.refreshing;
  // A chain can be extended as long as one step produced an image: that image
  // is the reference the next step starts from. It survives a reload and a trip
  // through history, because it is only a URL.
  const source = chainSource(steps);
  const stepCount = parseStepCount(stepsText);

  // A chain recovered on reload — or opened from history — comes back with the
  // prompt its steps were generated from, but the prompt box is component state
  // and starts empty. Fill it back in, so the chain can be continued without
  // retyping it, and leave it alone once the user has typed something.
  const chainPrompt = steps.length ? steps[steps.length - 1].prompt || '' : '';
  useEffect(() => {
    if (promptTouchedRef.current || !chainPrompt) return;
    setPrompt(chainPrompt);
  }, [chainPrompt]);

  function refreshKeys() {
    setApiKey(loadApiKey());
    setOpenaiKey(loadOpenaiKey());
  }

  function changeModel(nextKey) {
    setModelKey(nextKey);
    saveKey('model', nextKey);
    changeAspect(firstAspect(nextKey));
  }

  function changeAspect(value) {
    setAspect(value);
    saveKey('aspect', value);
  }

  function updateExtra(key, value) {
    setExtraValues((prev) => ({ ...prev, [key]: value }));
    saveKey(`extra.${key}`, value.trim());
  }

  // One step's card, before it has been generated. `from` is the step whose
  // image it starts from, for the line on the card.
  function newStep(index, from) {
    return {
      id: stepId(index),
      index,
      predictionId: null,
      status: 'queued',
      prompt: prompt.trim(),
      label: stepLabel(index),
      basename: stepBasename(index),
      from,
      outputUrl: null,
      error: null,
    };
  }

  // Generate one step that is already on screen: create + poll the prediction.
  // Returns { ok, outputUrl } — the URL is what the next step uses as its
  // reference image.
  async function runStep(step, reference, key) {
    const { id, prompt: promptText } = step;
    try {
      const input = buildImageInput(cfg, {
        promptText,
        aspect,
        // Replicate fetches a reference image by URL server-side, so a step
        // hands the next one its output URL rather than the image itself.
        referenceImage: reference,
        // The OpenAI key lives in the shared key storage, not extraValues —
        // merge it in so buildImageInput picks it up like any other extra field.
        extraValues: { ...extraValues, openai_api_key: openaiKey },
      });
      gen.updateItem(id, { status: 'running' });
      const prediction = await createPrediction(modelKey, input, key);
      // Storing the prediction id is what makes the step recoverable: the chain
      // is persisted on every change, so a closed tab can fetch it back.
      gen.updateItem(id, { predictionId: prediction.id });
      const finalData = await pollPrediction(prediction.id, key, () => cancelRef.current);
      const outputUrl = extractOutputUrl(finalData.output);
      if (!outputUrl) throw new Error('No image returned by the model.');
      gen.updateItem(id, { status: 'succeeded', outputUrl });
      return { ok: true, outputUrl };
    } catch (err) {
      gen.updateItem(id, { status: 'failed', error: friendlyErrorMessage(err) });
      return { ok: false, outputUrl: null };
    }
  }

  function endChain(hint) {
    setIsRunning(false);
    gen.finishRun();
    setRunHint(hint);
  }

  async function runChain(total, startIndex, initialReference, initialFrom, key) {
    let reference = initialReference;
    let from = initialFrom;
    for (let i = 0; i < total; i++) {
      const step = newStep(startIndex + i, from);
      gen.appendItems([step]);
      const res = await runStep(step, reference, key);
      if (cancelRef.current) {
        endChain({ text: `Cancelled — ${i} of ${total} steps finished.`, isError: false });
        return;
      }
      if (!res.ok) {
        endChain({
          text: `Stopped — ${step.label.toLowerCase()} failed. Retry it on its card below, or run again to carry on from the last image.`,
          isError: true,
        });
        return;
      }
      reference = res.outputUrl;
      from = step.label;
    }
    endChain({
      text: `${total} ${total === 1 ? 'step' : 'steps'} generated — run again to continue the chain, or download them below.`,
      isError: false,
    });
  }

  // Everything a run needs before it can start: the keys, a prompt and — for
  // anything but a single-step retry — a sane step count. Returns the Replicate
  // token, or null after leaving a hint about what is missing.
  function checkedKey({ needsStepCount = true } = {}) {
    const key = apiKey.trim();
    if (!key) {
      setRunHint({ text: 'Add your Replicate API token first.', isError: true });
      setKeyModalOpen(true);
      return null;
    }
    if (needsOpenaiKey(cfg) && !openaiKey.trim()) {
      setRunHint({ text: 'This model needs your OpenAI API key — add it first.', isError: true });
      setKeyModalOpen(true);
      return null;
    }
    if (!prompt.trim()) {
      setRunHint({ text: 'Write a prompt first.', isError: true });
      return null;
    }
    if (needsStepCount && !stepCount) {
      setRunHint({ text: `Set how many steps to generate (1 to ${MAX_STEPS}).`, isError: true });
      return null;
    }
    return key;
  }

  function startChain() {
    if (busy) return;
    const key = checkedKey();
    if (!key) return;

    // A new chain replaces the one on screen, which moves to the history list.
    gen.startRun({ title: chainTitle(cfg.label), items: [] });
    setDownloadLabel('Download all (.zip)');
    setRunHint({ text: '', isError: false });
    cancelRef.current = false;
    setIsRunning(true);
    runChain(stepCount, 0, firstReference?.dataUri || null, '', key);
  }

  // Run again on a finished chain: more steps, continuing from its last image,
  // appended to the same run rather than starting a new one.
  function continueChain() {
    if (busy) return;
    if (!source) return;
    const key = checkedKey();
    if (!key) return;

    setDownloadLabel('Download all (.zip)');
    setRunHint({ text: '', isError: false });
    cancelRef.current = false;
    setIsRunning(true);
    gen.continueRun();
    runChain(stepCount, nextStepIndex(steps), source.outputUrl, sourceLabel(source), key);
  }

  // Retry a step that failed, in place: same number, and the same image it was
  // handed the first time (the newest one before it), so the rest of the chain
  // still lines up. This is the way out of a chain that stopped on an error —
  // including one that failed on its very first step, where there is no image
  // to continue from yet.
  async function retryStep(step) {
    if (busy) return;
    const key = checkedKey({ needsStepCount: false });
    if (!key) return;

    const index = step.index ?? 0;
    const before = chainSource(steps, index);
    const reference = before ? before.outputUrl : firstReference?.dataUri || null;
    const fresh = newStep(index, sourceLabel(before));

    setDownloadLabel('Download all (.zip)');
    setRunHint({ text: '', isError: false });
    cancelRef.current = false;
    setIsRunning(true);
    // The chain may already have been archived; take it back so the retry is
    // part of it rather than of nothing.
    gen.continueRun();
    gen.setItems((prev) => prev.map((it) => (it.id === step.id ? fresh : it)));
    const res = await runStep(fresh, reference, key);
    endChain(
      res.ok
        ? {
            text: `${fresh.label} generated — run again to carry the chain on from it.`,
            isError: false,
          }
        : {
            text: `${fresh.label} failed again — its card says why.`,
            isError: true,
          }
    );
  }

  function cancel() {
    cancelRef.current = true;
    setRunHint({ text: 'Cancelling — finishing the current request…', isError: false });
  }

  async function downloadAll() {
    setDownloadLabel('Zipping…');
    try {
      await downloadZip(
        'karmalab-image-chain.zip',
        succeeded.map((s) => ({ name: imageName(s), url: s.outputUrl }))
      );
    } catch (e) {
      alert('Could not build the zip file: ' + e.message);
    }
    setDownloadLabel('Download all (.zip)');
  }

  const stepsLabel = `${stepCount || 0} ${stepCount === 1 ? 'step' : 'steps'}`;

  return (
    <div className="flex justify-center px-5 pt-10 pb-20">
      <div className="w-full max-w-225 flex flex-col gap-5">
        <TopBar
          active="/image-chain"
          apiKeySet={!!apiKey.trim()}
          onApiKeyClick={() => setKeyModalOpen(true)}
          historyCount={gen.history.length}
          onHistoryClick={gen.openHistory}
        />
        <Brand
          title="Image Chain Studio"
          subtitle="Chain images — each one is generated from the previous one as its reference."
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
                {CHAIN_MODEL_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {MODEL_CONFIGS[k].label}
                  </option>
                ))}
              </select>
              <div className={FIELD_HELP}>
                Only models that take a reference image are listed — the chain needs one.
              </div>
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
                onChange={(e) => changeAspect(e.target.value)}
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

        <Panel title="Prompt & first reference">
          <div className={FIELD}>
            <label className={LABEL} htmlFor="promptInput">
              Prompt (used for every step)
            </label>
            <textarea
              id="promptInput"
              value={prompt}
              className={`${CONTROL} resize-y min-h-28 leading-[1.6] text-[14.5px]`}
              onChange={(e) => {
                promptTouchedRef.current = true;
                setPrompt(e.target.value);
              }}
              placeholder="e.g. zoom out one step and add more of the city around it"
            />
            <div className={FIELD_HELP}>
              Edit it between runs — a continued chain uses whatever is here for its new steps.
            </div>
          </div>

          <div className={FIELD}>
            <label className={LABEL}>Reference image (starts the chain) - optional</label>
            <ImageDrop
              image={firstReference}
              onChange={setFirstReference}
              setLabel="Reference image set"
              hint="Optional · without it the first step is generated from the prompt alone"
            />
            <div className={FIELD_HELP}>
              Every following step automatically uses the image the step before it produced.
            </div>
          </div>
        </Panel>

        <Panel title="Run">
          <div className={FIELD}>
            <label className={LABEL} htmlFor="stepsInput">
              Number of steps {source ? '(added on each run)' : ''}
            </label>
            <Input
              id="stepsInput"
              type="number"
              min="1"
              max={String(MAX_STEPS)}
              value={stepsText}
              onChange={(e) => setStepsText(e.target.value)}
            />
          </div>

          <div className="flex gap-2.5 items-center mt-4.5">
            <Button onClick={source ? continueChain : startChain} disabled={busy}>
              {busy ? (
                <>
                  <Spinner variant="dark" /> Generating…
                </>
              ) : source ? (
                `Continue the chain · ${stepsLabel} more`
              ) : (
                `Start the chain · ${stepsLabel}`
              )}
            </Button>
            {isRunning && (
              <Button variant="secondary" onClick={cancel}>
                Cancel
              </Button>
            )}
            {!busy && source && (
              <Button variant="secondary" onClick={startChain}>
                New chain
              </Button>
            )}
          </div>

          <div className={`${FIELD_HELP} text-center mt-2.5`}>
            {source
              ? `Running again adds ${stepsLabel} on the end of this chain, continuing from the image ${(source.label || stepLabel(source.index ?? 0)).toLowerCase()} produced. Start a new chain to begin again from the reference image above.`
              : 'A step still generating when the tab closes is picked back up on reload, and the chain can be continued from wherever it got to. Finished chains stay in History.'}
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
          title={gen.viewingHistory ? 'Steps · from history' : 'Steps'}
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
          {steps.length === 0 ? (
            <div className="text-center px-5 py-10 text-text-dim text-[13.5px] font-mono">
              No steps yet — set up the chain above and start it.
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3.5 mt-1">
              {steps.map((s) => (
                <StepCard key={s.id} step={s} busy={busy} onRetry={retryStep} />
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
