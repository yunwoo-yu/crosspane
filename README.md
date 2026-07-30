# crosspane

<p>
  <a href="https://www.npmjs.com/package/crosspane"><img alt="npm version" src="https://img.shields.io/npm/v/crosspane.svg?color=cb3837"></a>
  <a href="https://github.com/yunwoo-yu/crosspane/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/yunwoo-yu/crosspane/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/yunwoo-yu/crosspane/blob/main/LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <img alt="node 20+" src="https://img.shields.io/node/v/crosspane.svg">
</p>

**Debug web screens where devtools can't reach.**

In-app webviews, in-app browsers (KakaoTalk, Instagram, Line), kiosks, TVs, security-hardened
builds — the places where `chrome://inspect` shows nothing and Safari's Develop menu stays
empty. crosspane gives those screens a console, a network log and a shareable capture file.

> **⚠️ Beta** — APIs and CLI flags may change between minor versions until 1.0.
> Bug reports and feedback are very welcome — please [open an issue](https://github.com/yunwoo-yu/crosspane/issues).

![Console and network events from a webview arriving in the crosspane dashboard in real time](https://raw.githubusercontent.com/yunwoo-yu/crosspane/main/docs/images/demo.gif)

*A page with no devtools access, streaming its console and network activity to the dashboard.*

## How it works

```
your app (dev/QA build)                 your machine
┌──────────────────────────┐            ┌──────────────────────────┐
│  @crosspane/agent        │  live WS   │  crosspane hub           │
│  console · errors        │ ─────────► │  dashboard on :7788      │
│  fetch/XHR · navigation  │            │  console · network       │
│  crash-resistant buffer  │            │                          │
└──────────┬───────────────┘            └──────────────────────────┘
           │  export .crosspane.json  ──────────►  drop into the dashboard
           │  (no network needed — works behind ISMS-P / MDM locks)
```

Two ways to get the data out, because networks aren't always available:

- **Live** — the agent streams to the hub (your LAN by default, or through a tunnel or your
  own origin), you watch in real time, and can save any session to a file from the dashboard
- **Offline** — the agent keeps the last N events in a ring buffer; export one JSON file,
  send it to a developer, replay it in the same dashboard

## Quick start

**1. Run the hub**

```bash
npx crosspane                  # dashboard on http://localhost:7788
npx crosspane --host 0.0.0.0   # also accept live sessions from devices on your network
                               # (prints an access token — session logs are not public)
                               # add --write-env and you never have to copy the address
```

**2. Add the agent to your app** (dev/QA builds only — see [Shipping safely](#shipping-safely))

```bash
npm install @crosspane/agent
```

```ts
import { initCrosspane } from '@crosspane/agent'

const agent = initCrosspane({ label: 'checkout webview' })

// Offline mode: wire this to a debug gesture / hidden QA menu.
// In a webview, prefer copyCapture() — downloads often don't work there
// (see "Getting captures off a locked device")
agent.exportFile()   // downloads <label>.crosspane.json
```

That's the whole setup on localhost — the agent finds the hub by itself. No address, no
token, no config. `agent.live` tells you whether it's streaming.

No bundler? Load the single-file build (~4 KB gzipped) with a plain script tag —
see the [agent README](https://github.com/yunwoo-yu/crosspane/tree/main/packages/agent#without-a-bundler).

**3. Reproduce the bug.** Console logs, uncaught errors, unhandled rejections, failed
requests and navigations show up in the dashboard — or in the exported file.

### Other environments: it's just an env var

The agent only auto-connects when the page is on `localhost`, so a build that reaches real
users never phones home. Everywhere else the address comes from your environment config —
the same mechanism you already use for API URLs:

```ts
initCrosspane({
  label: 'checkout webview',
  serverUrl: process.env.NEXT_PUBLIC_CROSSPANE_URL,  // Vite: import.meta.env.VITE_CROSSPANE_URL
})
```

```
.env.development   NEXT_PUBLIC_CROSSPANE_URL=http://localhost:7788
.env.staging       NEXT_PUBLIC_CROSSPANE_URL=https://crosspane.staging.example.com
.env.production    (leave it out)
```

Each build gets the right address, production gets none, and there are no crosspane flags
involved. If the variable is unset the agent falls back to offline capture — it never
guesses. You can also omit `serverUrl` entirely: the agent reads those same variable names
itself (`NEXT_PUBLIC_`, `VITE_`, `PUBLIC_`, `REACT_APP_`).

**The one case where a static value can't work** is a hub on your own laptop plus a device
that isn't your laptop — a phone on your Wi-Fi. The LAN address and the access token change
every restart, so only the hub knows them. Let it write them:

```bash
npx crosspane --host 0.0.0.0 --write-env   # writes .env.local, removed when the hub stops
npm run dev                                # restart so the dev server picks it up
```

**On a deployed page, omitting `serverUrl` also asks each device to opt in once** — open it
with `?__crosspane=on` (that choice sticks; `?__crosspane=off` clears it). This keeps a
shared staging URL from streaming every visitor's session. Passing `serverUrl` explicitly
skips that gate, because writing the address down is already a deliberate act. The link only
ever carries "on": the destination comes from the build, never from the URL, so a link can't
redirect anyone's logs somewhere else.

### Debugging an `https://` page

This is about **where you run the hub**, not about your app config — the env var above
doesn't change.

A secure page cannot open a plain `ws://` connection (measured; `img`, `iframe` and `fetch`
all get the same treatment, and `localhost` gets no exception). So the hub needs to be
reachable over `wss://` with a certificate the device already trusts. If your team already
runs a hub at a fixed `https://` address, you're done — put it in `.env.staging` and stop
reading. Otherwise, one of these makes your own hub reachable:

| | how | trade-off |
|---|---|---|
| **Tunnel** | `cloudflared tunnel --url http://localhost:7788`, then run the hub with `--public-url https://<id>.trycloudflare.com` | works on any network including cellular, no certificate of your own — but session logs transit the tunnel provider |
| **A certificate the device trusts** | `--tls-cert cert.pem --tls-key key.pem` | nothing leaves your network; needs a corporate CA already on your devices, or a public certificate for a name resolving to your LAN IP |
| **Reverse proxy on the staging origin** | `--public-url https://staging.example.com/__crosspane`, and point that path at the hub | same origin, no third party; needs one route in your app server, forwarding the WebSocket upgrade |
| **Nothing at all** | `agent.copyCapture()` | no network, no certificate, no origin rules — the path that always works |

A **self-signed certificate does not work** in app webviews: since Android 7, apps don't
trust user-installed CAs, so no amount of installing helps. That's why crosspane accepts a
certificate but never generates one.

## What you get

- **Console** — `console.*` with argument serialization, uncaught errors with stacks,
  unhandled promise rejections. Filter by level, search, follow-tail
- **Network** — fetch and XHR with status, duration and failures (`status 0` = blocked or
  offline, the thing that's invisible in a webview). Optional response body previews
- **Navigation timeline** — SPA route changes included, so logs are grouped by screen
- **Session list** — several devices at once, each labeled, live/ended state, error badges
- **Save and replay** — save what you're watching live to a `.crosspane.json`, or drop a file
  someone sent you back into the dashboard; identical UI either way
- **Screen recording** (opt-in) — add `@crosspane/agent-replay` to record the DOM and play
  it back in the Screen tab, in the same timeline as the logs
- **MCP server** — `crosspane mcp` lets a coding agent read the sessions itself, so you can
  ask "why did the payment webview fail?" instead of copying logs out of the dashboard

![Replaying a recorded session in the Screen tab](https://raw.githubusercontent.com/yunwoo-yu/crosspane/main/docs/images/dashboard-screen-replay.png)

## Why not just use remote debugging?

Use it when you can — `chrome://inspect` and Safari Web Inspector are better tools.
crosspane exists for when they don't work:

| Situation | Remote inspector | crosspane |
|---|---|---|
| Release build without `setWebContentsDebuggingEnabled` / `isInspectable` | ✗ nothing appears | ✓ |
| App protection (ISMS-P style) that kills the app on debugger attach | ✗ | ✓ |
| Tester on another desk / another city with no Mac | ✗ | ✓ export a file |
| In-app browser inside someone else's app | ✗ | ✓ (if you control the page) |
| Kiosk, TV, embedded display | ✗ | ✓ |
| Breakpoints, DOM inspection, profiling | ✓ | ✗ — use the real inspector |

## Shipping safely

crosspane collects console output and request metadata. Treat it as a debug build feature:

```ts
// Recommended: let the bundler drop it entirely from store builds
if (process.env.NODE_ENV !== 'production') {
  const { initCrosspane } = await import('@crosspane/agent')
  initCrosspane({ label: 'checkout webview' })
}

// Or gate at runtime (feature flag, internal account, hidden gesture)
initCrosspane({ enabled: () => user.isInternal })
```

- Response bodies are **not** captured unless you pass `captureBodies: true`
- Exposing the hub with `--host` requires an access token, so session logs aren't readable
  by anyone else on the network — see [SECURITY.md](https://github.com/yunwoo-yu/crosspane/blob/main/SECURITY.md)
- `enabled: false` installs no hooks at all — `console`/`fetch` stay untouched
- The agent has no dependencies and adds a few KB gzipped

## CLI

```
crosspane [options]

--port <n>     dashboard port (default: 7788; the default port falls back +1 when taken,
               an explicit port does not)
--host <addr>  bind address (default: 127.0.0.1 — local only. Use 0.0.0.0 to receive
               live agent sessions from phones/devices on your network. Exposing the
               hub generates a one-time access token, printed with the URLs. Use
               --write-env and you never have to copy it)
--no-auth      disable that token — only on a network you fully trust
--write-env [file]
               write this hub's address and token into an env file (default .env.local)
               so the agent needs no arguments; removed again when the hub stops
--tls-cert <file> / --tls-key <file>
               serve the hub over https/wss — required to debug an https:// page
--public-url <url>
               advertise this address instead of the LAN one, for a tunnel or a
               reverse proxy in front of the hub
--no-open      don't open the dashboard automatically
--verbose      diagnostic logging — attach to bug reports
-v, --version  print the version
-h, --help     show help
```

## Ask a coding agent instead (MCP)

`crosspane mcp` exposes the running hub's sessions over the Model Context Protocol, so a
coding agent can read the console and network itself. Register it once:

```json
{ "mcpServers": { "crosspane": { "command": "crosspane", "args": ["mcp"] } } }
```

Then, with the hub running and a device attached, ask in plain language — *"the checkout
webview on the test phone is stuck on the spinner, what's failing?"* The agent calls
`list_sessions`, then `get_errors`, and reads the stack and the failed request itself.

| Tool | Returns |
|---|---|
| `list_sessions` | attached sessions with labels, platform and event counts |
| `get_errors` | exceptions, console errors and failed requests, in order |
| `get_console` | console output, filterable by level and text |
| `get_network` | requests with status and duration, `failedOnly` to narrow |
| `get_timeline` | everything chronologically, to see the lead-up to a failure |

Sessions can be named by id, by label, or by part of a label; omit it entirely when only one
device is attached. Pass `--hub <url>` if the hub isn't on the default port.

## Agent API

```ts
const agent = initCrosspane({
  label?: string            // shown in the dashboard (default: document.title)
  enabled?: boolean | (() => boolean)
  serverUrl?: string        // usually omit — resolved automatically (see below)
  bufferSize?: number       // ring buffer size (default: 2000 events)
  captureBodies?: boolean   // capture response bodies (default: false)
  bodyPreviewLimit?: number // default: 2048 chars
})

agent.live           // → true if streaming to a hub (false = offline capture only)
agent.capture()      // → SessionCapture object (send it wherever you like)
agent.exportFile()   // → downloads .crosspane.json
agent.copyCapture()  // → Promise<boolean>, puts the JSON on the clipboard
agent.dispose()      // → restores console/fetch/XHR, closes the live connection
```

`serverUrl` is resolved in this order, so you rarely pass it:

| Page is on | Live mode connects to |
| --- | --- |
| `localhost` | `http://localhost:7788` automatically, or the injected address if there is one |
| any other host | the injected address — **only** on devices activated with `?__crosspane=on` |
| anywhere, no injected address | nothing; the ring buffer still records for offline capture |

Passing `serverUrl` yourself always wins and never needs activation — writing it down is
already a deliberate act. Injected addresses are treated more carefully because CI puts
them there, so they can end up in a production build.

## Getting captures off a locked device

Offline capture is the main path on a security-locked build, so the capture has to be able
to leave the device. **Do not assume the download works** — `exportFile()` creates a blob
and clicks a link, which a webview only honours if the host app implements downloads
(`setDownloadListener` on Android, `WKDownloadDelegate` on iOS); in-app browsers usually
block it outright, and there is no way to detect the failure from JavaScript.

Worse, the modern escape hatches are unavailable exactly where you need them. An in-house
build served from `http://<lan-ip>` is **not a secure context**, so `navigator.clipboard`
and `navigator.share` are not merely restricted — they are `undefined` (measured, not
assumed). Pick a route that survives that:

| Route | Works without app changes | Notes |
|---|---|---|
| `agent.copyCapture()` | ✓ | Falls back to `execCommand('copy')` on non-secure origins. Needs a user gesture — call it from a tap, not on a timer. Returns `false` if it couldn't copy: **show that to the tester**, or they'll blame the tool instead of reporting the bug |
| Native bridge | ✗ (a few lines of app code) | The most reliable route for RN / native webviews — see below |
| `agent.exportFile()` | ✗ | Fine in a desktop browser or a webview whose host implements downloads |
| Live mode | ✓ | Best when the device can reach your machine; the hub also saves sessions itself. From an `https://` page the hub needs `wss://` — see [Debugging an `https://` page](#debugging-an-https-page) |

For a native webview, hand the object to the app and let it write a file or open a share
sheet — it is a plain JSON-serializable value:

```ts
// React Native WebView
window.ReactNativeWebView?.postMessage(JSON.stringify(agent.capture()))

// iOS WKWebView (app registers a "crosspane" script message handler)
window.webkit?.messageHandlers?.crosspane?.postMessage(agent.capture())

// Android (app calls addJavascriptInterface(obj, "CrosspaneNative"))
window.CrosspaneNative?.save(JSON.stringify(agent.capture()))
```

## Platform support

The agent is plain DOM JavaScript — it runs in any modern webview or browser:
Android WebView, WKWebView, React Native WebView, Flutter InAppWebView, in-app browsers,
Electron, kiosk browsers. The hub runs on macOS, Windows and Linux (Node ≥ 20).

## Roadmap

- [x] Screen recording via rrweb — [@crosspane/agent-replay](https://github.com/yunwoo-yu/crosspane/tree/main/packages/agent-replay)
- [x] MCP server — `crosspane mcp`, so coding agents query session logs directly
- [ ] Attach mode: Android WebView over CDP (`adb`) for full DevTools on debug builds
- [ ] iOS WebKit Inspector attach via pymobiledevice3
- [ ] Framework adapters (React Native bridge, Flutter)

## Development

```bash
pnpm install
pnpm build
pnpm try       # hub on :7788 + demo page on :7999 — open the demo page and click things
```

```bash
pnpm test      # unit + integration
pnpm coverage  # same, with the coverage ratchet enforced
pnpm typecheck # sources and tests
pnpm smoke     # end-to-end: real hub process + agent round-trip (no browsers needed)
```

See [ARCHITECTURE.md](https://github.com/yunwoo-yu/crosspane/blob/main/ARCHITECTURE.md) for the
design, [docs/decisions.md](https://github.com/yunwoo-yu/crosspane/blob/main/docs/decisions.md) for
why things are shaped the way they are, and
[CONTRIBUTING.md](https://github.com/yunwoo-yu/crosspane/blob/main/CONTRIBUTING.md) to get started.

Try it in 30 seconds with the [demo page](https://github.com/yunwoo-yu/crosspane/tree/main/examples/demo).

## License

[MIT](https://github.com/yunwoo-yu/crosspane/blob/main/LICENSE)
