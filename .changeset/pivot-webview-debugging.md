---
"crosspane": minor
"@crosspane/agent": minor
"@crosspane/protocol": minor
---

**crosspane is now a webview debugging toolkit.**

The multi-engine preview (Playwright + iOS Simulator + Android emulator mirroring) is gone.
It could never reach the environments this project actually cares about: production in-app
webviews, in-app browsers, and security-hardened builds where remote inspectors are blocked
outright. That version is preserved at the `crosspane@0.6.2` tag.

What replaces it:

- **`@crosspane/agent`** — a dependency-free SDK you embed in dev/QA builds. Hooks console,
  uncaught errors, unhandled rejections, fetch/XHR and navigations into a crash-resistant ring
  buffer. Stream live to the hub over your LAN, or export a `.crosspane.json` capture file when
  the network isn't an option (ISMS-P / MDM locked devices).
- **`crosspane`** — the hub CLI is now a session relay: receives live agents on `/agent`, serves
  the dashboard, replays history to late-joining dashboards. No browser dependencies, so
  installs are megabytes instead of hundreds.
- **Dashboard** — session list (multiple devices at once, live/ended, error badges), console and
  network panels, and drag-and-drop replay of capture files through the exact same UI.
- **`@crosspane/protocol`** — shared wire types, published so integrations can build on them.
