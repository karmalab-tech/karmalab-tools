# Security policy

**Please don't open a public issue.** Use
[private vulnerability reporting](https://github.com/karmalab-tech/karmalab-tools/security/advisories/new)
— the repository's **Security** tab → **Report a vulnerability**. Include what you
did, what happened, and what you expected; a reproducible request is worth more
than a description.

This is a small project maintained alongside other work, so expect a first reply
within about a week.

## Scope

Only the code in this repository — issues in Replicate's API, in the models, or in
a third-party host belong with those projects.

The interesting part is the proxy. `server/index.js` forwards requests to
`api.replicate.com` because Replicate sends no CORS headers, and the design
deliberately takes the Replicate token **from the browser**, storing none
server-side. So a deployed instance is an anonymous relay to a narrow slice of
Replicate's API. That's a documented tradeoff, not a vulnerability, and
`server/proxy.js` bounds it — see [AGENTS.md](AGENTS.md#what-the-proxy-allows-and-why).

**In scope** — anything that defeats those bounds:

- Reaching a Replicate endpoint outside the allowlist through the proxy.
- Getting a header the allowlist should have dropped — `cookie` especially —
  forwarded upstream.
- Bypassing the rate limit or body cap, or wedging the server with a crafted
  request.
- Reading a file outside `dist/` through the static file handler.
- Leaking one user's API key to another user or any third party, or causing a key
  to be logged or persisted server-side.

**Out of scope** — the documented design itself: that anyone can use the proxy
with their own token, that the API key is readable in the `localStorage` of the
browser it belongs to, and hardening suggestions with no exploit behind them.

If you deploy this publicly, read the proxy note in the
[README](README.md#a-note-on-the-replicate-proxy) first and tune the `PROXY_*`
environment variables for your host.
