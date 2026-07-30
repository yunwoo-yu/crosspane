# @crosspane/agent

## 0.6.1

### Patch Changes

- 9cb15d0: Export `isDebugActivated`, and honour the activation parameter on localhost

  Applying the agent to a real production site surfaced two problems.

  **The activation check wasn't available to the app.** Gating installation so that real visitors
  get no hooks at all is the normal thing to want on a live site, and `enabled` is the switch for
  it — but the agent kept its opt-in check private, so the app had to reimplement parameter
  reading, storage and the try/catch around it. That's now one import:

  ```ts
  initCrosspane({ serverUrl, enabled: isDebugActivated });
  ```

  **The activation parameter was silently ignored on loopback.** `resolveActivation` returned early
  for localhost without reading or persisting it, so `?__crosspane=on` didn't survive a navigation
  (breaking any app that gates on the stored value) and `?__crosspane=off` did nothing at all.
  Turning it off is now also recorded rather than just cleared — clearing left "no preference",
  which on loopback means on, so the choice came back on the next load.

## 0.6.0

### Minor Changes

- a591f5c: Live mode now works from `https://` pages, and from behind tunnels and reverse proxies

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

- a591f5c: Zero-config hub address: `initCrosspane({ label })` now needs no `serverUrl`

  The agent resolves the hub itself — explicit `serverUrl` > build-time injected env >
  `http://localhost:7788` when the page is on loopback > offline capture only. On localhost
  that means no address, no token, no config.

  For phones and deployed URLs, `crosspane --write-env` writes the hub's address (and access
  token) into `.env.local` under a managed block, picking the variable name from your
  `package.json` (`NEXT_PUBLIC_`/`VITE_`/`PUBLIC_`/`REACT_APP_`). The block is removed when the
  hub stops, so a dead address can't linger.

  Safe on deployed builds by design: the agent only auto-connects when the page itself is on
  loopback, and an injected address on any other host also requires per-device activation via
  `?__crosspane=on`. The activation link carries only "on" — the destination always comes from
  the build, never from the URL. A hand-written `serverUrl` keeps working unchanged and needs no
  activation.

  Also adds `agent.live`, so an app can tell whether it is streaming or recording offline.

### Patch Changes

- a591f5c: Treat a bogus `'undefined'`/`'null'` address as unset

  `serverUrl: \`${process.env.NEXT_PUBLIC_CROSSPANE_URL}\``yields the string`"undefined"`when the variable isn't set. That parsed as a URL failure and fell through to string
substitution, so the transport tried`undefined/agent` — no scheme, no diagnostic, retrying
  forever. It now counts as unset, which means offline capture instead of silent failure.

## 0.5.0

### Minor Changes

- bdaa6ee: Add `agent.copyCapture()` — puts the capture JSON on the clipboard and resolves to whether it
  worked.

  Offline capture is the main path on a security-locked build, but the only exit was a blob
  download, which a webview honours only if the host app implements downloads (and in-app
  browsers usually block outright) — with no way to detect the failure from JavaScript. The
  modern alternatives are unavailable exactly where they are needed: an in-house build served
  from `http://<lan-ip>` is not a secure context, so `navigator.clipboard` and `navigator.share`
  are `undefined` there. `copyCapture()` therefore falls back to `execCommand('copy')`, which is
  the working path in that environment rather than a legacy one.

  The README now documents how to get a capture off a locked device, including the
  native-bridge route for React Native and WKWebView hosts.

- 9bd4782: Collapse consecutive duplicate console events into one with a `repeat` count.

  A broken webview emits the same error thousands of times per second, and that one line used
  to consume every buffer in the system. Measured before this change: after 3,000 identical
  messages, the hub's 2,000-event history held **one distinct message** and the error that
  started the cascade was gone — which makes the capture file, the primary path on a
  security-locked build, useless exactly when it matters.

  Coalescing happens in the agent's ring buffer (so exported captures stay useful) and in the
  live transport's pending queue (so the hub's history and any late-joining dashboard see it
  too, and the connection carries less). Only console and page errors coalesce — network and
  navigation events stay separate, because requesting the same URL twice is not the same fact
  as requesting it once. The first occurrence's timestamp is kept so timeline position doesn't
  drift, and the count is shown rather than hidden.

  `SessionEvent` gains an optional `repeat` field on `console` and `pageerror` (absent means 1),
  which is backward compatible — older dashboards ignore it, and the capture file version is
  unchanged.

