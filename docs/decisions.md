# Decision log

Why things are the way they are. Read this before proposing structural changes —
several of these were arrived at the hard way.

## The product is the agent, not the dashboard

crosspane targets environments where remote inspectors are unavailable: release-build
webviews (iOS 16.4+ needs `isInspectable`, Android needs
`setWebContentsDebuggingEnabled`), in-app browsers, kiosks, and apps with protection
software that kills the process when a debugger attaches.

In those environments the only remaining channel is instrumentation the app ships with
itself. That is why the SDK — not the server — is the center of the project, and why
the SDK's constraints (zero third-party dependencies, no observable effect on the host
page, explicit gating) outrank convenience everywhere else.

## Why the 0.6.x engine-mirroring architecture was removed

Until 0.6.2, crosspane drove Chromium/WebKit/Firefox through Playwright and mirrored an
iOS Simulator and Android emulator via screenshots and H.264. It is preserved at the
`crosspane@0.6.2` tag.

It was removed because it could not reach the environments above: it only worked when
*we* owned the engine. It also carried hundreds of megabytes of browser binaries, and
"preview the same URL in three desktop engines" has an obvious substitute — opening
three browsers. Keeping it would have meant maintaining a large surface that did not
serve the goal.

## Packages

- `@crosspane/agent` — the in-page SDK
- `@crosspane/agent-replay` — optional screen recording (rrweb)
- `crosspane` — the hub CLI and dashboard
- `@crosspane/protocol` — shared wire types and constants

Two splits, two different reasons.

**`agent-replay` is separate because of cost.** rrweb is roughly twenty times the size of
the core agent (57 KB vs 3.4 KB gzipped), and many users never want screen capture. Code
that ships inside someone else's app has to let them decline what they don't use. The
plugin emits through the core's `agent.emit` rather than opening its own transport, so
there is still one connection, one session, one ordered timeline.

**`protocol` is separate because of dependency direction.** Folding the types into the
agent was considered and rejected: the hub is a Node program, and it would then depend on a
DOM-typed browser package purely for types. That inverts the direction — the shared
vocabulary should not live inside one of its consumers.

It also keeps the door open for consumers that are not the agent: the planned MCP server,
attach-mode adapters (Android CDP, iOS WebKit), a CI reporter that ingests
`.crosspane.json`. Those need the event types without `window`. The generic `screen.format`
field exists for the same reason — the protocol is meant to outlive any one capture method.

The package being small is not an argument against it; a shared vocabulary is supposed to be
small. What made it briefly look expensive was a release bug (a stale lockfile after a
version bump), which is fixed structurally rather than by collapsing the package.

Whatever the packaging, the event shape stays identical from the agent, through the hub, to
the dashboard and into exported capture files. There is no translation layer, which is what
lets live sessions and file replay share the same UI code.

## The name

`crosspane` no longer describes the product — it came from showing several panes side by
side. It is kept anyway: the package has publish history, and brand names do not have to
be descriptive.

## Publishing

`changeset publish` is not used. It routes through `pnpm publish --no-git-checks`, and
recent npm versions reject the unknown flag when publishing via OIDC. `scripts/ci-publish.mjs`
calls `npm publish` directly and then `changeset tag`. It skips versions already on the
registry, so re-running a failed release is safe.

Because `npm publish` (unlike `pnpm publish`) does **not** rewrite the `workspace:`
protocol, dependencies between workspace packages use plain semver ranges, and
`.npmrc` sets `link-workspace-packages=true` so local development still resolves to
symlinks. `crosspane@0.7.0` shipped with `"@crosspane/protocol": "workspace:*"` and was
completely uninstallable; `scripts/check-publishable.mjs` now fails the build if any
workspace/link/file specifier reaches a publishable package.

The version PR must also refresh `pnpm-lock.yaml`. Changesets rewrites version numbers and
the dependency ranges between workspace packages, but not the lockfile — so the next
`pnpm install --frozen-lockfile` in CI fails with `ERR_PNPM_OUTDATED_LOCKFILE`. The root
`version` script runs `changeset version && pnpm install --lockfile-only`, and the release
workflow points changesets at it.

