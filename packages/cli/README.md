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

That's the whole setup on localhost — the agent finds the hub by itself. No address, no token,
no config. `agent.live` tells you whether it's streaming. For every other environment you add
one env var and nothing else changes: see [One setup for every
environment](#one-setup-for-every-environment).

No bundler? Load the single-file build (~4 KB gzipped) with a plain script tag —
see the [agent README](https://github.com/yunwoo-yu/crosspane/tree/main/packages/agent#without-a-bundler).

**3. Reproduce the bug.** Console logs, uncaught errors, unhandled rejections, failed
requests and navigations show up in the dashboard — or in the exported file.

### One setup for every environment

The only thing that differs between localhost, a phone on your Wi-Fi, a deployed staging URL and
production is **how the page reaches your hub**. Give it one address that works from all of them
and there is nothing else to vary.

```ts
initCrosspane({
  label: 'checkout webview',
  serverUrl: process.env.NEXT_PUBLIC_CROSSPANE_URL,  // Vite: import.meta.env.VITE_CROSSPANE_URL
})
```

```
NEXT_PUBLIC_CROSSPANE_URL=https://crosspane.example.com
```

Just the address, like any other base URL — nothing appended, and the same value is fine in every
environment including production. Sending sessions needs no credential; **reading** them needs a
token that never leaves your machine, which is why a page source anyone can read gives nothing
away.

For a hub reachable from anywhere, one command does it:

```bash
crosspane --tunnel --write-env
```

That starts a tunnel with your installed `cloudflared` or `ngrok`, advertises its address, and
writes it into `.env.local` for you — so during local and on-device development there is nothing
to copy at all. Stop the hub and the tunnel and the env entry go with it. Session logs transit the
tunnel provider, which is why it's an explicit flag; crosspane never downloads a binary for you.

For a **deployed** app the address goes into your deployment config, so it must not change. Add a
hostname and crosspane sets the permanent tunnel up for you:

```bash
cloudflared tunnel login                                        # once, opens a browser
crosspane --tunnel --hostname crosspane.example.com             # every day
```

The second command creates the named tunnel, routes DNS to it and runs it — and it's idempotent,
so it's also the command you run tomorrow. Your deployment config keeps
`https://crosspane.example.com` forever.

Only the login can't be automated: a permanent public hostname belongs to an account somewhere, and
that account needs a browser once. (Measured while looking for a way around it: ngrok's free plan
refuses custom subdomains outright — *"Only paid plans may create endpoints with custom
subdomains"*. Tailscale Funnel gives a stable `*.ts.net` with no domain at all, if you'd rather not
use Cloudflare; point `--public-url` at it.)

### Who actually streams

By default every install with that address streams. That's what you want in a dev or QA build. If
the same build reaches people you don't want sending you logs, gate it on something your app
already knows — with `enabled: false` the agent installs **no hooks at all**:

```ts
initCrosspane({ serverUrl: HUB, enabled: () => user.isQA })
```

A feature flag, an internal-account check, a toggle in a hidden debug menu — anything. This is the
right gate for **a webview the app opens itself**, which is most of what this tool is for: there's
no address bar in one, so nothing URL-based can work there.

If the page has no user model at all (a static site, a kiosk), `isDebugActivated` gates on a link
instead — open the page once with `?__crosspane=on` and that device streams until
`?__crosspane=off`:

```ts
import { initCrosspane, isDebugActivated } from '@crosspane/agent'
initCrosspane({ serverUrl: HUB, enabled: isDebugActivated })
```

`agent.live` tells you which state you ended up in.

<details>
<summary>If you can't route logs through a tunnel</summary>

A tunnel is one flag but it does send session logs through a third party, which some teams can't
accept. Any of these replaces it, and the app-side code above does not change — only the address:

| | how | trade-off |
|---|---|---|
| **A team hub** | run the hub on real infrastructure with a normal certificate | nothing transits anyone else; needs somewhere to run it |
| **Your own certificate** | `crosspane --host 0.0.0.0 --tls-cert cert.pem --tls-key key.pem` | nothing leaves your network — but only works when the **page is on that network too** (an internal staging site, say). A page served from the public internet can never reach it, certificate or not |
| **Reverse proxy on your origin** | `crosspane --public-url https://staging.example.com/__crosspane`, and point that path at the hub | same origin, no third party; needs one route in your app server, forwarding the WebSocket upgrade |
| **Plain HTTP on your LAN** | `crosspane --host 0.0.0.0 --write-env` | simplest, and right for a dev server you open from a phone on the same Wi-Fi. A deployed page can't use it — see below |
| **No network at all** | `agent.copyCapture()` | unaffected by addresses, certificates and origins; the main path on a locked-down build |

**A deployed page reaching a hub on your LAN is a permission, not a prohibition.** Chrome answers
`LocalNetworkAccessPermissionDenied` — and `local-network-access` is a real permission whose state
is `prompt` in an ordinary browser, like camera or microphone. Measured with that check lifted and
nothing else changed: `https://example.com` → `wss://<lan-ip>.local-ip.sh/agent` delivered a session
and a console event to the hub, over a genuine Let's Encrypt certificate.

So a LAN hub *can* serve a deployed page, given a certificate valid for a name that resolves to the
private IP plus one grant on the device. Whether that prompt appears inside an **in-app webview** —
the case this tool exists for — is not yet verified, so the options below remain the reliable ones
for now.

A **self-signed certificate does not work** in app webviews either: since Android 7, apps don't
trust user-installed CAs. That's why crosspane accepts a certificate but never generates one — and
why `--tls-cert` is for a hub the page can actually reach (an internal network, or a public one).

Anyone who knows your hub's address can send junk sessions to it — never read one. If that matters
for a hub that's long-lived and shared, `--ingest-key <key>` requires a `?k=` from senders too, at
the cost of carrying it in your env var.

</details>

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
// Keep it on, gated — this is what lets you debug the bug that only happens in production
initCrosspane({ serverUrl: HUB, enabled: isDebugActivated })

// Or drop it from store builds entirely, if you never want it shipped
if (process.env.NODE_ENV !== 'production') {
  const { initCrosspane } = await import('@crosspane/agent')
  initCrosspane({ label: 'checkout webview' })
}
```

- `enabled: false` installs **no hooks at all** — `console`/`fetch`/XHR stay untouched, so a
  visitor who hasn't opted in is unaffected
- The address in your build is just an address: sending sessions needs no credential, and
  **reading** them needs a token that stays on your machine. That's why it's safe in a page whose
  source anyone can read — see [SECURITY.md](https://github.com/yunwoo-yu/crosspane/blob/main/SECURITY.md)
- Response bodies are **not** captured unless you pass `captureBodies: true`
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
