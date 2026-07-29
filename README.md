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

// Offline mode: wire this to a debug gesture / hidden QA menu
agent.exportFile()   // downloads <label>.crosspane.json
```

No bundler? Load the single-file build (~2.5 KB gzipped) with a plain script tag —
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
- `enabled: false` installs no hooks at all — `console`/`fetch` stay untouched
- The agent has no dependencies and adds a few KB gzipped

## CLI

```
crosspane [options]

--port <n>     dashboard port (default: 7788; the default port falls back +1 when taken,
               an explicit port does not)
--host <addr>  bind address (default: 127.0.0.1 — local only. Use 0.0.0.0 to receive
               live agent sessions from phones/devices on your network)
--no-open      don't open the dashboard automatically
--verbose      diagnostic logging — attach to bug reports
-v, --version  print the version
-h, --help     show help
```

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
agent.dispose()      // → restores console/fetch/XHR, closes the live connection
```

## Platform support

The agent is plain DOM JavaScript — it runs in any modern webview or browser:
Android WebView, WKWebView, React Native WebView, Flutter InAppWebView, in-app browsers,
Electron, kiosk browsers. The hub runs on macOS, Windows and Linux (Node ≥ 20).

## Roadmap

- [x] Screen recording via rrweb — [@crosspane/agent-replay](https://github.com/yunwoo-yu/crosspane/tree/main/packages/agent-replay)
- [ ] Attach mode: Android WebView over CDP (`adb`) for full DevTools on debug builds
- [ ] iOS WebKit Inspector attach via pymobiledevice3
- [ ] MCP server — let coding agents query session logs directly
- [ ] Framework adapters (React Native bridge, Flutter)

## Development

```bash
pnpm install
pnpm test      # unit + integration
pnpm build
pnpm smoke     # end-to-end: real hub process + agent round-trip (no browsers needed)
```

See [ARCHITECTURE.md](https://github.com/yunwoo-yu/crosspane/blob/main/ARCHITECTURE.md) for the
design, [docs/decisions.md](https://github.com/yunwoo-yu/crosspane/blob/main/docs/decisions.md) for
why things are shaped the way they are, and
[CONTRIBUTING.md](https://github.com/yunwoo-yu/crosspane/blob/main/CONTRIBUTING.md) to get started.

Try it in 30 seconds with the [demo page](https://github.com/yunwoo-yu/crosspane/tree/main/examples/demo).

## License

[MIT](https://github.com/yunwoo-yu/crosspane/blob/main/LICENSE)
