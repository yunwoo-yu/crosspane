# Security Policy

## Supported versions

Only the latest published version receives security fixes (the project is pre-1.0).

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Instead use
[GitHub private vulnerability reporting](https://github.com/yunwoo-yu/crosspane/security/advisories/new).

You can expect an initial response within a week. Once a fix is released the
report will be credited (unless you prefer otherwise).

## Threat model

crosspane moves debugging data (console output, request metadata, optionally response
bodies) out of an app and into a local dashboard. The sensitive parts:

**`@crosspane/agent` (runs inside your app)**
- Anything that makes the agent observable to the host page beyond its documented
  hooks, or that changes page behavior (breaking `fetch` semantics, leaking into
  `console` output, throwing into app code) is in scope.
- `enabled: false` must install nothing. A regression where hooks are installed
  despite being disabled is a security bug, not just a performance one — apps rely
  on this to keep debugging out of store builds.
- Response bodies must stay opt-in (`captureBodies`). A change that captures them by
  default is in scope.

**`crosspane` hub**
- The hub binds to `127.0.0.1` by default. Anything that exposes it without the
  explicit `--host` opt-in is in scope.
- The dashboard WebSocket validates `Origin` to prevent a malicious website from
  connecting to `ws://localhost:7788/ws` and reading session logs (cross-site
  WebSocket hijacking). Bypasses are in scope.
- Session events are relayed, not executed. Anything that turns relayed data into
  code execution, path traversal (dashboard static serving), or unbounded memory
  growth is in scope.

**Capture files**
- `.crosspane.json` contains whatever the agent recorded. Treat these as sensitive
  artifacts; crosspane does not encrypt or redact them beyond the `captureBodies`
  default. Guidance issues about this are welcome as normal issues.

**Network exposure**
- By default the hub binds to `127.0.0.1`, so only your machine can reach it.
- `--host` (e.g. `0.0.0.0`) exposes it to your network so devices can connect. Because the
  hub carries session logs — console output, request URLs, and response bodies if you opted
  in — exposing it generates a **one-time access token**, printed with the URLs at startup and
  required on `/ws`, `/agent`, `/capture/:id`, and `/hub-info`. Without it, anyone who can
  reach the hub could read every session's history and register fake sessions. The token is
  regenerated on each restart and is not persisted.
- The token travels as a `?t=` query parameter, because browsers cannot set headers on a
  WebSocket handshake. It may therefore appear in proxy or server logs on the path between
  you and the hub; treat it as short-lived, not as a credential to store.
- `--no-auth` turns the token off. Only use it on a network you fully trust.

**Out of scope**
- Shipping the agent enabled in a production build is a deployment choice; see
  "Shipping safely" in the README.
