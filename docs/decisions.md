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

## Three packages, not one

- `@crosspane/agent` — the in-page SDK
- `crosspane` — the hub CLI and dashboard
- `@crosspane/protocol` — shared wire types

Folding `protocol` into the others was considered and rejected: it would require a
`.d.ts` bundler to keep the agent's public types self-contained, and the only gain is
removing a 4 KB types-only package. The current shape matches how comparable SDKs are
distributed (for example `@sentry/browser` depending on `@sentry/core`).

The event shape is identical from the agent, through the hub, to the dashboard and into
exported capture files. There is no translation layer, which is what lets live sessions
and file replay share the same UI code.

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

## What the agent deliberately cannot do

- **Breakpoints.** JavaScript cannot pause itself; this is why weinre and its successors
  never offered stepping. When a real inspector is available, use it.
- **Anything before `initCrosspane` runs.** Boot failures and parse errors are invisible.
- **Loading under a strict CSP that blocks the hub.** Bundling rather than CDN-loading
  avoids the `script-src` half of this; `connect-src` still has to allow live mode.

These are stated in the README rather than worked around, because pretending otherwise
would cost users more than the missing feature does.
