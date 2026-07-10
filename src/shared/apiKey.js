// Shared API key storage (best-effort localStorage — never throw).
//
// Keys are managed by the ApiKeyModal (opened from the TopBar) and shared by
// every tool: the Replicate token used for all generations, and the OpenAI
// key only needed by OpenAI models (GPT Image on Replicate bills through the
// user's own OpenAI account). Earlier versions stored them under per-tool
// namespaces — those are still read as a fallback so existing users keep
// their keys.

const REPLICATE_KEY = 'karmalab.replicateToken';
const OPENAI_KEY = 'karmalab.openaiApiKey';

const LEGACY_REPLICATE_KEYS = [
  'karmalab.batchImageStudio.replicateToken',
  'karmalab.continuousVideoStudio.replicateToken',
];
const LEGACY_OPENAI_KEYS = ['karmalab.batchImageStudio.extra.openai_api_key'];

function load(key, legacyKeys) {
  try {
    return (
      localStorage.getItem(key) ||
      legacyKeys.map((k) => localStorage.getItem(k)).find(Boolean) ||
      ''
    );
  } catch {
    return '';
  }
}

function save(key, value) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* localStorage unavailable — ignore */
  }
}

export const loadApiKey = () => load(REPLICATE_KEY, LEGACY_REPLICATE_KEYS);
export const saveApiKey = (value) => save(REPLICATE_KEY, value);

export const loadOpenaiKey = () => load(OPENAI_KEY, LEGACY_OPENAI_KEYS);
export const saveOpenaiKey = (value) => save(OPENAI_KEY, value);