- c42a14d: Record when a repeated error stopped, not just when it started.

  Coalescing consecutive duplicates keeps the first occurrence's timestamp so the timeline
  position stays put — but that alone loses something important. An error repeating every five
  seconds for ten minutes collapsed to a single line stamped `10:00:00 ×120`, which reads as
  "it happened a few times at the start and stopped". Whether it is _still_ happening is often
  the most useful fact in the log.

  `console` and `pageerror` events now carry an optional `repeatUntil` (the last occurrence), and
  the dashboard shows the span next to the count — `×120 10m` — so an ongoing failure can't be
  mistaken for a burst. Bursts shorter than a second show no span, since a duration adds nothing
  there.

### Patch Changes

- 66bc6e8: Two fixes found by adding coverage to previously untested paths.

  **Navigation hook now restores the true original.** `hookNavigation` stored
  `history.pushState.bind(history)` as the "original" and restored that on `dispose()`, so every
  init → dispose cycle left another `bind` layer wrapped around `history.pushState` and the real
  original was never recovered. This is the permanent-pollution failure mode the SDK is supposed
  to prevent, and it triggers in HMR and in any app that toggles the agent.

  **Capture filenames keep non-ASCII labels.** The label was sanitized with `[^\w-]+`, which
  does not match Korean (or any non-Latin script) — a label like `결제 웹뷰` collapsed to a
  single `_`, making the filename useless for exactly the teams this tool targets. Labels now
  keep letters and digits from any script. The hub's `GET /capture/:id` sends the name as RFC
  6266 (`filename*=UTF-8''…` plus an ASCII fallback), because Node rejects non-ASCII header
  values and would otherwise throw while writing the response.

- 5b76984: Require an access token when the hub is exposed to a network.

  Measured before this change: with `--host 0.0.0.0`, any device on the same Wi-Fi could connect
  to `/ws` with a non-browser client and read every session's full history — console text
  included, which in a real session carries tokens and user data — download any capture file from
  `/capture/:id`, and register fake sessions through `/agent`. The Origin check that prevents
  cross-site WebSocket hijacking does not apply to clients that send no Origin, so it never stood
  in the way.

  Exposing the hub now generates a one-time token, printed with the URLs at startup and required
  on `/ws`, `/agent`, `/capture/:id`, and `/hub-info`. Loopback binds are unchanged — the OS
  already restricts those, and a token there would be friction with no benefit. `--no-auth` opts
  out for networks you fully trust.

  The dashboard picks the token up from its own URL, removes it from the address bar, and keeps it
  for the tab. The agent takes it from `serverUrl` (`http://<ip>:7788/?t=…`), and `crosspane mcp`
  from `--hub`. `SECURITY.md` now states what exposure means instead of listing it as out of scope.

- ef8e7ac: The agent no longer serializes an entire object before deciding to truncate it. `JSON.stringify` used to run to completion and the result was then cut, so a page logging a large object paid the full cost of building a string that was mostly discarded — instrumentation should not slow down the page it observes. Serialization now stops expanding once it exceeds the text budget, and truncation is reported explicitly rather than silently dropping data.

  The dashboard's screen panel also survives environments without `ResizeObserver` instead of throwing on mount; it falls back to a single measurement and gives up resize tracking.

