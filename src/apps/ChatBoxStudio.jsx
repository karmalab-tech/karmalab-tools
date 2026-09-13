import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ApiKeyModal,
  Button,
  ImagesDrop,
  Panel,
  RunHistoryModal,
  Spinner,
  StatusPill,
  TopBar,
} from '../shared/components';
import {
  FIELD,
  FIELD_HELP,
  LABEL,
  MINI_BTN,
  SELECT,
  SELECT_CHEVRON,
  CONTROL,
} from '../shared/fields.js';
import { loadApiKey } from '../shared/apiKey.js';
import { downloadUrl } from '../shared/download.js';
import { cachedBlob } from '../shared/outputCache.js';
import { useCachedOutput } from '../shared/useCachedOutput.js';
import { useGenerationRun } from '../shared/useGenerationRun.js';
import { ChatBox } from './chatBox/ChatBox.jsx';
import {
  DEFAULT_HEADLINE,
  DEFAULT_MODEL_CHIP,
  DEFAULT_PLACEHOLDER,
  METRICS,
} from './chatBox/design.js';
import {
  BOX_WIDTH_LIMITS,
  DEFAULT_BOX_WIDTH_PCT,
  RESOLUTION_PRESETS,
  extensionForType,
  parseSize,
  recordingBasename,
  resolutionLabel,
} from './chatBox/scene.js';
import { AUDIO_SAMPLE_RATE, recordChatBox, videoSupport } from './chatBox/record.js';
import { decodeMono, neededMs, typingRuns, typingTrack } from './chatBox/audio.js';
import { clearSound, loadSound, saveSound } from './chatBox/sound.js';
import {
  DEFAULTS,
  LIMITS,
  MAX_DURATION_MS,
  clampSetting,
  planRecording,
  stateAt,
} from './chatBox/timeline.js';
import { loadKey, saveKey, storage } from './chatBox/storage.js';

// The Chat Box Studio: the chat box on the left, what to record it doing on the
// right, and the video it produced underneath that.
//
// The box on the left is the real component (src/apps/chatBox/ChatBox.jsx) —
// type in it, drop images on it — sitting in a frame the exact shape of the
// video, scaled the way the recording scales it. So the stage is not an
// illustration of the output: it is the same layout, from the same numbers,
// which is what makes "what you see" mean anything here.
//
// The recording itself never touches the DOM. It paints every frame on a canvas
// at the target resolution (src/apps/chatBox/scene.js) and encodes it with
// WebCodecs (src/apps/chatBox/record.js), so a 1080×1920 reel is laid out at
// 1080 wide rather than scaled up from the screen, and it renders as fast as
// the encoder goes instead of in real time.

// Remembered between visits, so a reel that took some fiddling to frame comes
// back framed. Attachments are not: image data URIs have no business in
// localStorage (see src/shared/runs.js).
const SETTING_KEYS = [
  'text',
  'width',
  'height',
  'boxWidthPct',
  'background',
  'headline',
  'placeholder',
  'modelChip',
  'cps',
  'startDelayMs',
  'attachIntervalMs',
  'pauseBeforeSendMs',
  'waitAfterSendMs',
  'fps',
  // Only the clip's name: the audio itself is in IndexedDB (chatBox/sound.js).
  'soundName',
];

const INITIAL = {
  text: 'Make me a video of a golden retriever surfing at sunset',
  width: '1080',
  height: '1920',
  boxWidthPct: String(DEFAULT_BOX_WIDTH_PCT),
  background: '#000000',
  headline: DEFAULT_HEADLINE,
  placeholder: DEFAULT_PLACEHOLDER,
  modelChip: DEFAULT_MODEL_CHIP,
  cps: String(DEFAULTS.cps),
  startDelayMs: String(DEFAULTS.startDelayMs),
  attachIntervalMs: String(DEFAULTS.attachIntervalMs),
  pauseBeforeSendMs: String(DEFAULTS.pauseBeforeSendMs),
  waitAfterSendMs: String(DEFAULTS.waitAfterSendMs),
  fps: String(DEFAULTS.fps),
  soundName: '',
};

