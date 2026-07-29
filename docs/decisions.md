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
the core agent (57 KB vs 2.5 KB gzipped), and many users never want screen capture. Code
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
and `dist/crosspane-agent.global.js` (built by esbuild, ES2019, ~2.5 KB gzipped) exist for
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
because rrweb is tens of times larger than the core (~2.5 KB gzipped) — folding it in would
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

## What the agent deliberately cannot do

- **Breakpoints.** JavaScript cannot pause itself; this is why weinre and its successors
  never offered stepping. When a real inspector is available, use it.
- **Anything before `initCrosspane` runs.** Boot failures and parse errors are invisible.
- **Loading under a strict CSP that blocks the hub.** Bundling rather than CDN-loading
  avoids the `script-src` half of this; `connect-src` still has to allow live mode.

These are stated in the README rather than worked around, because pretending otherwise
would cost users more than the missing feature does.
