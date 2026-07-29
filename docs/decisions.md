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

## The agent ships prebuilt single-file bundles

`tsc` output is multi-file ESM, which cannot be loaded with a plain `<script>` tag. The
users this project targets are frequently the ones who *cannot* run a bundler — injecting
through a proxy, kiosk images, static pages maintained by another team. `dist/crosspane-agent.esm.js`
and `dist/crosspane-agent.global.js` (built by esbuild, ES2019, ~2.5 KB gzipped) exist for
them, and a budget test fails if the bundle grows past 4 KB gzipped.

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
