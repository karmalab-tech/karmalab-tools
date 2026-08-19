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

  const [effectId, setEffectId] = useState(null);
  // Tweaked values are kept per effect, so switching back keeps your settings.
  const [valuesByEffect, setValuesByEffect] = useState({});

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const replaceRef = useRef(null);
  const recordingRef = useRef(false);
  const [recPct, setRecPct] = useState(null); // null = not recording

  const effect = effectId ? EFFECTS_BY_ID[effectId] : null;
  const values = effect ? valuesByEffect[effectId] : null;

  function loadFile(file) {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
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
    if (effectId) {
      engine.setEffect(EFFECTS_BY_ID[effectId], valuesByEffect[effectId]);
    }
    return () => {
      engine.dispose();
      if (engineRef.current === engine) engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoUrl]);

  useEffect(() => () => videoUrl && URL.revokeObjectURL(videoUrl), [videoUrl]);

  function selectEffect(id) {
    setEffectId(id);
    setValuesByEffect((prev) => {
      const next = prev[id] ? prev : { ...prev, [id]: defaultValues(EFFECTS_BY_ID[id]) };
      engineRef.current?.setEffect(EFFECTS_BY_ID[id], next[id]);
      return next;
    });
  }

  function updateValue(key, val) {
    setValuesByEffect((prev) => {
      const next = { ...prev, [effectId]: { ...prev[effectId], [key]: val } };
      engineRef.current?.setParams(next[effectId]);
      return next;
    });
  }

  function resetValues() {
    const next = defaultValues(effect);
    setValuesByEffect((prev) => ({ ...prev, [effectId]: next }));
    engineRef.current?.setParams(next);
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

  // Record one full loop of the effect canvas into a WebM and download it.
  function downloadEffectVideo() {
    const v = videoRef.current;
    const canvas = canvasRef.current;
    if (!v || !canvas || recordingRef.current || !duration) return;
    recordingRef.current = true;
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
      const blob = new Blob(chunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const base = (videoName || 'video').replace(/\.[^.]+$/, '');
      a.href = url;
      a.download = `${base}-${effectId || 'original'}.webm`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
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
                  {recPct !== null ? `Recording… ${recPct}%` : 'Download the processed video'}
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
              {EFFECTS.map((e, i) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => selectEffect(e.id)}
                  className={`relative w-full h-22 rounded-lg border overflow-hidden cursor-pointer text-left transition-colors duration-150 ${
                    effectId === e.id
                      ? 'border-accent ring-1 ring-accent'
                      : 'border-panel-border hover:border-accent'
                  }`}
                  style={cardBackground(e.id, i)}
                  title={e.blurb}
                >
                  <span className="absolute inset-x-0 bottom-0 px-2 pt-6 pb-1.5 font-mono text-[11.5px] text-text bg-gradient-to-t from-black/85 to-transparent">
                    {e.name}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <aside className="border-t xl:border-t-0 xl:border-l border-panel-border">
          {effect && values ? (
            <div className="px-4 py-3">
              <div className="flex items-center justify-between mb-1.5">
                <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-dim">
                  {effect.name}
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
            <div className="px-4 py-6 font-mono text-[12px] text-text-dim text-center">
              Select an effect to tweak its parameters.
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
