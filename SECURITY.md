# Security policy

## Reporting a vulnerability

**Please don't open a public issue.** Use GitHub's private vulnerability
reporting instead:

> [**Report a vulnerability**](https://github.com/karmalab-tech/karmalab-tools/security/advisories/new)
> — or go to the repository's **Security** tab → **Report a vulnerability**.

That opens a private thread visible only to the maintainers. Please include what
you did, what happened, and what you expected — a reproducible request is worth
more than a description.

This is a small project maintained alongside other work, so expect a first reply
within about a week rather than within hours.

## Scope

Only the code in this repository. Issues in Replicate's own API, in the models,
or in a third-party host belong with those projects.

### The proxy is the interesting part

`server/index.js` proxies requests to `api.replicate.com` so the browser can
reach it at all — Replicate sends no CORS headers. The design deliberately takes
the Replicate token **from the browser** and stores none server-side.

That means a deployed instance is an anonymous relay to a narrow slice of
Replicate's API. It is a known and documented tradeoff, not a vulnerability, and
`server/proxy.js` bounds it: only the two request shapes the app makes are
forwarded, only the headers Replicate needs go upstream, and requests are capped
and rate limited. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#the-key-constraint-the-replicate-proxy).

**In scope** — anything that defeats those bounds, for example:

- Reaching a Replicate endpoint outside the allowlist through the proxy.
- Getting a header the allowlist should have dropped — `cookie` especially —
  forwarded upstream.
- Bypassing the rate limit or the body cap, or wedging the server with a crafted
  request.
- Reading a file outside `dist/` through the static file handler.
- Leaking one user's API key to another user, or to any third party.
- Anything that causes a key to be logged or persisted server-side.

**Out of scope** — the documented design itself:

- "Anyone can use the proxy with their own token." Yes; that's the design.
- "The API key is readable in `localStorage`." It belongs to that browser's user,
  and it's how the app works without accounts.
- Missing hardening that has no exploit behind it (a header you'd like to see set,
  a scanner's default finding).

## Deploying this yourself

If you deploy publicly, read the proxy note in the
[README](README.md#a-note-on-the-replicate-proxy) first, and tune
`PROXY_RATE_LIMIT_MAX` and `PROXY_MAX_BODY_BYTES` for your host. The stronger
setup is to hold a Replicate token server-side and authenticate your own users
rather than accepting a token from the browser.
