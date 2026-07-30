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

## One setup for every environment

Point it at one address that is reachable from everywhere, and nothing else varies between
localhost, a phone, a deployed page and production:

```ts
import { initCrosspane, isDebugActivated } from '@crosspane/agent'

initCrosspane({
  label: 'checkout webview',
  serverUrl: process.env.NEXT_PUBLIC_CROSSPANE_URL,  // Vite: import.meta.env.VITE_CROSSPANE_URL
  enabled: isDebugActivated,
})
```

```
NEXT_PUBLIC_CROSSPANE_URL=https://crosspane.example.com
```

The same value is fine in every environment, production included. Sending sessions needs no credential;
**reading** them needs a token that never leaves your machine. So a page source anyone can read
gives nothing away, and `enabled: isDebugActivated` means **no hooks are installed at all** until a
device opts in by opening the page once with `?__crosspane=on` (`?__crosspane=off` clears it).

Run `crosspane --help` for how to get an address like that; a named `cloudflared` tunnel on a
domain you already own is one command and free.

Two things worth knowing rather than configuring:

- **On `localhost` you can skip the env var.** With no address at all the agent looks for a hub on
  `http://localhost:7788` by itself.
- **A webview the app opens itself has no address bar**, so `?__crosspane=on` can't be typed there.
  Gate on something the app already knows: `enabled: () => user.isQA`.
- **`agent.copyCapture()` always works** — no address, certificate or origin involved. That is the
  path for a build that can't reach anything.

If you skip `enabled`, every device with that build streams; if you skip `serverUrl` on a deployed
page, the env var is read instead but then a device also has to opt in. `agent.live` tells you
which state you ended up in.

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
