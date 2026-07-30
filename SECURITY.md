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
- **Live mode must not auto-connect from a page that isn't on loopback.** The agent
  resolves the hub address itself when `serverUrl` is omitted, and the gate is the page's
  own hostname — not whether an address is available. This is what keeps a build that
  reaches real users from contacting anything. Anything that widens that gate is in scope,
  including treating a hostname that merely *contains* `localhost` as loopback.
- **On a deployed host, a build-time injected address must additionally require per-device
  activation** (`?__crosspane=on`). Env values are placed by CI and can survive into a
  production build, so the address alone must not be enough to start streaming.
- **The activation link must never carry a destination.** If the hub address could come
  from the URL, one crafted link (`?__crosspane=https://attacker.example`) would redirect a
  victim's console output and access token to an attacker. Destinations come only from the
  build or from an explicit `serverUrl`. Any change that lets a URL parameter influence
  where data is sent is in scope.

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
  in — exposing it generates **two separate credentials**, both printed at startup and both
  regenerated on each restart:
  - a **read token** (`?t=`) required on `/ws`, `/capture/:id` and `/hub-info`. This one can
    read every session, so it must never appear in a page. It is not persisted.
  - **`/agent` (sending sessions) needs no credential by default.** A public page cannot hold a
    secret — anything it knows is public — so the address itself is what identifies your hub.
    Consequence: anyone who knows the address can send junk sessions, and enough of them can
    push your own out of the retained-session limit. They cannot read a single session.
    `--ingest-key <key>` closes it for a hub that is long-lived and shared, at the cost of
    carrying that key in your app's env var.
  - Splitting read from write is what makes it safe to debug a **production** page. While one
    token guarded both directions, putting the agent on a live site leaked a read token in the
    page source — measured on a real deployment. `/agent` also accepts the read token so
    existing `serverUrl` values keep working.
- The token travels as a `?t=` query parameter, because browsers cannot set headers on a
  WebSocket handshake. It may therefore appear in proxy or server logs on the path between
  you and the hub; treat it as short-lived, not as a credential to store.
- `--no-auth` turns the token off. Only use it on a network you fully trust.
- `--write-env` writes that address **and token** into an env file (default `.env.local`).
  The hub warns if the file is not gitignored, and removes what it wrote when it stops. Treat
  the file as short-lived and never commit it.
- `--tls-cert`/`--tls-key` serve the hub over https/wss. crosspane does not generate
  certificates: a self-signed one is useless in app webviews (since Android 7, apps do not
  trust user-installed CAs), so the certificate has to be one the device already trusts.
- `--public-url` only changes the address crosspane *advertises*; it does not proxy anything.
  If it points at a tunnel, session logs transit that provider — use it only where that is
  acceptable.
- **`--public-url` counts as exposure and generates the access token**, even with the default
  loopback binding, because a tunnel or reverse proxy makes the hub reachable from outside this
  machine — with a tunnel, from the whole internet. An earlier build keyed the token off
  `--host` alone, so `crosspane --public-url https://…` produced a publicly reachable hub with
  no token at all. Any change that lets the hub be reachable from outside without a token is in
  scope.

**Out of scope**
- Shipping the agent enabled in a production build is a deployment choice; see
  "Shipping safely" in the README. Note that a production build will not stream anywhere on
  its own: auto-connect requires the page to be on loopback, and an injected address requires
  per-device activation. The ring buffer still records in memory for offline capture.
