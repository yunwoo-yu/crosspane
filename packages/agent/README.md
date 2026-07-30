# @crosspane/agent

Tiny in-page debugging agent for the places devtools can't reach — in-app webviews,
in-app browsers, kiosks, and security-hardened builds where remote inspectors are
blocked outright.

Captures console output, uncaught errors, unhandled rejections, fetch/XHR and
navigations. Stream it live to the [crosspane](https://www.npmjs.com/package/crosspane)
dashboard, or export a capture file when the network isn't an option.

**Zero dependencies. A few KB gzipped.**

## Install

```bash
npm install @crosspane/agent
```

## Use

```ts
import { initCrosspane } from '@crosspane/agent'

const agent = initCrosspane({ label: 'checkout webview' })

// Offline mode: wire this to a debug gesture or hidden QA menu
agent.exportFile() // downloads <label>.crosspane.json
await agent.copyCapture() // or put it on the clipboard — see the crosspane README,
                          // "Getting captures off a locked device"
```

Then run the hub and open the dashboard:

```bash
npx crosspane --host 0.0.0.0
```

Drop the exported `.crosspane.json` into the dashboard to replay it — same UI, no
server connection needed.

## Without a bundler

If you can't run a bundler — injecting into a page through a proxy, a kiosk build, a
plain static page — use the prebuilt single-file bundles (~4 KB gzipped):

```html
<!-- ES module -->
<script type="module">
  import { initCrosspane } from 'https://unpkg.com/@crosspane/agent/dist/crosspane-agent.esm.js'
  initCrosspane({ label: 'kiosk display' })
</script>

<!-- or a classic script tag: exposes window.crosspane -->
<script src="https://unpkg.com/@crosspane/agent/dist/crosspane-agent.global.js"></script>
<script>
  crosspane.initCrosspane({ label: 'kiosk display' })
</script>
```

Under a strict CSP, self-host the file instead of loading it from a CDN.

## Shipping safely

This is a debug-build feature. The cleanest approach is to let your bundler drop it
from production entirely:

```ts
if (process.env.NODE_ENV !== 'production') {
  const { initCrosspane } = await import('@crosspane/agent')
  initCrosspane({ label: 'checkout webview' })
}
```

Or gate it at runtime — with `enabled: false` the agent installs **no hooks at all**,
leaving `console`, `fetch` and `XMLHttpRequest` untouched:

```ts
initCrosspane({ enabled: () => user.isInternal })
```

Response bodies are **not** captured unless you pass `captureBodies: true`.

## API

```ts
initCrosspane(options?: {
  label?: string             // shown in the dashboard (default: document.title)
  enabled?: boolean | (() => boolean)
  serverUrl?: string         // usually omit — resolved automatically (see below)
  bufferSize?: number        // ring buffer size (default: 2000 events)
  captureBodies?: boolean    // capture response bodies (default: false)
  bodyPreviewLimit?: number  // default: 2048 chars
  maxTextLength?: number     // per console/error entry (default: 10000 chars)
}): CrosspaneAgent
```

| Method | Description |
|---|---|
| `agent.capture()` | Returns a `SessionCapture` object (the ring buffer contents) |
| `agent.exportFile()` | Downloads it as `.crosspane.json`. Silently does nothing in webviews whose host app doesn't implement downloads |
| `agent.copyCapture()` | Puts the capture JSON on the clipboard; resolves to `false` if it couldn't. Works on non-secure origins (`http://<lan-ip>`), where `navigator.clipboard` is undefined. Needs a user gesture |
| `agent.dispose()` | Restores `console`/`fetch`/XHR, closes the live connection |
| `agent.session` | Session metadata (id, label, userAgent, platform) |
| `agent.enabled` | `false` when gated off |
| `agent.live` | `true` if streaming to a hub; `false` means offline capture only |

## Where the hub address comes from

On `localhost` you don't configure anything. Everywhere else it's an ordinary env var, the
same way you configure an API URL:

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

Unset means offline capture only — the agent never guesses an address. You can also omit
`serverUrl` and let the agent read those variable names itself
(`NEXT_PUBLIC_`/`VITE_`/`PUBLIC_`/`REACT_APP_`).

Full resolution order, if you need the details:

| Page is on | Live mode connects to |
|---|---|
| `localhost` | `http://localhost:7788` automatically, or the configured address if there is one |
| any other host, `serverUrl` passed | that address |
| any other host, address only from env | it — but **only** on devices activated with `?__crosspane=on` |
| anywhere, no address | nothing; the ring buffer still records for offline capture |

Auto-connect requires the page itself to be on loopback, so a build that reaches real users
never contacts a hub. The activation gate applies to env-derived addresses because CI places
those and they can survive into a production build; an explicit `serverUrl` is a deliberate
act and skips it.

**In a webview the app opens itself there is no address bar, so `?__crosspane=on` cannot be
typed — pass `serverUrl` explicitly there.** The activation link is for pages you open by URL:
an in-app browser reached from a chat message or QR code, or a phone browser. Omitting
`serverUrl` where you can't add the parameter means nothing streams, with no way to see why
from inside the webview; `agent.live` is the only signal.

To keep one shared build from streaming everyone's session, gate `enabled` — with `false` the
agent installs **no hooks at all**, so other people's app is untouched:

```ts
import { initCrosspane, isDebugActivated } from '@crosspane/agent'

// only devices that opened ?__crosspane=on — nothing is installed for anyone else
initCrosspane({ serverUrl: process.env.NEXT_PUBLIC_CROSSPANE_URL, enabled: isDebugActivated })

// or gate on the account the app already knows (works with no address bar)
initCrosspane({ serverUrl: process.env.NEXT_PUBLIC_CROSSPANE_URL, enabled: () => user.isQA })

// or both
initCrosspane({ serverUrl, enabled: () => isDebugActivated() && user.isQA })
```

`isDebugActivated()` is the same check the agent uses internally, exported so you don't
reimplement the parameter/storage handling in every app.

A hub on your own laptop plus a phone is the one case a static value can't cover — the LAN
address and token change every restart. `crosspane --host 0.0.0.0 --write-env` writes them
into `.env.local` and removes them when the hub stops.

From an `https://` page the hub must be reachable over `wss://` with a certificate the device
trusts — see "Debugging an `https://` page" in the
[crosspane README](https://github.com/yunwoo-yu/crosspane#debugging-an-https-page).

## Notes

- Calling `initCrosspane` twice returns the same agent — hooks are never installed
  twice, so hot reloads and duplicated bundles are safe.
- Call `initCrosspane` as early as possible — anything logged before it runs isn't captured.
- The ring buffer keeps the **last** N events, so a crash still leaves you the moments
  before it. Events are buffered whether or not the live connection is up.
- Under a strict CSP you need `connect-src` to allow the hub for live mode. Bundling the
  agent (rather than loading it from a CDN) avoids `script-src` problems entirely.
- Breakpoints are not possible from inside the page — JavaScript can't pause itself.
  When a remote inspector *is* available, use it; this agent is for when it isn't.

## License

MIT
