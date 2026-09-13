// The proxy's request policy. This is the security-relevant code in the repo:
// the app is deployed publicly and the proxy is reachable by anyone, so what it
// refuses to forward matters as much as what it forwards.
import { describe, expect, it } from 'vitest';

import {
  RateLimiter,
  clientKey,
  filterRequestHeaders,
  filterResponseHeaders,
  isAllowedRequest,
} from '../server/proxy.js';

describe('isAllowedRequest', () => {
  it('allows the two calls the app makes', () => {
    expect(isAllowedRequest('POST', '/v1/models/openai/gpt-image-2/predictions')).toBe(true);
    expect(isAllowedRequest('GET', '/v1/predictions/abc123XYZ')).toBe(true);
  });

  it('allows every model id the tools ship with', () => {
    const models = [
      'openai/gpt-image-2',
      'black-forest-labs/flux-1.1-pro',
      'stability-ai/stable-diffusion-3.5-large',
      'ideogram-ai/ideogram-v3-turbo',
      'google/veo-3.1-fast',
      'kwaivgi/kling-v3-video',
      'wan-video/wan-2.7-i2v',
      'minimax/hailuo-2.3-fast',
    ];
    for (const model of models) {
      expect(isAllowedRequest('POST', `/v1/models/${model}/predictions`)).toBe(true);
    }
  });

  it('refuses other Replicate endpoints', () => {
    expect(isAllowedRequest('GET', '/v1/account')).toBe(false);
    expect(isAllowedRequest('GET', '/v1/models')).toBe(false);
    expect(isAllowedRequest('GET', '/v1/deployments')).toBe(false);
    expect(isAllowedRequest('POST', '/v1/trainings')).toBe(false);
    expect(isAllowedRequest('GET', '/v1/predictions')).toBe(false);
  });

  it('refuses the wrong method on an allowed path', () => {
    expect(isAllowedRequest('GET', '/v1/models/openai/gpt-image-2/predictions')).toBe(false);
    expect(isAllowedRequest('DELETE', '/v1/predictions/abc123')).toBe(false);
    expect(isAllowedRequest('POST', '/v1/predictions/abc123')).toBe(false);
  });

  it('refuses paths that extend an allowed one', () => {
    expect(isAllowedRequest('POST', '/v1/predictions/abc123/cancel')).toBe(false);
    expect(isAllowedRequest('GET', '/v1/predictions/abc123/logs')).toBe(false);
    expect(isAllowedRequest('POST', '/v1/models/a/b/predictions/extra')).toBe(false);
  });

  it('refuses traversal and separator tricks in the model segments', () => {
    expect(isAllowedRequest('POST', '/v1/models/../../account/predictions')).toBe(false);
    expect(isAllowedRequest('GET', '/v1/predictions/../account')).toBe(false);
    expect(isAllowedRequest('GET', '/v1/predictions/abc%2f..%2faccount')).toBe(false);
  });

  it('ignores the query string when matching', () => {
    expect(isAllowedRequest('GET', '/v1/predictions/abc123?foo=bar')).toBe(true);
  });

  it('handles a missing or empty path without throwing', () => {
    expect(isAllowedRequest('GET', undefined)).toBe(false);
    expect(isAllowedRequest('GET', '')).toBe(false);
  });
});

