# crosspane

## 0.3.0

### Minor Changes

- 2fe7ec2: Two debugging-depth upgrades: (1) network rows now expand on click to show
  per-engine response headers and body previews side by side (API requests only,
  size-capped) — see exactly what the 401 body said on WebKit vs the 200 on
  Chromium. (2) `--ios-runtime 17.2` picks a specific installed iOS Simulator
  runtime, reproducing old-iOS-only bugs that the latest WebKit can't show.
- 9b0cbd3: Network panel: every response is collected per engine and grouped by request
  (method+URL) into a comparison table — status and duration side by side across
  engines, with automatic highlighting when engines disagree (e.g. WebKit-only 401).
  Filters for XHR/fetch-only, errors-only and URL search. This directly answers
  "it works on Android but breaks on iOS" debugging: the differing request is
  highlighted the moment it happens.
- 7dfe113: Runtime pane control from the dashboard: every available engine (all three browser
  engines + detected real devices) is always shown as a pane — profiles now only decide
  which ones auto-start. Stopped panes show a ▶ Start button (boot the Android emulator
  or iOS Simulator on demand), running panes can be stopped with ■ to free resources.
  Also adds a focus mode (⤡ to enlarge one pane, Esc to exit) and a URL bar that
  navigates every engine at once.
- 37d8f68: Real WKWebView shell for the iOS Simulator pane: crosspane now compiles and installs
  a tiny native shell app that hosts the actual WKWebView _component_ (not Safari), so
  component-level production behavior — like `navigator.serviceWorker` being undefined
  and killing a script — reproduces exactly. The pane becomes interactive (click/scroll/
  type mirrored via a localhost control bridge) with console, errors and navigation
  relayed into the dashboard. Falls back to Safari view-only if the shell can't build.
  Also: `--ios-runtime <ver>` to pick an installed iOS Simulator runtime.

### Patch Changes

- c037662: Dashboard UI foundation: Tailwind v4 + shadcn-style components (Button/Badge/Input
  with cva variants) replace hand-rolled control styles, keeping the same dark look on
  the existing palette (now promoted to Tailwind theme tokens). Also fixes monorepo
  dev serving a stale bundled dashboard instead of the freshly built one.

## 0.2.0

### Minor Changes

- 0d13067: Login session persistence: each engine's cookies and storage (`storageState`) are
  saved to `~/.crosspane/state/<origin>/<engine>.json` on shutdown and restored on
  the next run — no more re-logging into your app in every engine every time.
  Use `--fresh` to start with a clean session.