const loadSettings = () =>
  Object.fromEntries(SETTING_KEYS.map((k) => [k, loadKey(k) || INITIAL[k]]));

const recordingName = (item, extension) =>
  `${item.basename || 'karmalab-chat-box'}.${extension || 'mp4'}`;

function NumberField({ id, label, value, onChange, help, min, max, step = 1, suffix }) {
  return (
    <div className={FIELD}>
      <label className={LABEL} htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={CONTROL}
        />
        {suffix && (
          <span className="absolute right-3.5 top-1/2 -translate-y-1/2 font-mono text-[12px] text-text-dim pointer-events-none">
            {suffix}
          </span>
        )}
      </div>
      {help && <div className={FIELD_HELP}>{help}</div>}
    </div>
  );
}

// Click-or-drop for the typing clip. The sibling of ImagesDrop, which does not
// take audio — this is the same shape in the same clothes.
function SoundDrop({ name, sound, disabled, onChoose, onRemove }) {
  const [dragover, setDragover] = useState(false);
  const inputRef = useRef(null);

  const take = (fileList) => {
    const file = Array.from(fileList || []).find((f) => f.type.startsWith('audio/'));
    if (file) onChoose(file);
  };

  return (
    <>
      <div
        className={[
          'border-[1.5px] border-dashed border-panel-border rounded-[14px] p-4.5 flex items-center gap-3.5 cursor-pointer transition-[border-color,background] duration-150 bg-panel-alt hover:border-accent',
          disabled && 'opacity-40 cursor-not-allowed pointer-events-none',
          dragover && 'border-accent',
          sound && 'border-solid',
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragover(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragover(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragover(false);
          take(e.dataTransfer.files);
        }}
      >
        <div className="w-13 h-13 rounded-[10px] shrink-0 flex items-center justify-center text-text-dim border border-panel-border">
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
          >
            <path d="M3 12v2M7 8v10M11 5v14M15 9v7M19 11v3" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[14px] mb-0.5 truncate">
            {sound ? name || 'Typing sound' : 'Click or drop a typing sound'}
          </div>
          <div className="text-[12px] text-text-dim font-mono truncate">
            {sound ? `${(sound.durationMs / 1000).toFixed(1)}s of audio` : 'Any audio file'}
          </div>
        </div>
      </div>

      {sound && (
        <div className="flex gap-1.5 mt-2">
          <button
            type="button"
            className={`${MINI_BTN} hover:border-error hover:text-error`}
            onClick={onRemove}
            disabled={disabled}
          >
            Remove the sound
          </button>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => {
          take(e.target.files);
          e.target.value = '';
        }}
      />
    </>
  );
}

// The finished video, or why there isn't one. One recording is one run, so this
// is the run — including a run opened from History, whose blob URL died with
// the tab that made it and which plays from the output cache instead.
function ResultPanel({ item, cacheKey, progress, recording, hasSound }) {
  const [extension, setExtension] = useState('');
  const src = useCachedOutput(cacheKey, item?.outputUrl);

  // The container is whatever the browser could encode, so the download is
  // named after the file that actually came out — read back from the cached
  // blob for a recording made before this page load.
  useEffect(() => {
    if (!cacheKey || item?.status !== 'succeeded') return;
    let live = true;
    cachedBlob(cacheKey).then((blob) => {
      if (live && blob) setExtension(extensionForType(blob.type));
    });
    return () => {
      live = false;
    };
  }, [cacheKey, item?.status]);

  async function download() {
    await downloadUrl(item.outputUrl, recordingName(item, extension), cacheKey);
  }

  if (!item) {
    return (
      <div className="text-center px-5 py-8 text-text-dim text-[13.5px] font-mono">
        Nothing recorded yet — set the shot up and hit record.
      </div>
    );
  }

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[12px] text-text-dim truncate">
          {item.label || 'Recording'}
        </span>
        <StatusPill status={item.status} />
      </div>

      {item.status === 'succeeded' && src && (
        <>
          <video
            src={src}
            controls
            loop
            autoPlay
            muted
            playsInline
            className="w-full max-h-[46vh] object-contain bg-black rounded-[14px] border border-panel-border block"
          />
          <div className="flex gap-1.5">
            <button type="button" className={MINI_BTN} onClick={download}>
              Download
            </button>
          </div>
          {/* Autoplay is only allowed muted, so a recording with a typing
              sound in it is silent until someone asks for it. */}
          {hasSound && (
            <div className="font-mono text-[11px] text-text-dim text-center">
              Unmute the player to hear the typing.
            </div>
          )}
        </>
      )}

      {recording && (
        <div className="flex flex-col gap-2">
          <div className="h-1.5 rounded-full bg-panel-border overflow-hidden">
            <div
              className="h-full bg-accent transition-[width] duration-150"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="font-mono text-[11.5px] text-text-dim text-center">
            {progress.stage === 'preparing'
              ? 'Preparing the canvas…'
              : progress.stage === 'sound'
                ? 'Laying the typing sound under it…'
                : `Recording frame ${progress.done} of ${progress.total} · ${pct}%`}
          </div>
        </div>
      )}

      {item.error && (
        <div className="text-[12px] text-error font-mono leading-[1.4]">{item.error}</div>
      )}
    </div>
  );
}

export default function ChatBoxStudio() {
  const [settings, setSettings] = useState(loadSettings);
  const [attachments, setAttachments] = useState([]);
  const [apiKey, setApiKey] = useState(() => loadApiKey());
  const [keyModalOpen, setKeyModalOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [progress, setProgress] = useState({ stage: '', done: 0, total: 0 });
  const [hint, setHint] = useState({ text: '', isError: false });
  const [preview, setPreview] = useState(null); // the frame's state while playing
  const [sound, setSound] = useState(null); // { samples, sampleRate, durationMs }
  const [stage, setStage] = useState({ width: 0, height: 0 });
  const [boxHeight, setBoxHeight] = useState(0);
  const [boxEl, setBoxEl] = useState(null);

  const stageRef = useRef(null);
  const cancelRef = useRef(false);
  const previewRef = useRef(0);
  const objectUrlsRef = useRef([]);
  // The preview's audio, so stopping it can stop the sound with it.
  const previewAudioRef = useRef(null);
  // The box's height with the whole message in it, which is where the recording
  // anchors the composition.
  const fullBoxHeight = useRef(0);

  const gen = useGenerationRun({
    storage,
    // Nothing here is made on Replicate: a recording is encoded in this tab, so
    // there is no prediction to pick back up if the tab closes mid-render.
    remote: false,
    onNotice: (text, isError) => setHint({ text, isError }),
  });

  const item = gen.items[0] || null;

  function set(key, value) {
    setSettings((prev) => ({ ...prev, [key]: value }));
    saveKey(key, value);
  }

  const width = parseSize(settings.width, 1080);
  const height = parseSize(settings.height, 1920);
  const boxWidthPct = clampSetting(settings.boxWidthPct, BOX_WIDTH_LIMITS, DEFAULT_BOX_WIDTH_PCT);
  const fps = Math.round(clampSetting(settings.fps, LIMITS.fps, DEFAULTS.fps));

  const plan = useMemo(
    () =>
      planRecording({
        text: settings.text,
        cps: clampSetting(settings.cps, LIMITS.cps, DEFAULTS.cps),
        startDelayMs: clampSetting(
          settings.startDelayMs,
          LIMITS.startDelayMs,
          DEFAULTS.startDelayMs
        ),
        attachCount: attachments.length,
        attachIntervalMs: clampSetting(
          settings.attachIntervalMs,
          LIMITS.attachIntervalMs,
          DEFAULTS.attachIntervalMs
        ),
        pauseBeforeSendMs: clampSetting(
          settings.pauseBeforeSendMs,
          LIMITS.pauseBeforeSendMs,
          DEFAULTS.pauseBeforeSendMs
        ),
        waitAfterSendMs: clampSetting(
          settings.waitAfterSendMs,
          LIMITS.waitAfterSendMs,
          DEFAULTS.waitAfterSendMs
        ),
        fps,
      }),
    [
      attachments.length,
      fps,
      settings.attachIntervalMs,
      settings.cps,
      settings.pauseBeforeSendMs,
      settings.startDelayMs,
      settings.text,
      settings.waitAfterSendMs,
    ]
  );

  // The stage is measured rather than laid out in CSS: the same measurement
  // gives the frame its pixel size *and* the scale the box is drawn at, which
  // is how the preview stays the recording's own geometry.
  useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const { width: w, height: h } = entry.contentRect;
      setStage({ width: w, height: h });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The box's own height, as it grows with the message. scene.js settles the
  // composition against the finished message and then draws the box upwards
  // from a fixed bottom edge; measuring the box here lets the preview do the
  // same, so a message growing to a second line moves the same things on screen
  // as it will in the file.
  //
  // A callback ref rather than a plain one: the box only exists once the stage
  // has been measured, so an effect on mount would find nothing to observe.
  useEffect(() => {
    if (!boxEl || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setBoxHeight(entry.contentRect.height));
    observer.observe(boxEl);
    return () => observer.disconnect();
  }, [boxEl]);

  if (!preview) fullBoxHeight.current = boxHeight;

  // The typing sound the last visit left behind, decoded once to the rate the
  // encoder wants. A clip that will no longer decode is dropped quietly — it is
  // the one thing here that is a file rather than a setting.
  useEffect(() => {
    let live = true;
    loadSound().then(async (blob) => {
      if (!live || !blob) return;
      const decoded = await decodeMono(await blob.arrayBuffer(), AUDIO_SAMPLE_RATE);
      if (live && decoded) setSound(decoded);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(
    () => () => {
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      cancelAnimationFrame(previewRef.current);
      previewAudioRef.current?.close();
    },
    []
  );

  const frame = useMemo(() => {
    if (!stage.width || !stage.height) return { width: 0, height: 0 };
    const scale = Math.min(stage.width / width, stage.height / height);
    return { width: Math.round(width * scale), height: Math.round(height * scale) };
  }, [height, stage.height, stage.width, width]);

  // 720 CSS pixels of chat box, shown at whatever fraction of the frame the box
  // width setting asks for — the same sum scene.js does at full resolution.
  const boxScale = frame.width ? (frame.width * boxWidthPct) / 100 / METRICS.boxWidth : 1;

  // Half the height the box has yet to grow into, in frame pixels: the shift
  // that keeps its bottom edge — the controls row and the send button — where
  // it will be when the message is finished.
  const boxLift = (Math.max(0, fullBoxHeight.current - boxHeight) / 2) * boxScale;

  // Play the plan through the real DOM box — and, if there is one, through the
  // typing sound, built by the same function the recorder uses. So the preview
  // is what the file will be, ears included.
  const playPreview = useCallback(() => {
    cancelAnimationFrame(previewRef.current);
    previewAudioRef.current?.close();
    previewAudioRef.current = null;

    const track = sound ? typingTrack(sound, plan, plan.totalMs) : null;
    if (track) {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        const audioCtx = new Ctx({ sampleRate: track.sampleRate });
        const buffer = audioCtx.createBuffer(1, track.samples.length, track.sampleRate);
        buffer.copyToChannel(track.samples, 0);
        const source = audioCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(audioCtx.destination);
        source.start();
        previewAudioRef.current = audioCtx;
      } catch {
        /* no Web Audio, or a blocked context — the picture still plays */
      }
    }

    const startedAt = performance.now();
    const step = () => {
      const ms = performance.now() - startedAt;
      if (ms >= plan.totalMs) {
        previewAudioRef.current?.close();
        previewAudioRef.current = null;
        setPreview(null);
        return;
      }
      setPreview(stateAt(ms, plan));
      previewRef.current = requestAnimationFrame(step);
    };
    previewRef.current = requestAnimationFrame(step);
  }, [plan, sound]);

  function stopPreview() {
    cancelAnimationFrame(previewRef.current);
    previewAudioRef.current?.close();
    previewAudioRef.current = null;
    setPreview(null);
  }

  // Take a typing clip: decode it for the recorder and the preview, and keep
  // the file itself so it is still here next time.
  async function chooseSound(file) {
    if (!file) return;
    const decoded = await decodeMono(await file.arrayBuffer(), AUDIO_SAMPLE_RATE);
    if (!decoded) {
      setHint({ text: `${file.name} could not be decoded as audio.`, isError: true });
      return;
    }
    setSound(decoded);
    set('soundName', file.name);
    setHint({ text: '', isError: false });
    saveSound(file);
  }

  function removeSound() {
    setSound(null);
    set('soundName', '');
    clearSound();
  }

  function applyPreset(value) {
    const preset = RESOLUTION_PRESETS.find((p) => `${p.width}x${p.height}` === value);
    if (!preset) return;
    set('width', String(preset.width));
    set('height', String(preset.height));
  }

  async function record() {
    if (recording) return;
    if (!settings.text.trim()) {
      setHint({ text: 'Write the message the box should type first.', isError: true });
      return;
    }
    if (!videoSupport()) {
      setHint({
        text: 'This browser has no WebCodecs video encoder — try it in Chrome or Edge.',
        isError: true,
      });
      return;
    }
    if (plan.totalMs > MAX_DURATION_MS) {
      setHint({
        text: `That comes to ${(plan.totalMs / 1000).toFixed(0)}s — keep a recording under ${MAX_DURATION_MS / 1000}s (shorter message, or type it faster).`,
        isError: true,
      });
      return;
    }

    stopPreview();
    const id = `rec-${Date.now().toString(36)}`;
    const size = resolutionLabel(width, height);
    gen.startRun({
      title: `Chat box · ${size}`,
      items: [
        {
          id,
          predictionId: null,
          status: 'running',
          prompt: settings.text,
          label: `${size} · ${(plan.totalMs / 1000).toFixed(1)}s`,
          basename: recordingBasename(width, height),
          index: 0,
          outputUrl: null,
          error: null,
        },
      ],
    });

    cancelRef.current = false;
    setRecording(true);
    setHint({ text: '', isError: false });
    setProgress({ stage: 'preparing', done: 0, total: plan.frameCount });

    try {
      const result = await recordChatBox({
        width,
        height,
        boxWidthPct,
        background: settings.background,
        headline: settings.headline,
        placeholder: settings.placeholder,
        modelChip: settings.modelChip,
        attachments,
        sound,
        plan,
        onProgress: setProgress,
        shouldStop: () => cancelRef.current,
      });

      if (result.cancelled) {
        gen.updateItem(id, { status: 'failed', error: 'Cancelled before it finished.' });
        setHint({ text: 'Recording cancelled.', isError: false });
      } else {
        // The blob URL is what plays right now; the copy the output cache takes
        // from it (useGenerationRun does that on any outputUrl) is what
        // survives the page and what History plays later.
        const url = URL.createObjectURL(result.blob);
        objectUrlsRef.current.push(url);
        gen.updateItem(id, {
          status: 'succeeded',
          outputUrl: url,
          label: `${size} · ${(result.durationMs / 1000).toFixed(1)}s · ${result.label}`,
          error: null,
        });
        setHint({
          text: [
            `Recorded ${plan.frameCount} frames — play it below, then download.`,
            result.audio?.dropped && 'This browser could not encode the sound, so it is silent.',
            result.audio?.wrapped &&
              'The typing outlasts your clip, so the sound starts over once in it.',
          ]
            .filter(Boolean)
            .join(' '),
          isError: false,
        });
      }
    } catch (err) {
      gen.updateItem(id, { status: 'failed', error: err.message || String(err) });
      setHint({ text: 'The recording failed — the card says why.', isError: true });
    }

    setRecording(false);
    gen.finishRun();
  }

  const boxText = preview ? preview.text : settings.text;
  const durationText = `${(plan.totalMs / 1000).toFixed(1)}s · ${plan.frameCount} frames`;
  const presetValue = `${width}x${height}`;
  // While the preview plays, the box holds what has landed so far.
  const shownAttachments = preview ? attachments.slice(0, preview.attachCount) : attachments;
  // How much of the clip the typing will actually use, against how much there
  // is — a two-second clip under a ten-second message has to start over.
  const soundNeededMs = sound ? neededMs(typingRuns(plan)) : 0;
  const soundShort = sound ? soundNeededMs > sound.durationMs : false;

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* The stage: the video's frame, at the video's shape, with the real box
          in it at the scale the recording uses. */}
      <section className="flex-1 min-w-0 flex flex-col p-5 lg:p-8 gap-3 lg:h-screen">
        <div ref={stageRef} className="flex-1 min-h-[320px] flex items-center justify-center">
          {frame.width > 0 && (
            <div
              className="relative overflow-hidden rounded-[18px] border border-panel-border"
              style={{
                width: frame.width,
                height: frame.height,
                background: settings.background,
              }}
            >
              <div
                className="absolute left-1/2 top-1/2"
                style={{
                  width: METRICS.boxWidth,
                  transform: `translate(-50%, calc(-50% + ${boxLift}px)) scale(${boxScale})`,
                }}
              >
                <ChatBox
                  boxRef={setBoxEl}
                  text={boxText}
                  onTextChange={(value) => set('text', value)}
                  attachments={shownAttachments}
                  onAttachmentsChange={setAttachments}
                  placeholder={settings.placeholder}
                  modelChip={settings.modelChip}
                  headline={settings.headline}
                  sending={!!preview?.sending}
                  readOnly={!!preview || recording}
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-center gap-2 font-mono text-[11.5px] text-text-dim">
          <span>
            {resolutionLabel(width, height)} · box {Math.round(boxWidthPct)}% · {durationText}
          </span>
          <button
            type="button"
            className={`${MINI_BTN} flex-none px-3`}
            onClick={preview ? stopPreview : playPreview}
            disabled={recording}
          >
            {preview ? 'Stop preview' : 'Play preview'}
          </button>
        </div>
      </section>

      {/* The controls: what to record, how fast, and what came out. */}
      <aside className="w-full lg:w-[430px] shrink-0 border-t lg:border-t-0 lg:border-l border-panel-border bg-panel-alt/40 lg:h-screen overflow-y-auto p-5 flex flex-col gap-4">
        <TopBar
          active="/prompt"
          apiKeySet={!!apiKey.trim()}
          onApiKeyClick={() => setKeyModalOpen(true)}
          historyCount={gen.history.length}
          onHistoryClick={gen.openHistory}
        />

        <div>
          <h1 className="text-[22px] font-medium m-0 tracking-[-0.01em]">Chat Box Studio</h1>
          <p className="text-text-dim mt-1 mb-0 text-[13.5px] leading-[1.5]">
            Record the chat box typing a message and sending it — at the resolution you need, as a
            video file. Everything is rendered in this browser.
          </p>
        </div>

        <Panel title="Frame">
          <div className={FIELD}>
            <label className={LABEL} htmlFor="presetSelect">
              Resolution
            </label>
            <select
              id="presetSelect"
              className={SELECT}
              style={SELECT_CHEVRON}
              value={
                RESOLUTION_PRESETS.some((p) => `${p.width}x${p.height}` === presetValue)
                  ? presetValue
                  : 'custom'
              }
              onChange={(e) => applyPreset(e.target.value)}
            >
              {RESOLUTION_PRESETS.map((p) => (
                <option key={p.label} value={`${p.width}x${p.height}`}>
                  {p.label}
                </option>
              ))}
              <option value="custom">Custom…</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <NumberField
              id="widthInput"
              label="Width"
              value={settings.width}
              onChange={(v) => set('width', v)}
              suffix="px"
              min={240}
              max={2560}
              step={2}
            />
            <NumberField
              id="heightInput"
              label="Height"
              value={settings.height}
              onChange={(v) => set('height', v)}
              suffix="px"
              min={240}
              max={2560}
              step={2}
            />
          </div>

          <div className={FIELD}>
            <label className={LABEL} htmlFor="boxWidthInput">
              Box width — {Math.round(boxWidthPct)}% of the frame
            </label>
            <input
              id="boxWidthInput"
              type="range"
              min={BOX_WIDTH_LIMITS[0]}
              max={BOX_WIDTH_LIMITS[1]}
              value={boxWidthPct}
              onChange={(e) => set('boxWidthPct', e.target.value)}
              className="w-full accent-accent cursor-pointer"
            />
            <div className={FIELD_HELP}>
              Everything in the box scales with it — the text is laid out at the target resolution,
              not scaled up from the screen.
            </div>
          </div>

          <div className={FIELD}>
            <label className={LABEL} htmlFor="backgroundInput">
              Background
            </label>
            <div className="flex gap-2">
              <input
                id="backgroundInput"
                type="color"
                value={settings.background}
                onChange={(e) => set('background', e.target.value)}
                className="w-12 h-11 rounded-xl bg-panel-alt border border-panel-border cursor-pointer p-1"
              />
              <input
                type="text"
                value={settings.background}
                onChange={(e) => set('background', e.target.value)}
                className={CONTROL}
              />
            </div>
          </div>
        </Panel>

        <Panel title="The box">
          <div className={FIELD}>
            <label className={LABEL} htmlFor="headlineInput">
              Title above the box
            </label>
            <input
              id="headlineInput"
              type="text"
              value={settings.headline}
              onChange={(e) => set('headline', e.target.value)}
              className={CONTROL}
              placeholder="Leave empty for no title"
            />
            <div className={FIELD_HELP}>
              What the frame opens on, above the box. Empty for none.
            </div>
          </div>
          <div className={FIELD}>
            <label className={LABEL} htmlFor="placeholderInput">
              Placeholder in the empty box
            </label>
            <input
              id="placeholderInput"
              type="text"
              value={settings.placeholder}
              onChange={(e) => set('placeholder', e.target.value)}
              className={CONTROL}
              placeholder="Leave empty for none"
            />
            <div className={FIELD_HELP}>On screen until the first character is typed over it.</div>
          </div>
          <div className={FIELD}>
            <label className={LABEL} htmlFor="chipInput">
              Model chip
            </label>
            <input
              id="chipInput"
              type="text"
              value={settings.modelChip}
              onChange={(e) => set('modelChip', e.target.value)}
              className={CONTROL}
              placeholder="Leave empty for none"
            />
          </div>
        </Panel>

        <Panel title="Images it drops in">
          <ImagesDrop
            images={attachments}
            onChange={setAttachments}
            disabled={recording || !!preview}
            emptyLabel="Click or drop images"
            hint="They land in the box one by one, before any typing"
          />
          {attachments.length > 0 && (
            <div className="mt-4">
              <NumberField
                id="attachIntervalInput"
                label="One lands every"
                value={settings.attachIntervalMs}
                onChange={(v) => set('attachIntervalMs', v)}
                suffix="ms"
                min={LIMITS.attachIntervalMs[0]}
                max={LIMITS.attachIntervalMs[1]}
                step={50}
                help={`${attachments.length} ${attachments.length === 1 ? 'image' : 'images'}, then one more beat before the typing starts — ${((plan.typingStartMs - clampSetting(settings.startDelayMs, LIMITS.startDelayMs, DEFAULTS.startDelayMs)) / 1000).toFixed(1)}s of the video.`}
              />
            </div>
          )}
          <div className={FIELD_HELP}>
            The same list as the box on the left — drop them here or on it, either way they are
            dropped into it during the recording, not already sitting there.
          </div>
        </Panel>

        <Panel title="What it types">
          <div className={FIELD}>
            <label className={LABEL} htmlFor="messageInput">
              Message
            </label>
            <textarea
              id="messageInput"
              value={settings.text}
              onChange={(e) => set('text', e.target.value)}
              className={`${CONTROL} resize-y min-h-24 leading-[1.6] text-[14.5px]`}
              placeholder="What gets typed into the box"
            />
            <div className={FIELD_HELP}>
              Or type straight into the box on the left — it is the same text.
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <NumberField
              id="cpsInput"
              label="Typing speed"
              value={settings.cps}
              onChange={(v) => set('cps', v)}
              suffix="chars/s"
              min={LIMITS.cps[0]}
              max={LIMITS.cps[1]}
              help={`≈ ${Math.round((clampSetting(settings.cps, LIMITS.cps, DEFAULTS.cps) * 60) / 5)} words a minute`}
            />
            <NumberField
              id="fpsInput"
              label="Frame rate"
              value={settings.fps}
              onChange={(v) => set('fps', v)}
              suffix="fps"
              min={LIMITS.fps[0]}
              max={LIMITS.fps[1]}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <NumberField
              id="startDelayInput"
              label="Before"
              value={settings.startDelayMs}
              onChange={(v) => set('startDelayMs', v)}
              suffix="ms"
              min={LIMITS.startDelayMs[0]}
              max={LIMITS.startDelayMs[1]}
              step={100}
            />
            <NumberField
              id="pauseInput"
              label="Then pause"
              value={settings.pauseBeforeSendMs}
              onChange={(v) => set('pauseBeforeSendMs', v)}
              suffix="ms"
              min={LIMITS.pauseBeforeSendMs[0]}
              max={LIMITS.pauseBeforeSendMs[1]}
              step={100}
            />
            <NumberField
              id="waitInput"
              label="After send"
              value={settings.waitAfterSendMs}
              onChange={(v) => set('waitAfterSendMs', v)}
              suffix="ms"
              min={LIMITS.waitAfterSendMs[0]}
              max={LIMITS.waitAfterSendMs[1]}
              step={100}
            />
          </div>
          <div className={FIELD_HELP}>
            An empty box, the images landing in it, the message typed at that speed, a pause, then
            the send — the button spins for the wait and that is the end of the video.{' '}
            {durationText} in all.
          </div>
        </Panel>

        <Panel title="Typing sound">
          <SoundDrop
            name={settings.soundName}
            sound={sound}
            disabled={recording}
            onChoose={chooseSound}
            onRemove={removeSound}
          />
          {sound && (
            <div className={`${FIELD_HELP} mt-2`}>
              Heard only while characters are landing — silent before the typing, while the images
              drop in, at a full stop, and from the send onwards. It plays through your clip rather
              than repeating the same moment: this message uses {(soundNeededMs / 1000).toFixed(1)}s
              of the {(sound.durationMs / 1000).toFixed(1)}s you gave it.
            </div>
          )}
          {soundShort && (
            <div className="font-mono text-[11.5px] text-warning mt-2 leading-[1.4]">
              The typing needs more than the clip has, so it starts over once. A longer clip fixes
              it.
            </div>
          )}
        </Panel>

        <Panel title="Recording">
          <div className="flex gap-2.5 items-center mb-4">
            <Button onClick={record} disabled={recording}>
              {recording ? (
                <>
                  <Spinner variant="dark" /> Recording…
                </>
              ) : (
                `Record · ${durationText}`
              )}
            </Button>
            {recording && (
              <Button variant="secondary" onClick={() => (cancelRef.current = true)}>
                Cancel
              </Button>
            )}
          </div>

          <ResultPanel
            item={item}
            cacheKey={item ? gen.outputKey(item) : ''}
            progress={progress}
            recording={recording}
            hasSound={!!sound}
          />

          {hint.text && (
            <div
              className={`font-mono text-[11.5px] text-center mt-3 ${
                hint.isError ? 'text-error' : 'text-text-dim'
              }`}
            >
              {hint.text}
            </div>
          )}
          <div className={`${FIELD_HELP} mt-3`}>
            Finished recordings are kept in History, video included — in this browser only.
          </div>
        </Panel>
      </aside>

      <ApiKeyModal
        open={keyModalOpen}
        onSaved={() => setApiKey(loadApiKey())}
        onClose={() => setKeyModalOpen(false)}
      />
      <RunHistoryModal {...gen.historyModal} />
    </div>
  );
}
