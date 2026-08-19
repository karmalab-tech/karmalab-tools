// Per-model configuration for the video tools (Continuous Video Studio and
// Batch Video Studio) — one shared catalogue of Replicate video models.
//
// Each entry is the single source of truth for how a model differs:
//   label         — shown in the model <select>
//   imageField    — the Replicate input key for the start frame
//   requiresImage — true if the model cannot start from text alone, so a start
//                   frame must be supplied (in the Continuous Video Studio only
//                   the first clip needs one — the rest chain from the previous
//                   end frame)
//   note          — optional line shown under the model <select>
//   extraInput    — static extra inputs always sent
//   fields        — option <select>s rendered dynamically. Option values keep
//                   their real JSON type (number/boolean/string) and are sent
//                   to Replicate as-is. `default` picks the initial value;
//                   `help` renders a note under the control.
//
// Configs mirror each model's current Replicate input schema. To add a model,
// add one entry here — the UI rebuilds itself from it.

const ON_OFF = (def) => ({
  options: [
    { value: true, label: 'On' },
    { value: false, label: 'Off' },
  ],
  default: def,
});

export const MODEL_CONFIGS = {
  'google/veo-3.1': {
    label: 'Google · Veo 3.1',
    imageField: 'image',
    fields: [
      {
        key: 'duration',
        label: 'Clip length',
        options: [
          { value: 8, label: '8 seconds' },
          { value: 6, label: '6 seconds' },
          { value: 4, label: '4 seconds' },
        ],
        default: 8,
      },
      {
        key: 'resolution',
        label: 'Resolution',
        options: [
          { value: '1080p', label: '1080p' },
          { value: '720p', label: '720p' },
        ],
        default: '1080p',
      },
      {
        key: 'aspect_ratio',
        label: 'Aspect ratio',
        options: [
          { value: '16:9', label: 'Widescreen · 16:9' },
          { value: '9:16', label: 'Vertical · 9:16' },
        ],
        default: '16:9',
        help: 'With a start frame, match its orientation.',
      },
      {
        key: 'generate_audio',
        label: 'Sound',
        ...ON_OFF(true),
      },
    ],
  },
  'google/veo-3.1-fast': {
    label: 'Google · Veo 3.1 Fast',
    imageField: 'image',
    fields: [
      {
        key: 'duration',
        label: 'Clip length',
        options: [
          { value: 8, label: '8 seconds' },
          { value: 6, label: '6 seconds' },
          { value: 4, label: '4 seconds' },
        ],
        default: 8,
      },
      {
        key: 'resolution',
        label: 'Resolution',
        options: [
          { value: '1080p', label: '1080p' },
          { value: '720p', label: '720p' },
        ],
        default: '1080p',
      },
      {
        key: 'aspect_ratio',
        label: 'Aspect ratio',
        options: [
          { value: '16:9', label: 'Widescreen · 16:9' },
          { value: '9:16', label: 'Vertical · 9:16' },
        ],
        default: '16:9',
        help: 'With a start frame, match its orientation.',
      },
      {
        key: 'generate_audio',
        label: 'Sound',
        ...ON_OFF(true),
      },
    ],
  },
  'kwaivgi/kling-v3-video': {
    label: 'Kling · v3',
    imageField: 'start_image',
    fields: [
      {
        key: 'duration',
        label: 'Clip length',
        options: [
          { value: 5, label: '5 seconds' },
          { value: 3, label: '3 seconds' },
          { value: 8, label: '8 seconds' },
          { value: 10, label: '10 seconds' },
          { value: 15, label: '15 seconds' },
        ],
        default: 5,
      },
      {
        key: 'mode',
        label: 'Quality',
        options: [
          { value: 'pro', label: 'Pro · 1080p' },
          { value: 'standard', label: 'Standard · 720p' },
          { value: '4k', label: '4K' },
        ],
        default: 'pro',
      },
      {
        key: 'aspect_ratio',
        label: 'Aspect ratio',
        options: [
          { value: '16:9', label: 'Widescreen · 16:9' },
          { value: '9:16', label: 'Vertical · 9:16' },
          { value: '1:1', label: 'Square · 1:1' },
        ],
        default: '16:9',
        help: 'Ignored when a start frame is used — the frame sets the ratio.',
      },
      {
        key: 'generate_audio',
        label: 'Sound',
        ...ON_OFF(false),
      },
    ],
  },
  'bytedance/seedance-2.0': {
    label: 'ByteDance · Seedance 2.0',
    imageField: 'image',
    fields: [
      {
        key: 'duration',
        label: 'Clip length',
        options: [
          { value: 5, label: '5 seconds' },
          { value: 3, label: '3 seconds' },
          { value: 8, label: '8 seconds' },
          { value: 10, label: '10 seconds' },
          { value: 15, label: '15 seconds' },
          { value: -1, label: 'Auto (model picks)' },
        ],
        default: 5,
      },
      {
        key: 'resolution',
        label: 'Resolution',
        options: [
          { value: '720p', label: '720p' },
          { value: '480p', label: '480p' },
          { value: '1080p', label: '1080p' },
          { value: '4k', label: '4K' },
        ],
        default: '720p',
      },
      {
        key: 'aspect_ratio',
        label: 'Aspect ratio',
        options: [
          { value: '16:9', label: 'Widescreen · 16:9' },
          { value: '9:16', label: 'Vertical · 9:16' },
          { value: '1:1', label: 'Square · 1:1' },
          { value: '4:3', label: 'Landscape · 4:3' },
          { value: '3:4', label: 'Portrait · 3:4' },
          { value: '21:9', label: 'Cinematic · 21:9' },
          { value: 'adaptive', label: 'Adaptive (follow inputs)' },
        ],
        default: '16:9',
      },
      {
        key: 'generate_audio',
        label: 'Sound',
        ...ON_OFF(true),
      },
    ],
  },
  'minimax/hailuo-2.3-fast': {
    label: 'MiniMax · Hailuo 2.3 Fast',
    imageField: 'first_frame_image',
    requiresImage: true,
    note: 'Image-to-video only — it cannot start from text, so a start frame is required.',
    fields: [
      {
        key: 'duration',
        label: 'Clip length',
        options: [
          { value: 6, label: '6 seconds' },
          { value: 10, label: '10 seconds' },
        ],
        default: 6,
        help: '10 seconds is only available at 768p.',
      },
      {
        key: 'resolution',
        label: 'Resolution',
        options: [
          { value: '768p', label: '768p' },
          { value: '1080p', label: '1080p' },
        ],
        default: '768p',
      },
      {
        key: 'prompt_optimizer',
        label: 'Prompt optimizer',
        ...ON_OFF(true),
      },
    ],
  },
  'wan-video/wan-2.7-i2v': {
    label: 'Wan · 2.7 (image-to-video)',
    imageField: 'first_frame',
    note: 'Audio is always auto-generated to match the video.',
    fields: [
      {
        key: 'duration',
        label: 'Clip length',
        options: [
          { value: 5, label: '5 seconds' },
          { value: 3, label: '3 seconds' },
          { value: 8, label: '8 seconds' },
          { value: 10, label: '10 seconds' },
          { value: 15, label: '15 seconds' },
        ],
        default: 5,
      },
      {
        key: 'resolution',
        label: 'Resolution',
        options: [
          { value: '1080p', label: '1080p' },
          { value: '720p', label: '720p' },
        ],
        default: '1080p',
      },
      {
        key: 'enable_prompt_expansion',
        label: 'Prompt expansion',
        ...ON_OFF(true),
      },
    ],
  },
};

export const MODEL_KEYS = Object.keys(MODEL_CONFIGS);

export function defaultOptionValues(modelKey) {
  return Object.fromEntries(
    MODEL_CONFIGS[modelKey].fields.map((f) => [f.key, f.default ?? f.options[0].value])
  );
}

// Assemble the Replicate `input` for one clip. `startFrameDataUri` is the
// uploaded first frame (clip 1) or the extracted end frame of the previous
// clip; null means pure text-to-video.
export function buildVideoInput(cfg, { prompt, optionValues, startFrameDataUri }) {
  const input = { prompt, ...(cfg.extraInput || {}) };
  for (const f of cfg.fields) {
    const value = optionValues[f.key];
    if (value !== undefined && value !== null && value !== '') input[f.key] = value;
  }
  if (startFrameDataUri) input[cfg.imageField] = startFrameDataUri;
  return input;
}
