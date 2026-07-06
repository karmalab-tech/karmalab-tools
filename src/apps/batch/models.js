// Per-model configuration for the Batch Image Studio.
//
// Each entry is the single source of truth for how a model differs:
//   label         — shown in the model <select>
//   aspectField   — the Replicate input key for size/ratio ('aspect_ratio' or 'size')
//   aspectOptions — {value, label} pairs for the aspect <select>
//   aspectNote    — optional note shown under the dropdown for real limitations
//   imageField    — Replicate input key for a reference image, or null if unsupported
//   imageIsArray  — whether that field expects [dataUri] vs a bare dataUri string
//   extraInput    — static extra fields always sent (e.g. { quality: 'high' })
//   extraFields   — user-fillable extra inputs rendered dynamically
//
// To add a model, add one entry here — the UI rebuilds itself from it.

export const RATIOS = [
  { value: '1:1', label: 'Square · 1:1' },
  { value: '16:9', label: 'Widescreen · 16:9' },
  { value: '9:16', label: 'Vertical · 9:16' },
  { value: '4:3', label: 'Landscape · 4:3' },
  { value: '3:4', label: 'Portrait · 3:4' },
  { value: '3:2', label: 'Landscape · 3:2' },
  { value: '2:3', label: 'Portrait · 2:3' },
  { value: '21:9', label: 'Cinematic · 21:9' },
];

export const MODEL_CONFIGS = {
  'openai/gpt-image-2': {
    label: 'OpenAI · GPT Image 2',
    aspectField: 'aspect_ratio',
    aspectOptions: [
      { value: 'auto', label: 'Auto' },
      { value: '1:1', label: 'Square · 1:1' },
      { value: '3:2', label: 'Landscape · 3:2' },
      { value: '2:3', label: 'Portrait · 2:3' },
      { value: '16:9', label: 'Widescreen · 16:9' },
      { value: '9:16', label: 'Vertical · 9:16' },
    ],
    imageField: 'input_images',
    imageIsArray: true,
    extraInput: { quality: 'high' },
    extraFields: [
      {
        key: 'openai_api_key',
        label: 'OpenAI API key',
        type: 'password',
        placeholder: 'sk-••••••••••••••••',
        help: 'GPT Image models on Replicate are billed through your own OpenAI account.',
      },
    ],
  },
  'openai/gpt-image-1': {
    label: 'OpenAI · GPT Image 1',
    aspectField: 'aspect_ratio',
    aspectOptions: [
      { value: '1:1', label: 'Square · 1:1' },
      { value: '3:2', label: 'Landscape · 3:2' },
      { value: '2:3', label: 'Portrait · 2:3' },
    ],
    imageField: 'input_images',
    imageIsArray: true,
    extraInput: { quality: 'high' },
    extraFields: [
      {
        key: 'openai_api_key',
        label: 'OpenAI API key',
        type: 'password',
        placeholder: 'sk-••••••••••••••••',
        help: 'GPT Image models on Replicate are billed through your own OpenAI account.',
      },
    ],
    aspectNote:
      'OpenAIs API only offers these 3 fixed ratios — no true 16:9 or 9:16 for this model.',
  },
  'black-forest-labs/flux-1.1-pro': {
    label: 'Black Forest Labs · Flux 1.1 Pro',
    aspectField: 'aspect_ratio',
    aspectOptions: RATIOS,
    imageField: 'image_prompt',
    imageIsArray: false,
  },
  'black-forest-labs/flux-kontext-pro': {
    label: 'Black Forest Labs · Flux Kontext Pro',
    aspectField: 'aspect_ratio',
    aspectOptions: RATIOS.concat([
      { value: 'match_input_image', label: 'Match reference image' },
    ]),
    imageField: 'input_image',
    imageIsArray: false,
  },
  'ideogram-ai/ideogram-v3-turbo': {
    label: 'Ideogram · V3 Turbo',
    aspectField: 'aspect_ratio',
    aspectOptions: RATIOS,
    imageField: 'style_reference_images',
    imageIsArray: true,
  },
  'recraft-ai/recraft-v3': {
    label: 'Recraft · V3',
    aspectField: 'size',
    aspectOptions: [
      { value: '1024x1024', label: 'Square · 1:1' },
      { value: '1820x1024', label: 'Widescreen · 16:9' },
      { value: '1024x1820', label: 'Vertical · 9:16' },
      { value: '1536x1024', label: 'Landscape · 3:2' },
      { value: '1024x1536', label: 'Portrait · 2:3' },
      { value: '1365x1024', label: 'Landscape · 4:3' },
      { value: '1024x1365', label: 'Portrait · 3:4' },
    ],
    imageField: null,
  },
  'stability-ai/stable-diffusion-3.5-large': {
    label: 'Stability AI · SD 3.5 Large',
    aspectField: 'aspect_ratio',
    aspectOptions: RATIOS,
    imageField: 'image',
    imageIsArray: false,
  },
};

export const MODEL_KEYS = Object.keys(MODEL_CONFIGS);

// Every distinct extra-field key across all models (used to preload saved keys).
export const EXTRA_FIELD_KEYS = [
  ...new Set(
    MODEL_KEYS.flatMap((k) => (MODEL_CONFIGS[k].extraFields || []).map((f) => f.key))
  ),
];
