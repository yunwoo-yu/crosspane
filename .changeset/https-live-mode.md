---
'@crosspane/agent': minor
'crosspane': minor
---

Live mode now works from `https://` pages, and from behind tunnels and reverse proxies

A secure page cannot open a plain `ws://` connection, which meant live mode was simply
unavailable on any deployed HTTPS URL. Measured in a real browser: `wss://` with a trusted
certificate opens, plain `ws://` is blocked (localhost included — no carve-out), and a
self-signed certificate fails because Chrome offers no interstitial for WebSocket handshakes.

Two new hub flags cover every route to `wss://`:

- `--tls-cert` / `--tls-key` — serve the hub over https/wss. crosspane does not generate
  certificates: a self-signed one is useless in app webviews, since apps have not trusted
  user-installed CAs since Android 7. Bring a corporate CA that is already on your devices,
  or a publicly trusted certificate for a name that resolves to your LAN IP.
- `--public-url` — advertise a tunnel or reverse-proxy address instead of the LAN one.
  `--write-env`, `/hub-info` and the dashboard snippet all follow it, so
  `cloudflared tunnel --url http://localhost:7788` plus `--public-url https://<id>.trycloudflare.com`
  is enough to debug a deployed HTTPS page from any network, cellular included.

Fixes along the way:

- The agent, `crosspane mcp` and `--hub` all replaced the URL path with `/agent` or `/ws`
  instead of appending, so a path-prefixed proxy (`https://staging.example.com/__crosspane`)
  silently lost its prefix and never matched.
- `pnpm try:lan` was broken: it passed the hub port to the demo page but dropped the access
  token, so the exposed hub rejected the agent with 401 — the documented way to test from a
  phone did not work.
