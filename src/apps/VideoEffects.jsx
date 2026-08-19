import { useEffect, useRef, useState } from 'react';
import { ApiKeyModal, Brand, Panel, TopBar } from '../shared/components';
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
      className={`w-full aspect-video rounded-xl border border-dashed flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors duration-150 ${
        over ? 'border-accent bg-accent-dim' : 'border-panel-border bg-panel-alt hover:border-accent'
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

  return (
    <div className="px-5 pt-10 pb-20 w-full">
      <div className="w-full flex flex-col gap-5">
        <TopBar
          active="/video-effects"
          apiKeySet={!!apiKey.trim()}
          onApiKeyClick={() => setKeyModalOpen(true)}
        />
        <Brand
          title="Video Effects"
          subtitle="Apply real-time WebGL effects to a video — everything runs locally in your browser."
        />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <Panel title="Original">
            {videoUrl ? (
              <video
                ref={videoRef}
                src={videoUrl}
                loop
                muted
                playsInline
                autoPlay
                className="w-full aspect-video object-contain bg-black rounded-xl border border-panel-border"
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onLoadedMetadata={(e) => setDuration(e.target.duration || 0)}
                onTimeUpdate={(e) => setCurrentTime(e.target.currentTime)}
              />
            ) : (
              <VideoDrop onFile={loadFile} />
            )}
          </Panel>

          <Panel title="Effect">
            {videoUrl && !glError ? (
              <canvas
                ref={canvasRef}
                className="w-full aspect-video object-contain bg-black rounded-xl border border-panel-border"
              />
            ) : (
              <div className="w-full aspect-video rounded-xl border border-dashed border-panel-border flex items-center justify-center px-6">
                <span className="font-mono text-[12.5px] text-text-dim text-center leading-[1.6]">
                  {glError
                    ? `Could not start the WebGL renderer: ${glError}`
                    : 'The processed video appears here, playing in sync with the original.'}
                </span>
              </div>
            )}
          </Panel>
        </div>

        {videoUrl && (
          <Panel title="Playback">
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={togglePlay}
                className="w-10 h-10 shrink-0 rounded-full border border-accent text-accent bg-accent-dim cursor-pointer flex items-center justify-center text-[13px] transition-colors duration-150 hover:bg-accent hover:text-black"
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
              <button
                type="button"
                className="font-mono text-[11.5px] rounded-full px-3.5 py-1.5 border border-panel-border text-text-dim bg-transparent cursor-pointer transition-colors duration-150 hover:border-accent hover:text-accent shrink-0"
                onClick={() => replaceRef.current?.click()}
                title={videoName}
              >
                Replace video
              </button>
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
            <div className={`${FIELD_HELP} mt-2`}>
              One set of controls drives both sides — the videos loop and always stay in sync.
            </div>
          </Panel>
        )}

        <Panel title="Effects">
          <div className="flex gap-3 overflow-x-auto pb-2 -mb-2">
            {EFFECTS.map((e, i) => (
              <button
                key={e.id}
                type="button"
                onClick={() => selectEffect(e.id)}
                className={`relative shrink-0 w-40 h-24 rounded-xl border overflow-hidden cursor-pointer text-left transition-colors duration-150 ${
                  effectId === e.id
                    ? 'border-accent ring-1 ring-accent'
                    : 'border-panel-border hover:border-accent'
                }`}
                style={cardBackground(e.id, i)}
                title={e.blurb}
              >
                <span className="absolute inset-x-0 bottom-0 px-2.5 pt-6 pb-2 font-mono text-[12px] text-text bg-gradient-to-t from-black/85 to-transparent">
                  {e.name}
                </span>
              </button>
            ))}
          </div>
        </Panel>

        {effect && values && (
          <Panel
            title={`Settings · ${effect.name}`}
            action={
              <button
                type="button"
                onClick={resetValues}
                className="font-mono text-[11.5px] rounded-full px-3.5 py-1.5 border border-panel-border text-text-dim bg-transparent cursor-pointer transition-colors duration-150 hover:border-accent hover:text-accent"
              >
                Reset
              </button>
            }
          >
            <p className="text-[13px] text-text-dim leading-[1.5] mt-0 mb-5">{effect.blurb}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-5">
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
          </Panel>
        )}
      </div>

      <ApiKeyModal
        open={keyModalOpen}
        onSaved={() => setApiKey(loadApiKey())}
        onClose={() => setKeyModalOpen(false)}
      />
    </div>
  );
}
