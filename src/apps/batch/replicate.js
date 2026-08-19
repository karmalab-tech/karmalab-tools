// Batch-specific Replicate input assembly. The generic API helpers (create /
// poll / fetch predictions) live in src/shared/replicate.js and are shared
// with the Continuous Video Studio — re-exported here so the Batch Studio
// keeps a single import site.

export {
  MAX_CONCURRENT,
  POLL_INTERVAL_MS,
  POLL_TIMEOUT_MS,
  createPrediction,
  getPrediction,
  pollPrediction,
  extractOutputUrl as extractImageUrl,
} from '../../shared/replicate.js';

// Assemble the Replicate `input` object for one prompt from a config snapshot.
export function buildInput(
  cfg,
  { promptText, suffix, aspect, referenceImageDataUri, extraValues }
) {
  const trimmedSuffix = (suffix || '').trim();
  const finalPrompt = trimmedSuffix ? `${promptText} ${trimmedSuffix}`.trim() : promptText;
  const input = { prompt: finalPrompt, ...(cfg.extraInput || {}) };

  if (cfg.aspectField) input[cfg.aspectField] = aspect;

  if (cfg.imageField && referenceImageDataUri) {
    input[cfg.imageField] = cfg.imageIsArray ? [referenceImageDataUri] : referenceImageDataUri;
  }

  (cfg.extraFields || []).forEach((f) => {
    const value = (extraValues[f.key] || '').trim();
    if (value) input[f.key] = value;
  });

  return input;
}
