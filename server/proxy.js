// The Replicate proxy — request filtering, header filtering and rate limiting.
//
// Why a proxy exists at all: `api.replicate.com` sends no CORS headers, so a
// browser `fetch()` straight to it is always blocked. The pages and the proxy
// share one origin, so the browser's calls to `/v1/...` are same-origin.
//
// Why it is filtered: this app is deployed publicly and takes the Replicate
// token from the browser rather than holding one server-side. That means the
// proxy is reachable by anyone who can reach the site. It leaks no credentials
// (every caller supplies their own token, and none is stored here), but an
// unrestricted pass-through would let anyone route arbitrary traffic to
// Replicate through this host, on this host's bandwidth. So:
//
//   1. Only the two request shapes the app actually makes are forwarded.
//   2. Only the headers Replicate needs are forwarded — notably not `cookie`.
//   3. Request bodies are capped, and requests are rate limited per client.
//
// The stronger fix is to stop taking the token from the browser at all: hold it
// server-side and authenticate your own users. See AGENTS.md.
//
// Tunable by environment variable, each documented at its definition below:
//   PROXY_MAX_BODY_BYTES        max proxied request body   (default 24 MB)
//   PROXY_RATE_LIMIT_MAX        requests per window        (default 300)
//   PROXY_RATE_LIMIT_WINDOW_MS  the window                (default 60_000)
//   TRUST_PROXY_HEADER          honour X-Forwarded-For     (default off)

export const REPLICATE_HOST = 'api.replicate.com';

// Reference images are sent as base64 data URIs and are not downscaled in the
// browser, so a single prompt can legitimately carry an untouched phone photo.
// Generous, but bounded.
export const MAX_BODY_BYTES = Number(process.env.PROXY_MAX_BODY_BYTES) || 24 * 1024 * 1024;

// The cap as the 413 response should describe it. Keeps its units honest for a
// small configured limit, where rounding to whole megabytes would read "0 MB".
export const MAX_BODY_LABEL =
  MAX_BODY_BYTES >= 1024 * 1024
    ? `${Math.round(MAX_BODY_BYTES / (1024 * 1024))} MB`
    : `${Math.max(1, Math.round(MAX_BODY_BYTES / 1024))} KB`;

// The Batch Studio polls up to MAX_CONCURRENT (3) predictions every 1.5s, so
// steady-state legitimate use is ~120 requests/minute from one browser. This
// leaves headroom for that while still bounding what one client can push
// through the host.
export const RATE_LIMIT_MAX = Number(process.env.PROXY_RATE_LIMIT_MAX) || 300;
export const RATE_LIMIT_WINDOW_MS = Number(process.env.PROXY_RATE_LIMIT_WINDOW_MS) || 60_000;

// Request shapes the app makes (src/shared/replicate.js). A Replicate model is
// `owner/name`; a prediction id is an opaque alphanumeric string.
const MODEL_SEGMENT = '[A-Za-z0-9][A-Za-z0-9._-]{0,62}';
const ALLOWED_REQUESTS = [
  // createPrediction()
  {
    method: 'POST',
    pattern: new RegExp(`^/v1/models/${MODEL_SEGMENT}/${MODEL_SEGMENT}/predictions$`),
  },
  // getPrediction() and pollPrediction()
  { method: 'GET', pattern: /^\/v1\/predictions\/[A-Za-z0-9]{1,64}$/ },
];

// Forwarded to Replicate. An allowlist rather than a denylist, so headers the
// browser adds by default — `cookie` above all — are dropped by construction.
const FORWARDED_REQUEST_HEADERS = ['authorization', 'content-type', 'accept'];

// Dropped from Replicate's response before it reaches the browser.
const STRIPPED_RESPONSE_HEADERS = ['set-cookie', 'set-cookie2'];

// `true` if this exact method + path is one the app itself issues. Everything
// else — other Replicate endpoints, other methods, path traversal attempts —
// is refused rather than forwarded.
export function isAllowedRequest(method, urlPath) {
  const path = String(urlPath || '').split('?')[0];
  return ALLOWED_REQUESTS.some((r) => r.method === method && r.pattern.test(path));
}

export function filterRequestHeaders(headers = {}) {
  const out = {};
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = headers[name];
    if (value !== undefined) out[name] = value;
  }
  out.host = REPLICATE_HOST;
  out['user-agent'] = 'karmalab-tools-proxy';
  return out;
}

export function filterResponseHeaders(headers = {}) {
  const out = { ...headers };
  for (const name of STRIPPED_RESPONSE_HEADERS) delete out[name];
  return out;
}

// Identify the client for rate limiting.
//
// Only sources the client cannot forge are trusted by default: `fly-client-ip`
// is written by fly.io's proxy, and the socket address is the kernel's. A
// client-supplied `x-forwarded-for` is honoured only when TRUST_PROXY_HEADER is
// set, because otherwise anyone could rotate the header to reset their bucket.
export function clientKey(req) {
  const headers = req.headers || {};
  if (headers['fly-client-ip']) return headers['fly-client-ip'];
  if (process.env.TRUST_PROXY_HEADER && headers['x-forwarded-for']) {
    return String(headers['x-forwarded-for']).split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

// Fixed-window counter per client. In-process and therefore per-machine: it
// bounds what one client can push through one host, which is what it is for. A
// deployment running several machines should rate limit at the edge instead.
export class RateLimiter {
  constructor({ max = RATE_LIMIT_MAX, windowMs = RATE_LIMIT_WINDOW_MS } = {}) {
    this.max = max;
    this.windowMs = windowMs;
    this.buckets = new Map();
  }

  // `true` if this request is within the client's allowance.
  check(key, now = Date.now()) {
    const bucket = this.buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      this.sweep(now);
      return true;
    }
    if (bucket.count >= this.max) return false;
    bucket.count += 1;
    return true;
  }

  // Seconds until the client's window resets, for the `Retry-After` header.
  retryAfter(key, now = Date.now()) {
    const bucket = this.buckets.get(key);
    if (!bucket) return 0;
    return Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  }

  // Drop expired buckets so the map cannot grow without bound. Runs on window
  // rollover, which is rare enough to stay cheap.
  sweep(now = Date.now()) {
    for (const [key, bucket] of this.buckets) {
      if (now >= bucket.resetAt) this.buckets.delete(key);
    }
  }
}
