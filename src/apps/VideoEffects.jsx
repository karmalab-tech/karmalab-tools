import { useEffect, useRef, useState } from 'react';
import { ApiKeyModal, TopBar } from '../shared/components';
import { FIELD_HELP, SELECT, SELECT_CHEVRON } from '../shared/fields.js';
import { loadApiKey } from '../shared/apiKey.js';
import { EFFECTS, EFFECTS_BY_ID, defaultValues } from './effects/effects.js';
import { EffectEngine } from './effects/engine.js';

// Video Effects — everything runs in the browser via WebGL2. The uploaded
// video plays in a single <video> element (shown on the left); the engine
// reads frames from that same element into the effect <canvas> on the right,
// so the two sides are always frame-synced. Unlike the other tools this page
// uses the full window width: the side-by-side comparison needs the room.

const formatTime = (s) => {
  if (!Number.isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
};

// Preview thumbnails: drop images at public/effect-previews/<effect-id>.jpg —
// until then the layered gradient below acts as the placeholder background.
const cardBackground = (id, index) => {
  const h1 = (index * 47 + 280) % 360;
  const h2 = (h1 + 60) % 360;
  return {
    backgroundImage: `url(/effect-previews/${id}.jpg), linear-gradient(135deg, hsl(${h1} 55% 28%), hsl(${h2} 70% 12%))`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
  };
};

const NUM_INPUT =
  'w-20 bg-panel-alt border border-panel-border rounded-lg px-2 py-1 text-[12px] font-mono text-text outline-none focus:border-accent';

function RangeRow({ value, min, max, step, onChange }) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        className="flex-1 accent-accent cursor-pointer"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      <input
        type="number"
        className={NUM_INPUT}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          const n = parseFloat(e.target.value);
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
        }}
      />
    </div>
  );
}

function ParamControl({ param, value, onChange }) {
  return (
    <div>
      <div className="font-mono text-[12px] text-text mb-1.5">{param.label}</div>
      {param.kind === 'range' && (
        <RangeRow
          value={value}
          min={param.min}
          max={param.max}
          step={param.step}
          onChange={onChange}
        />
      )}
      {param.kind === 'select' && (
        <select
          className={SELECT}
          style={SELECT_CHEVRON}
          value={String(value)}
          onChange={(e) => onChange(Number(e.target.value))}
        >
          {param.options.map((o) => (
            <option key={o.value} value={String(o.value)}>
              {o.label}
            </option>
          ))}
        </select>
      )}
      {param.kind === 'color' && (
        <div className="flex items-center gap-3">
          <input
            type="color"
            className="w-10 h-8 bg-transparent border border-panel-border rounded-lg cursor-pointer p-0.5"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
          <span className="font-mono text-[12px] text-text-dim uppercase">{value}</span>
        </div>
      )}
      {param.kind === 'xy' && (
        <div className="flex flex-col gap-1.5">
          {['x', 'y'].map((axis) => (
            <div key={axis} className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-text-dim w-3 uppercase">{axis}</span>
              <RangeRow
                value={value[axis]}
                min={param.min}
                max={param.max}
                step={param.step}
                onChange={(n) => onChange({ ...value, [axis]: n })}
              />
            </div>
          ))}
        </div>
      )}
      <div className={FIELD_HELP}>{param.help}</div>
    </div>
  );
}

