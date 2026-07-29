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

- **Live** — the agent streams to the hub over your LAN, you watch in real time, and can
  save any session to a file from the dashboard
- **Offline** — the agent keeps the last N events in a ring buffer; export one JSON file,
  send it to a developer, replay it in the same dashboard

## Quick start

**1. Run the hub**

```bash
npx crosspane                  # dashboard on http://localhost:7788
npx crosspane --host 0.0.0.0   # also accept live sessions from devices on your network
                               # (prints an access token — session logs are not public)
```

**2. Add the agent to your app** (dev/QA builds only — see [Shipping safely](#shipping-safely))

```bash
npm install @crosspane/agent
```

```ts
import { initCrosspane } from '@crosspane/agent'

const agent = initCrosspane({
  label: 'checkout webview',
  // omit serverUrl for offline-only capture
  serverUrl: 'http://192.168.0.10:7788',
})

// Offline mode: wire this to a debug gesture / hidden QA menu.
// In a webview, prefer copyCapture() — downloads often don't work there
// (see "Getting captures off a locked device")
agent.exportFile()   // downloads <label>.crosspane.json
```

No bundler? Load the single-file build (~3.4 KB gzipped) with a plain script tag —
see the [agent README](https://github.com/yunwoo-yu/crosspane/tree/main/packages/agent#without-a-bundler).

**3. Reproduce the bug.** Console logs, uncaught errors, unhandled rejections, failed
requests and navigations show up in the dashboard — or in the exported file.

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
               hub generates a one-time access token, printed with the URLs; put it in
               the agent's serverUrl)
--no-auth      disable that token — only on a network you fully trust
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
  serverUrl?: string        // live mode; omit for offline-only
  bufferSize?: number       // ring buffer size (default: 2000 events)
  captureBodies?: boolean   // capture response bodies (default: false)
  bodyPreviewLimit?: number // default: 2048 chars
})

agent.capture()      // → SessionCapture object (send it wherever you like)
agent.exportFile()   // → downloads .crosspane.json
agent.copyCapture()  // → Promise<boolean>, puts the JSON on the clipboard
agent.dispose()      // → restores console/fetch/XHR, closes the live connection
```

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
| Live mode (`serverUrl`) | ✓ | Best when the device can reach your machine; the hub also saves sessions itself |

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
