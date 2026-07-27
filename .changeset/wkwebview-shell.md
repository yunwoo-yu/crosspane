---
"crosspane": minor
---

Real WKWebView shell for the iOS Simulator pane: crosspane now compiles and installs
a tiny native shell app that hosts the actual WKWebView *component* (not Safari), so
component-level production behavior — like `navigator.serviceWorker` being undefined
and killing a script — reproduces exactly. The pane becomes interactive (click/scroll/
type mirrored via a localhost control bridge) with console, errors and navigation
relayed into the dashboard. Falls back to Safari view-only if the shell can't build.
Also: `--ios-runtime <ver>` to pick an installed iOS Simulator runtime.