## The hub serves capture files, the dashboard does not build them

Saving a live session goes through `GET /capture/:id` on the hub rather than serializing
what the dashboard holds. The hub keeps the original `SessionEvent` history; the dashboard
holds display-shaped entries that have been batched, capped and split across panels.
Reconstructing a capture from those would be lossy and would duplicate the mapping logic in
reverse. This way live-save and agent-export produce the same file format, and a saved file
replays through the exact code path a file from a tester does.

## The MCP server attaches to the hub as a dashboard client

`crosspane mcp` connects to the running hub over `/ws` — the same endpoint the dashboard
uses — rather than sharing memory with it or reading through a new query API. The hub
already replays `hello` plus full session history to every dashboard that connects, so the
MCP server gets everything for free and the hub needed no changes at all. It also means the
two consumers cannot drift: whatever the dashboard can show, the agent can read.

The alternative — a query API on the hub, or running the MCP server in-process — would put
the same data behind two code paths, and would force `crosspane mcp` and `crosspane` into
one process even though they have different lifetimes (the coding agent starts and stops the
MCP server; the developer starts and stops the hub).

## MCP is implemented directly, without the official SDK

`@modelcontextprotocol/sdk` is over 4 MB unpacked. What a tools-only stdio server needs from
it is five JSON-RPC methods — `initialize`, `ping`, `tools/list`, `tools/call`, and ignoring
notifications. `crosspane` is fetched with `npx`, so install size is felt directly on first
run, and the trade is a bad one at that ratio.

Writing the dispatch by hand also made it testable as a pure function: `handleRpcMessage`
takes a parsed message and a store and returns a response, so protocol behaviour (version
negotiation, notifications getting no reply, tool failures returning `isError` instead of a
protocol error) is covered by unit tests rather than by an integration harness.

The cost is that new MCP capabilities — resources, prompts, sampling — have to be written
rather than picked up from a dependency. That is acceptable while the server exposes tools
only; if it grows to need the fuller surface, revisit this.

## Tool output is text, not JSON

The consumer is a language model. Line-oriented text carries the same console and network
information in well under half the tokens of the equivalent JSON, and it is readable as-is
when the model quotes it back to the developer. Structure that JSON would provide — which
field is the status, which is the URL — is unambiguous from position and from the tool
description.

Two related choices follow from designing for a model rather than a program: session
selectors accept an id, a label, a label substring, or nothing at all when only one session
exists; and a failed lookup returns the list of candidates, so the model corrects itself on
the next call instead of asking the developer.

## The agent ships prebuilt single-file bundles

`tsc` output is multi-file ESM, which cannot be loaded with a plain `<script>` tag. The
users this project targets are frequently the ones who *cannot* run a bundler — injecting
through a proxy, kiosk images, static pages maintained by another team. `dist/crosspane-agent.esm.js`
and `dist/crosspane-agent.global.js` (built by esbuild, ES2019, ~3.4 KB gzipped) exist for
them, and a budget test fails if the bundle grows past 4 KB gzipped.

## Tests resolve workspace dependencies from source

Each package's vitest config aliases `@crosspane/protocol` (and `@crosspane/agent`) to the
source files rather than letting them resolve through `node_modules` to `dist`. CI runs
tests before the build, so resolving to build output makes the test run depend on artifacts
that may not exist — it broke a release once with `Failed to resolve import`. The same
reasoning as project references below, applied to the test runner.

## TypeScript project references

CI runs typecheck before build, so a workspace dependency's `dist` does not exist yet.
Path mapping to the dependency's source conflicts with `rootDir`, so the packages use
`composite` + `references` and build with `tsc -b`, which resolves the ordering itself.

## Screen recording lives in a separate package

`@crosspane/agent-replay` records the DOM with rrweb. It is not part of the core agent
because rrweb is tens of times larger than the core (~3.4 KB gzipped) — folding it in would
break the promise that makes the SDK adoptable in the first place. Teams that only need
console and network data must not pay for screen capture.

Two constraints follow from that split:

- The plugin emits through the core's `agent.emit` rather than opening its own transport.
  One connection, one session, one ordered timeline — and screen frames land in
  `.crosspane.json` exports for free.
