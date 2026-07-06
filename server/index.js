// KarmaLab Tools — production server
//
// Serves the built app (`dist/`, produced by `yarn build`) and proxies
// `/v1/...` requests through to the Replicate API. Because the pages and the
// proxy share one origin, the browser's calls to `/v1/...` are same-origin —
// Replicate sends no CORS headers, so this proxy is what makes them work.
//
// In development you don't need this file — `yarn dev` runs Vite (HMR + its own
// `/v1` proxy). This server is for `yarn build` + `yarn start` (and fly.io).

import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { routes } from './routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8787;
const DIST_DIR = path.join(__dirname, '..', 'dist');
const REPLICATE_HOST = 'api.replicate.com';

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

function proxyToReplicate(req, res) {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);

    const forwardHeaders = { ...req.headers };
    forwardHeaders.host = REPLICATE_HOST;
    delete forwardHeaders.origin;
    delete forwardHeaders.referer;
    delete forwardHeaders['content-length'];
    if (body.length) forwardHeaders['content-length'] = body.length;

    const proxyReq = https.request(
      { hostname: REPLICATE_HOST, path: req.url, method: req.method, headers: forwardHeaders },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
      }
    );

    proxyReq.on('error', (err) => {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Proxy could not reach Replicate: ' + err.message }));
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
  if (!filePath.startsWith(DIST_DIR)) {
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