function VideoDrop({ onFile }) {
  const inputRef = useRef(null);
  const [over, setOver] = useState(false);

  const pick = (file) => {
    if (file && file.type.startsWith('video/')) onFile(file);
  };

  return (
    <div
      className={`w-full aspect-video flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors duration-150 ${
        over ? 'bg-accent-dim' : 'bg-panel-alt hover:bg-accent-dim'
      }`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        pick(e.dataTransfer.files?.[0]);
      }}
    >
      <div className="font-mono text-[13px] text-text">Drop a video file here</div>
      <div className="font-mono text-[11.5px] text-text-dim">or click to browse — it never leaves your browser</div>
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => {
          pick(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
}

// Small corner tag on each video pane.
function PaneLabel({ children }) {
  return (
    <span className="absolute top-2 left-2 font-mono text-[10px] tracking-[0.08em] uppercase text-text-dim bg-black/60 px-2 py-0.5 rounded pointer-events-none">
      {children}
    </span>
  );
}

export default function VideoEffects() {
  const [apiKey, setApiKey] = useState(() => loadApiKey());
  const [keyModalOpen, setKeyModalOpen] = useState(false);

  const [videoUrl, setVideoUrl] = useState(null);
  const [videoName, setVideoName] = useState('');
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [glError, setGlError] = useState('');

  // Effects combine: `enabledIds` is the active chain in activation order
  // (each effect's output feeds the next). `selectedId` is the effect whose
  // settings are shown — always one of the enabled effects.
  const [enabledIds, setEnabledIds] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  // Tweaked values are kept per effect, so toggling keeps your settings.
  const [valuesByEffect, setValuesByEffect] = useState({});

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const replaceRef = useRef(null);
  const recordingRef = useRef(false);
  const fileRef = useRef(null); // the uploaded File, needed by the export pipeline
  const abortRef = useRef(null);
  const [recPct, setRecPct] = useState(null); // null = not exporting/recording
  const [recSpeed, setRecSpeed] = useState(null); // × realtime, offline export only
  const [recMode, setRecMode] = useState('export'); // 'export' | 'record'

  const effect = selectedId ? EFFECTS_BY_ID[selectedId] : null;
  const values = effect ? valuesByEffect[selectedId] : null;

  const buildChain = (ids, vals) => ids.map((id) => ({ def: EFFECTS_BY_ID[id], values: vals[id] }));

  function loadFile(file) {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    fileRef.current = file;
    setVideoUrl(URL.createObjectURL(file));
    setVideoName(file.name);
    setPlaying(false);
    setDuration(0);
    setCurrentTime(0);
  }

  // The engine lives as long as the current video: it reads frames from the
  // <video> element and draws into the canvas.
  useEffect(() => {
    if (!videoUrl || !canvasRef.current || !videoRef.current) return undefined;
    let engine;
    try {
      engine = new EffectEngine(canvasRef.current, videoRef.current);
    } catch (err) {
      setGlError(err.message);
      return undefined;
    }
    engineRef.current = engine;
    if (enabledIds.length) {
      engine.setEffects(buildChain(enabledIds, valuesByEffect));
    }
    return () => {
      engine.dispose();
      if (engineRef.current === engine) engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoUrl]);

  useEffect(() => () => videoUrl && URL.revokeObjectURL(videoUrl), [videoUrl]);

  // Clicking a card selects it, and turns it on if it was off. Only the
  // toggle turns an effect off.
  function cardClick(id) {
    if (enabledIds.includes(id)) {
      setSelectedId(id);
      return;
    }
    enableEffect(id);
  }

  function enableEffect(id) {
    const vals = valuesByEffect[id]
      ? valuesByEffect
      : { ...valuesByEffect, [id]: defaultValues(EFFECTS_BY_ID[id]) };
    const ids = enabledIds.includes(id) ? enabledIds : [...enabledIds, id];
    setValuesByEffect(vals);
    setEnabledIds(ids);
    setSelectedId(id);
    engineRef.current?.setEffects(buildChain(ids, vals));
  }

  function disableEffect(id) {
    const ids = enabledIds.filter((x) => x !== id);
    setEnabledIds(ids);
    if (selectedId === id) setSelectedId(ids[ids.length - 1] ?? null);
    engineRef.current?.setEffects(buildChain(ids, valuesByEffect));
  }

  function updateValue(key, val) {
    setValuesByEffect((prev) => {
      const next = { ...prev, [selectedId]: { ...prev[selectedId], [key]: val } };
      engineRef.current?.setValues(selectedId, next[selectedId]);
      return next;
    });
  }

  function resetValues() {
    const next = defaultValues(effect);
    setValuesByEffect((prev) => ({ ...prev, [selectedId]: next }));
    engineRef.current?.setValues(selectedId, next);
  }

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }

  function seek(t) {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = t;
    setCurrentTime(t);
  }

  function triggerBlobDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const downloadBase = () => (videoName || 'video').replace(/\.[^.]+$/, '');
  const effectSuffix = () =>
    enabledIds.length === 0
      ? 'original'
      : enabledIds.length <= 2
        ? enabledIds.join('+')
        : `${enabledIds.length}-effects`;

  // Offline export: decode the source with WebCodecs, run every frame through
  // a second engine at FULL resolution, encode to MP4 — faster than realtime.
  // Clicking again while it runs cancels. Falls back to realtime canvas
  // recording where WebCodecs isn't available.
  async function downloadEffectVideo() {
    if (recordingRef.current) {
      abortRef.current?.abort(); // second click = cancel the export
      return;
    }
    const file = fileRef.current;
    if (!file || !duration) return;
    if (typeof VideoEncoder === 'undefined') {
      recordRealtime();
      return;
    }
    recordingRef.current = true;
    const abort = new AbortController();
    abortRef.current = abort;
    setRecMode('export');
    setRecPct(0);
    setRecSpeed(null);
    // The chain at click time drives the whole export; live tweaks only
    // affect the preview.
    const exportChain = buildChain(enabledIds, valuesByEffect);
    const suffix = effectSuffix();
    let exportEngine = null;
    try {
      // The export pipeline (and its MP4 demuxer) loads on demand.
      const { exportVideo } = await import('../shared/videoExport');
      const { blob } = await exportVideo({
        file,
        signal: abort.signal,
        onProgress: ({ percent, speed }) => {
          setRecPct(percent);
          if (speed) setRecSpeed(speed);
        },
        render: (frame, timeSec, w, h) => {
          if (!exportEngine) {
            const off =
              typeof OffscreenCanvas !== 'undefined'
                ? new OffscreenCanvas(w, h)
                : document.createElement('canvas');
            exportEngine = new EffectEngine(off, null);
            exportEngine.setExportSize(w, h);
            exportEngine.setEffects(exportChain);
          }
          exportEngine.pushFrame(frame, timeSec);
          return exportEngine.canvas;
        },
      });
      triggerBlobDownload(blob, `${downloadBase()}-${suffix}.mp4`);
    } catch (err) {
      if (err?.name !== 'AbortError') {
        console.warn('Offline export failed — recording in realtime instead:', err);
        exportEngine?.dispose();
        exportEngine = null;
        setRecPct(null);
        recordingRef.current = false;
        recordRealtime();
        return;
      }
    } finally {
      exportEngine?.dispose();
      abortRef.current = null;
      setRecPct(null);
      setRecSpeed(null);
      recordingRef.current = false;
    }
  }

  // Fallback: capture the preview canvas in realtime with MediaRecorder.
  function recordRealtime() {
    const v = videoRef.current;
    const canvas = canvasRef.current;
    if (!v || !canvas || recordingRef.current || !duration) return;
    recordingRef.current = true;
    setRecMode('record');
    const wasPaused = v.paused;
    const stream = canvas.captureStream(30);
    let mime = 'video/webm;codecs=vp9';
    if (!window.MediaRecorder?.isTypeSupported(mime)) mime = 'video/webm';
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 });
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    let last = 0;
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      v.removeEventListener('timeupdate', onTime);
      clearTimeout(hardStop);
      rec.stop();
    };
    const onTime = () => {
      const t = v.currentTime;
      if (t < last - 0.2) stop(); // looped back to the start — one pass done
      else {
        last = t;
        setRecPct(Math.min(99, Math.round((t / duration) * 100)));
      }
    };
    const hardStop = setTimeout(stop, (duration + 2) * 1000);
    rec.onstop = () => {
      triggerBlobDownload(
        new Blob(chunks, { type: 'video/webm' }),
        `${downloadBase()}-${effectSuffix()}.webm`
      );
      if (wasPaused) v.pause();
      setRecPct(null);
      recordingRef.current = false;
    };
    setRecPct(0);
    v.currentTime = 0;
    v.addEventListener('timeupdate', onTime);
    v.play().catch(() => {});
    rec.start(250);
  }

  return (
    <div className="min-h-screen flex flex-col">
      <div className="px-3 py-2.5 border-b border-panel-border">
        <TopBar
          active="/video-effects"
          apiKeySet={!!apiKey.trim()}
          onApiKeyClick={() => setKeyModalOpen(true)}
        />
      </div>

      {/* Videos: original left, effect right, flush side by side. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 border-b border-panel-border">
        <div className="relative border-b lg:border-b-0 lg:border-r border-panel-border">
          {videoUrl ? (
            <div
              className="relative group cursor-pointer"
              onClick={() => replaceRef.current?.click()}
              title={`Click to replace ${videoName}`}
            >
              <video
                ref={videoRef}
                src={videoUrl}
                loop
                muted
                playsInline
                autoPlay
                className="w-full aspect-video object-contain bg-black block"
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onLoadedMetadata={(e) => setDuration(e.target.duration || 0)}
                onTimeUpdate={(e) => setCurrentTime(e.target.currentTime)}
              />
              <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none">
                <span className="font-mono text-[12px] text-text border border-panel-border rounded-full px-4 py-2 bg-black/70">
                  Click to replace the video
                </span>
              </div>
            </div>
          ) : (
            <VideoDrop onFile={loadFile} />
          )}
          <PaneLabel>Original</PaneLabel>
          <input
            ref={replaceRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f && f.type.startsWith('video/')) loadFile(f);
              e.target.value = '';
            }}
          />
        </div>

        <div className="relative">
          {videoUrl && !glError ? (
            <div
              className="relative group cursor-pointer"
              onClick={downloadEffectVideo}
              title="Click to download the processed video"
            >
              <canvas
                ref={canvasRef}
                className="w-full aspect-video object-contain bg-black block"
              />
              <div
                className={`absolute inset-0 flex items-center justify-center bg-black/50 transition-opacity duration-150 pointer-events-none ${
                  recPct !== null ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                }`}
              >
                <span className="font-mono text-[12px] text-black bg-accent border border-accent rounded-full px-4 py-2">
                  {recPct === null
                    ? 'Download the processed video'
                    : recMode === 'export'
                      ? `Exporting… ${recPct}%${recSpeed ? ` · ${recSpeed.toFixed(1)}×` : ''} — click to cancel`
                      : `Recording… ${recPct}%`}
                </span>
              </div>
            </div>
          ) : (
            <div className="w-full aspect-video bg-panel-alt flex items-center justify-center px-6">
              <span className="font-mono text-[12.5px] text-text-dim text-center leading-[1.6]">
                {glError
                  ? `Could not start the WebGL renderer: ${glError}`
                  : 'The processed video appears here, playing in sync with the original.'}
              </span>
            </div>
          )}
          <PaneLabel>Effect</PaneLabel>
        </div>
      </div>

      {/* Bottom: playback + effects on the left, parameters on the right. */}
      <div className="flex-1 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0">
          {videoUrl && (
            <div className="flex items-center gap-3 px-3 py-2 border-b border-panel-border">
              <button
                type="button"
                onClick={togglePlay}
                className="w-9 h-9 shrink-0 rounded-full border border-accent text-accent bg-accent-dim cursor-pointer flex items-center justify-center text-[12px] transition-colors duration-150 hover:bg-accent hover:text-black"
                title={playing ? 'Pause both videos' : 'Play both videos'}
              >
                {playing ? '❚❚' : '▶'}
              </button>
              <span className="font-mono text-[12px] text-text-dim w-12 text-right shrink-0">
                {formatTime(currentTime)}
              </span>
              <input
                type="range"
                className="flex-1 accent-accent cursor-pointer"
                min={0}
                max={duration || 0}
                step={0.01}
                value={Math.min(currentTime, duration || 0)}
                onChange={(e) => seek(parseFloat(e.target.value))}
              />
              <span className="font-mono text-[12px] text-text-dim w-12 shrink-0">
                {formatTime(duration)}
              </span>
            </div>
          )}

          <div className="px-3 py-3">
            <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-dim mb-2">
              Effects
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2 max-h-76 overflow-y-auto pr-1">
              {EFFECTS.map((e, i) => {
                const order = enabledIds.indexOf(e.id);
                const on = order !== -1;
                return (
                  <div
                    key={e.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => cardClick(e.id)}
                    onKeyDown={(ev) => ev.key === 'Enter' && cardClick(e.id)}
                    className={`relative w-full h-22 rounded-lg border overflow-hidden cursor-pointer transition-colors duration-150 ${
                      selectedId === e.id
                        ? 'border-accent ring-1 ring-accent'
                        : on
                          ? 'border-accent'
                          : 'border-panel-border hover:border-accent'
                    }`}
                    style={cardBackground(e.id, i)}
                    title={e.blurb}
                  >
                    <span className="absolute inset-x-0 bottom-0 px-2 pt-6 pb-1.5 font-mono text-[11.5px] text-text bg-gradient-to-t from-black/85 to-transparent">
                      {e.name}
                    </span>
                    {/* Chain position, when several effects are combined. */}
                    {on && enabledIds.length > 1 && (
                      <span className="absolute top-1.5 left-1.5 w-4.5 h-4.5 rounded-full bg-accent text-black font-mono text-[10px] flex items-center justify-center">
                        {order + 1}
                      </span>
                    )}
                    {/* The only control that turns an effect OFF. */}
                    <button
                      type="button"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        if (on) disableEffect(e.id);
                        else enableEffect(e.id);
                      }}
                      title={on ? `Turn ${e.name} off` : `Turn ${e.name} on`}
                      className={`absolute top-1.5 right-1.5 w-8 h-4.5 rounded-full border cursor-pointer transition-colors duration-150 ${
                        on ? 'bg-accent border-accent' : 'bg-black/70 border-panel-border hover:border-accent'
                      }`}
                    >
                      <span
                        className={`block w-3 h-3 rounded-full transition-transform duration-150 ${
                          on ? 'bg-black translate-x-[16px]' : 'bg-text-dim translate-x-[2px]'
                        }`}
                      />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <aside className="border-t xl:border-t-0 xl:border-l border-panel-border">
          {effect && values ? (
            <div className="px-4 py-3">
              <div className="flex items-center justify-between mb-1.5">
                <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-dim">
                  {effect.name}
                  {enabledIds.length > 1 && (
                    <span className="text-accent ml-2">
                      {enabledIds.indexOf(selectedId) + 1}/{enabledIds.length} in chain
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={resetValues}
                  className="font-mono text-[11px] rounded-full px-3 py-1 border border-panel-border text-text-dim bg-transparent cursor-pointer transition-colors duration-150 hover:border-accent hover:text-accent"
                >
                  Reset
                </button>
              </div>
              <p className="text-[12.5px] text-text-dim leading-[1.5] mt-0 mb-4">{effect.blurb}</p>
              <div className="flex flex-col gap-4">
                {effect.params.map((p) => (
                  <ParamControl
                    key={p.key}
                    param={p}
                    value={values[p.key]}
                    onChange={(v) => updateValue(p.key, v)}
                  />
                ))}
              </div>
              {!videoUrl && (
                <div className={`${FIELD_HELP} mt-4`}>
                  Upload a video above to see this effect running.
                </div>
              )}
            </div>
          ) : (
            <div className="px-4 py-6 font-mono text-[12px] text-text-dim text-center leading-[1.7]">
              Click an effect to turn it on and tweak its parameters.
              <br />
              Enable several to combine them — each feeds into the next.
            </div>
          )}
        </aside>
      </div>

      <ApiKeyModal
        open={keyModalOpen}
        onSaved={() => setApiKey(loadApiKey())}
        onClose={() => setKeyModalOpen(false)}
      />
    </div>
  );
}