- The protocol's `screen` event carries a `format` string (currently `'rrweb'`) instead of
  rrweb-shaped fields, so a different capture method can occupy the same slot without a
  protocol break.

The dashboard loads the player through a dynamic import. rrweb's player is hundreds of
kilobytes; sessions without a recording should not pay for it.

## Captures leave the device by clipboard, not only by download

Offline capture is the primary path on a locked build, so the capture has to be able to leave
the device — and the original single exit, a blob download, is the least reliable option
available. A webview honours `a[download].click()` only if the host app implements downloads;
in-app browsers generally block it; and JavaScript cannot detect the failure, so the tester
taps a button, nothing happens, and the bug goes unreported.

`copyCapture()` exists because it is the only route that needs no cooperation from the host
app. It also has to be written the unfashionable way: an in-house build served from
`http://<lan-ip>` is not a secure context, so `navigator.clipboard` and `navigator.share` are
`undefined` there — measured, not assumed. `execCommand('copy')` is therefore the main path in
the target environment rather than a legacy fallback, which is why the deprecated call stays.

It returns a boolean for the same reason the text limit leaves a marker in the string: an
export that fails silently teaches the tester to distrust the tool instead of reporting the
bug. Callers are expected to surface the result.

The native-bridge route (`postMessage` to RN / WKWebView / a JavascriptInterface) is more
reliable still, but it needs app code, so it is documented rather than built — `capture()`
already returns a plain JSON-serializable object, and the SDK guessing at which bridge a host
provides would be both fragile and larger.

## Attaching to Android WebView over CDP is not obviously worth building

It sits in the backlog, and it deserves the same scrutiny that removed the 0.6.x engine
mirroring. CDP attach requires `setWebContentsDebuggingEnabled(true)` — which is exactly the
condition under which `chrome://inspect` already gives the developer the real DevTools, with
breakpoints and DOM inspection that crosspane will never have. The environments this project
exists for are the ones where that flag is off or a protection layer kills the debugger, and
CDP attach cannot reach those by construction.

So the honest scope is narrow: a convenience wrapper around `adb forward` for developers who
already have the inspector available. That may still be worth it for a unified session list,
but it should be entered deliberately as a convenience feature, not as a capability — and not
before the in-page agent's own gaps are closed.

## Console serialization: native first, measured

The console hook serializes arguments on the page's own critical path, so the cost is the
adoption barrier. Every choice in `serialize.ts` came from measurement, and two of them are
counter-intuitive enough to be worth recording so they aren't re-litigated.

**A hand-written bounded serializer was tried and rejected.** The theory was sound: a manual
walk can stop the moment it reaches the text budget, whereas `JSON.stringify` with a budget
replacer prunes the *output* but keeps *traversing*. In practice the native C++
implementation won by 3× on everything typical (0.4µs vs 1.0µs on a small object, 18µs vs
54µs on a 100-item response) and only won on inputs that had to be truncated. Native is the
default; don't try to beat it.

**Trimming large arrays is where the real win is.** An array's `length` is O(1), so detecting
a large one is free, and serializing only the head collapses the cost: 497µs → 64µs for
10,000 items, 6,074µs → 24µs for 100,000. Logging an entire API response is a common habit,
so this is the case that actually shows up.

**Wide plain objects have a floor we cannot cross.** Logging an object with 50,000 keys costs
~7ms no matter what: `Object.keys` alone is 4.6ms, and `JSON.stringify` performs the same
enumeration internally. There is no O(1) key count for a plain object, so nothing can detect
the size cheaply either. This is documented rather than optimized.

Circular references get a second pass with a visited set instead of collapsing to
`String(value)`. The retry marks legitimately-shared sibling references as `[Circular]` too,
which is a real false positive — accepted because the alternative was `"[object Object]"` and
no content at all. `scripts/bench.mjs` reproduces all of these numbers.

## Replay caps what it renders, not what it holds

Live sessions cap the state itself — the batcher keeps at most 500 log entries and 800 network
rows, which at 4,000 events/second still leaves the dashboard at 60fps with no frame over
50ms. Capture files are different: someone sent you their whole session, so discarding events
at parse time would discard the thing you were sent.

