---
"crosspane": minor
---

Two debugging-depth upgrades: (1) network rows now expand on click to show
per-engine response headers and body previews side by side (API requests only,
size-capped) — see exactly what the 401 body said on WebKit vs the 200 on
Chromium. (2) `--ios-runtime 17.2` picks a specific installed iOS Simulator
runtime, reproducing old-iOS-only bugs that the latest WebKit can't show.