describe('filterRequestHeaders', () => {
  it('forwards only what Replicate needs', () => {
    const out = filterRequestHeaders({
      authorization: 'Bearer r8_token',
      'content-type': 'application/json',
      accept: 'application/json',
    });
    expect(out.authorization).toBe('Bearer r8_token');
    expect(out['content-type']).toBe('application/json');
    expect(out.accept).toBe('application/json');
  });

  it('drops cookies and other browser-added headers', () => {
    const out = filterRequestHeaders({
      authorization: 'Bearer r8_token',
      cookie: 'session=secret',
      origin: 'https://example.com',
      referer: 'https://example.com/page',
      'x-forwarded-for': '10.0.0.1',
      'content-length': '99',
    });
    expect(out).not.toHaveProperty('cookie');
    expect(out).not.toHaveProperty('origin');
    expect(out).not.toHaveProperty('referer');
    expect(out).not.toHaveProperty('x-forwarded-for');
    // Recomputed from the body actually read, never taken from the client.
    expect(out).not.toHaveProperty('content-length');
  });

  it('rewrites host and identifies the proxy', () => {
    const out = filterRequestHeaders({ host: 'tools.example.com' });
    expect(out.host).toBe('api.replicate.com');
    expect(out['user-agent']).toBe('karmalab-tools-proxy');
  });

  it('does not invent headers that were absent', () => {
    expect(filterRequestHeaders({})).not.toHaveProperty('authorization');
  });
});

describe('filterResponseHeaders', () => {
  it('strips Set-Cookie but keeps the rest', () => {
    const out = filterResponseHeaders({
      'content-type': 'application/json',
      'set-cookie': ['a=1'],
    });
    expect(out['content-type']).toBe('application/json');
    expect(out).not.toHaveProperty('set-cookie');
  });
});

describe('clientKey', () => {
  it('prefers the platform-set fly-client-ip', () => {
    const req = {
      headers: { 'fly-client-ip': '203.0.113.7', 'x-forwarded-for': '10.0.0.1' },
      socket: { remoteAddress: '172.16.0.1' },
    };
    expect(clientKey(req)).toBe('203.0.113.7');
  });

  it('ignores a client-supplied x-forwarded-for by default', () => {
    // Otherwise a caller could rotate the header to reset their rate limit.
    const req = {
      headers: { 'x-forwarded-for': '10.0.0.1' },
      socket: { remoteAddress: '172.16.0.1' },
    };
    expect(clientKey(req)).toBe('172.16.0.1');
  });

  it('falls back to a constant when there is nothing to key on', () => {
    expect(clientKey({ headers: {}, socket: {} })).toBe('unknown');
  });
});

describe('RateLimiter', () => {
  it('allows requests up to the limit and refuses the next', () => {
    const limiter = new RateLimiter({ max: 3, windowMs: 1000 });
    expect(limiter.check('a', 0)).toBe(true);
    expect(limiter.check('a', 10)).toBe(true);
    expect(limiter.check('a', 20)).toBe(true);
    expect(limiter.check('a', 30)).toBe(false);
  });

  it('keeps buckets separate per client', () => {
    const limiter = new RateLimiter({ max: 1, windowMs: 1000 });
    expect(limiter.check('a', 0)).toBe(true);
    expect(limiter.check('b', 0)).toBe(true);
    expect(limiter.check('a', 0)).toBe(false);
  });

  it('lets a client through again once the window rolls over', () => {
    const limiter = new RateLimiter({ max: 1, windowMs: 1000 });
    expect(limiter.check('a', 0)).toBe(true);
    expect(limiter.check('a', 999)).toBe(false);
    expect(limiter.check('a', 1000)).toBe(true);
  });

  it('reports whole seconds until the window resets', () => {
    const limiter = new RateLimiter({ max: 1, windowMs: 5000 });
    limiter.check('a', 0);
    expect(limiter.retryAfter('a', 0)).toBe(5);
    expect(limiter.retryAfter('a', 4600)).toBe(1);
    // Never advertise a zero-second wait.
    expect(limiter.retryAfter('a', 5000)).toBe(1);
    expect(limiter.retryAfter('never-seen', 0)).toBe(0);
  });

  it('drops expired buckets so the map cannot grow without bound', () => {
    const limiter = new RateLimiter({ max: 5, windowMs: 1000 });
    for (let i = 0; i < 50; i++) limiter.check(`client-${i}`, 0);
    expect(limiter.buckets.size).toBe(50);
    // A rollover for one client sweeps every other expired bucket too.
    limiter.check('client-0', 2000);
    expect(limiter.buckets.size).toBe(1);
  });
});