So replay keeps every entry in memory and caps only the rendered slice. Rendering a
100,000-event capture without that cap produced 400,000 DOM nodes, a 170MB heap, and a 669ms
frozen frame on a single keystroke in the filter box; with it, 2,044 nodes and 17MB. Filter and
search run across the full set, so any hidden entry is still reachable — verified by searching
for an entry outside the rendered window and getting it back.

The hidden count is shown rather than silently applied, for the same reason truncated text says
`(truncated)` and coalesced duplicates say `×N`: a cap the user can't see is a cap that
misleads them about what happened.

## The hub's address is inferred, and the gate is the page's own origin

`serverUrl` was always optional, so the friction was never the line count — it was the
*contents* of that string. You had to find your LAN IP, paste a token that changes on every
hub restart, and remember to keep both out of a production build. Three chores, all of them
information the hub already had.

So the agent infers it: explicit `serverUrl` > build-time injected env > `http://localhost:7788`
when the page is on loopback > nothing. `crosspane --write-env` closes the loop by having the
hub write its own address into `.env.local`, because the side that knows the value should be
the side that records it. The variable name is picked per framework (`NEXT_PUBLIC_`, `VITE_`,
`PUBLIC_`, `REACT_APP_`) rather than shipping a plugin per framework — env files are something
Vite, Next, CRA and Astro all already read, and each plugin would be permanent maintenance for
the same result.

**The gate is where the page is, not whether an address exists.** `/agent` deliberately does not
validate Origin (a real device's origin is arbitrary), so "connect if you have an address" would
let any website inject fake sessions into a developer's local hub. Loopback-only auto-connect
also means a build that reaches real users cannot phone home. On a deployed host, an injected
address additionally requires per-device activation (`?__crosspane=on`), because CI is what puts
env values there and they can survive into production. A hand-written `serverUrl` is exempt —
inconsistent on purpose, since silently disconnecting existing 0.9.x users is a worse failure
than the asymmetry.

The activation link carries `on` and nothing else. An earlier sketch had it carry the hub URL,
which would have made `?__crosspane=https://attacker.example` a one-link log exfiltration
channel: destinations come from the build, never from the URL.

Three things here were found by running a real browser, not by reasoning:

- A `typeof process !== 'undefined'` guard in front of the injected literal broke exactly the
  case it was meant to protect — bundlers replace the *literal* while leaving no `process`
  object in the browser, so the guard skipped a value that had been injected successfully.
  Reaching around the access (`globalThis.process`) suppresses the replacement instead.
- jsdom reports `location.hostname === 'localhost'` and implements `WebSocket`, so without a
  guard every unit test in an app that calls `initCrosspane()` would open connections to a hub.
- `import.meta` collapses to `{}` in the standalone esbuild bundle (target es2019). It survives
  in the tsc output, which is what npm consumers actually resolve, so Vite can still replace it.

The bundle budget went 4 → 4.5 KB gzip for this. The measurement: esm 3.85 KB (still under 4),
iife 4.04 KB, and the 41 bytes over the line were two of the four env variable names. Trading
CRA/Astro/SvelteKit support for 41 bytes is the wrong trade, and 4 was a rounded number rather
than a measured limit.

## What the agent deliberately cannot do

- **Breakpoints.** JavaScript cannot pause itself; this is why weinre and its successors
  never offered stepping. When a real inspector is available, use it.
- **Anything before `initCrosspane` runs.** Boot failures and parse errors are invisible.
- **Loading under a strict CSP that blocks the hub.** Bundling rather than CDN-loading
  avoids the `script-src` half of this; `connect-src` still has to allow live mode.
- **Live mode from an `https://` page.** Measured: a secure page opening
  `ws://127.0.0.1:7899` is blocked outright — the local ws server never sees a connection.
  A hub on a laptop has no certificate, and asking every device to trust a local CA is the
  exact friction this project exists to remove. Offline capture is the answer there, and it
  needs no network at all.

These are stated in the README rather than worked around, because pretending otherwise
would cost users more than the missing feature does.
