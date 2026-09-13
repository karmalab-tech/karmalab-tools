// KarmaLab Tools — production server
//
// Serves the built app (`dist/`, produced by `yarn build`) and proxies
// `/v1/...` requests through to the Replicate API. Because the pages and the
// proxy share one origin, the browser's calls to `/v1/...` are same-origin —
// Replicate sends no CORS headers, so this proxy is what makes them work.
//
// The proxy is not a general pass-through: it forwards only the two request
// shapes this app makes, only the headers Replicate needs, and only within a
// per-client rate limit. That policy lives in server/proxy.js.
//
// In development you don't need this file — `yarn dev` runs Vite (HMR + its own
// `/v1` proxy). This server is for `yarn build` + `yarn start` (and fly.io).

import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { routes } from './routes.js';
import {
  MAX_BODY_BYTES,
  MAX_BODY_LABEL,
  REPLICATE_HOST,
  RateLimiter,
  clientKey,
  filterRequestHeaders,
  filterResponseHeaders,
  isAllowedRequest,
} from './proxy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8787;
const DIST_DIR = path.join(__dirname, '..', 'dist');
const UPSTREAM_TIMEOUT_MS = 60_000;

const rateLimiter = new RateLimiter();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

// Clean route -> file lookup, normalised so `/prompt` and `/prompt/` match.
const routeMap = new Map(routes.map((r) => [r.path.replace(/\/+$/, '') || '/', r.file]));

function sendJson(res, status, payload, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(payload));
}

// Read the request body, refusing anything over the cap rather than buffering
// it. Calls back with `null` once the request has been answered and closed.
function readCappedBody(req, res, done) {
  const chunks = [];
  let size = 0;
  let aborted = false;

  req.on('data', (chunk) => {
    if (aborted) return;
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      aborted = true;
      sendJson(res, 413, {
        error: `Request body too large (limit ${MAX_BODY_LABEL}). Try a smaller reference image.`,
      });
      req.destroy();
      done(null);
      return;
    }
    chunks.push(chunk);
  });

  req.on('aborted', () => {
    if (!aborted) {
      aborted = true;
      done(null);
    }
  });

  req.on('end', () => {
    if (!aborted) done(Buffer.concat(chunks));
  });
}

// Forward one allowed request to Replicate. See server/proxy.js for what is
// allowed through and why.
function proxyToReplicate(req, res) {
  const key = clientKey(req);
  if (!rateLimiter.check(key)) {
    sendJson(
      res,
      429,
      { error: 'Too many requests to the Replicate proxy. Slow down and try again shortly.' },
      { 'Retry-After': String(rateLimiter.retryAfter(key)) }
    );
    return;
  }

  if (!isAllowedRequest(req.method, req.url)) {
    sendJson(res, 403, {
      error:
        'This proxy only forwards the Replicate calls this app makes: ' +
        'POST /v1/models/{owner}/{model}/predictions and GET /v1/predictions/{id}.',
    });
    return;
  }

  readCappedBody(req, res, (body) => {
    if (body === null) return;

    const headers = filterRequestHeaders(req.headers);
    if (body.length) headers['content-length'] = body.length;

    const proxyReq = https.request(
      { hostname: REPLICATE_HOST, path: req.url, method: req.method, headers },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode, filterResponseHeaders(proxyRes.headers));
        proxyRes.pipe(res);
      }
    );

    proxyReq.setTimeout(UPSTREAM_TIMEOUT_MS, () => {
      proxyReq.destroy(new Error('upstream timed out'));
    });

    proxyReq.on('error', (err) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      sendJson(res, 502, { error: 'Proxy could not reach Replicate: ' + err.message });
    });

    if (body.length) proxyReq.write(body);
    proxyReq.end();
  });
}

function sendFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function serve(req, res) {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const cleanPath = urlPath.replace(/\/+$/, '') || '/';

  // 1. Named tool routes (e.g. `/`, `/prompt`).
  if (routeMap.has(cleanPath)) {
    sendFile(res, path.join(DIST_DIR, routeMap.get(cleanPath)));
    return;
  }

  // 2. Static assets from dist/, guarded against path traversal.
  const relativePath = urlPath.replace(/^\/+/, '');
  const filePath = path.normalize(path.join(DIST_DIR, relativePath));
  // Must be inside dist/ — compare against `dist/` with the separator, so a
  // sibling directory whose name merely starts with "dist" cannot match.
  if (filePath !== DIST_DIR && !filePath.startsWith(DIST_DIR + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }
  sendFile(res, filePath);
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/v1/')) {
    proxyToReplicate(req, res);
    return;
  }

  if (req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method not allowed');
    return;
  }

  serve(req, res);
});

if (!fs.existsSync(DIST_DIR)) {
  console.warn('⚠  dist/ not found — run `yarn build` first (this server serves the built app).');
}

server.listen(PORT, () => {
  console.log('KarmaLab Tools running at http://localhost:' + PORT);
  for (const r of routes) {
    console.log('  ' + r.path.padEnd(10) + ' → ' + r.title);
  }
  console.log('The app and the Replicate proxy are both served from here. Ctrl+C to stop.');
});