- f2cd34f: Cut the cost of logging large payloads, and stop losing content on circular references.

  Console serialization runs on the page's own critical path, so it was measured in a real
  browser rather than reasoned about. Two findings:

  - **Large arrays were the real cost.** Logging a 10,000-item API response cost 497µs; a
    100,000-element array cost 6ms — a third of a frame, spent by the debugging tool. An array's
    `length` is O(1), so serializing only the head is free to detect: now 64µs and 24µs
    respectively (8× and 250×). The omitted count is reported in the output.
  - **Circular references discarded the whole object.** `JSON.stringify` throws on them, and the
    fallback was `String(value)` — `"[object Object]"`, no content at all. Now a second pass with
    a visited set marks just the circular edge, so the rest of the object survives.

  Typical logs are unchanged (~1.1µs). Deliberately _not_ changed: a plain object with 50,000
  keys still costs ~7ms, because `Object.keys` alone is 4.6ms and `JSON.stringify` performs the
  same enumeration internally — there is no implementation that avoids it. A hand-written
  bounded serializer was tried and reverted: it was 3× slower on everything typical. Both
  findings are recorded in `docs/decisions.md`, and `packages/agent/scripts/bench.mjs`
  reproduces the numbers.

- Updated dependencies [9bd4782]
- Updated dependencies [c42a14d]
  - @crosspane/protocol@0.4.0

## 0.4.0

### Minor Changes

- 348209f: Screen recording, as an opt-in plugin. `@crosspane/agent-replay` records the DOM with rrweb and rides the core agent's existing session timeline, so screen frames stay ordered alongside console and network events and land in `.crosspane.json` exports. The dashboard gains a **Screen** tab that plays them back, loading the player lazily so nobody pays for it unless a session actually has a recording.

  A prebuilt single-file bundle is included for environments without a bundler; it keeps `@crosspane/agent` external so the page reuses the agent instance it already loaded rather than starting a second session.

  It is a separate package because rrweb is tens of times larger than the core agent — the "no third-party dependencies, a few KB" promise of `@crosspane/agent` stays intact. The core gains one small extension point (`agent.emit`) and the protocol a generic `screen` event whose `format` field leaves room for non-rrweb capture methods later.

### Patch Changes

- c53c60b: Guard against double initialization: calling `initCrosspane` twice now returns the existing agent instead of installing a second layer of hooks. Double-hooking produced duplicate events and left `console`/`fetch` permanently wrapped, since `dispose()` only unwound one layer — a real hazard with hot reloads and duplicated bundles. Console and error text is also capped (`maxTextLength`, default 10000 chars) so a page logging huge objects can't crowd out the ring buffer or the wire; truncated entries say so rather than silently losing data.
- Updated dependencies [348209f]
  - @crosspane/protocol@0.3.0

## 0.3.0

### Minor Changes

- 94acf3c: Ship prebuilt single-file bundles so the agent can be used without a bundler — injecting through a proxy, kiosk builds, plain static pages. `dist/crosspane-agent.esm.js` for `<script type="module">` and `dist/crosspane-agent.global.js` (exposes `window.crosspane`) for a classic script tag. Both are ~2.5 KB gzipped and target ES2019, so older Android WebViews are covered. A bundle-size budget test guards against regressions.

## 0.2.0

### Minor Changes

- 79ed26a: **crosspane is now a webview debugging toolkit.**

  The multi-engine preview (Playwright + iOS Simulator + Android emulator mirroring) is gone.
  It could never reach the environments this project actually cares about: production in-app
  webviews, in-app browsers, and security-hardened builds where remote inspectors are blocked
  outright. That version is preserved at the `crosspane@0.6.2` tag.

  What replaces it:

  - **`@crosspane/agent`** — a dependency-free SDK you embed in dev/QA builds. Hooks console,
    uncaught errors, unhandled rejections, fetch/XHR and navigations into a crash-resistant ring
    buffer. Stream live to the hub over your LAN, or export a `.crosspane.json` capture file when
    the network isn't an option (ISMS-P / MDM locked devices).
  - **`crosspane`** — the hub CLI is now a session relay: receives live agents on `/agent`, serves
    the dashboard, replays history to late-joining dashboards. No browser dependencies, so
    installs are megabytes instead of hundreds.
  - **Dashboard** — session list (multiple devices at once, live/ended, error badges), console and
    network panels, and drag-and-drop replay of capture files through the exact same UI.
  - **`@crosspane/protocol`** — shared wire types, published so integrations can build on them.

### Patch Changes

- 107330d: Package docs and metadata for npm: README, LICENSE, repository/homepage/bugs fields.
- Updated dependencies [107330d]
- Updated dependencies [79ed26a]
  - @crosspane/protocol@0.2.0
