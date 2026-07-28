# crosspane

<p>
  <a href="https://www.npmjs.com/package/crosspane"><img alt="npm version" src="https://img.shields.io/npm/v/crosspane.svg?color=cb3837"></a>
  <a href="https://github.com/yunwoo-yu/crosspane/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/yunwoo-yu/crosspane/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/yunwoo-yu/crosspane/blob/main/LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <img alt="node 20+" src="https://img.shields.io/node/v/crosspane.svg">
</p>

**One dashboard to QA your webview app across real engines and real devices.**

Point crosspane at your local dev server and see the same URL rendered side by side in
**Chromium, WebKit, Firefox — plus a real Android emulator and a real iOS Simulator** —
with mirrored clicks/scrolls/typing (Korean/Japanese IME included), per-engine console
and network logs, pixel diffing, and one-file bug reports.

Built for teams shipping webview-based apps (React Native WebView, in-app browsers,
hybrid apps) who need to catch production-environment bugs *before* deploying.

> **⚠️ Beta** — crosspane is under active development. APIs, CLI flags and behavior may
> change between minor versions until 1.0. Bug reports and feedback are very welcome —
> please [open an issue](https://github.com/yunwoo-yu/crosspane/issues).

![crosspane dashboard — Chromium/WebKit/Firefox + real Android emulator + real iOS Simulator](https://raw.githubusercontent.com/yunwoo-yu/crosspane/main/docs/dashboard-full.png)

## Quick start

```bash
# terminal 1 — your app
pnpm dev                 # e.g. localhost:3000

# terminal 2 — no install needed
npx crosspane            # interactive: pick your running dev server
npx crosspane :3000      # or pass everything directly
# → open http://localhost:7788
```

Missing engine binaries are installed automatically on first start (one-time,
tens of MB). Manual fallback: `npx playwright install chromium webkit firefox`.

Real-device panes are auto-detected: with **Xcode** installed you get an iOS Simulator
pane, with the **Android SDK** you get an Android emulator pane — no extra flags.

## Why crosspane?

Responsive-mode tools resize a single Chromium viewport. Your users don't run Chromium
with a narrow window — they run **WKWebView** and **Android WebView**, which differ in
engine behavior, UA strings, service worker availability and input handling. crosspane
renders your page in the actual engines (and the actual OS webview components on
simulator/emulator), so "works on my machine, broken in the app" bugs show up on your
desk instead of in production.

## Features

### Real engines, production-accurate environment
- **3 real engines** — actual Chromium / WebKit / Firefox render your page, not viewport spoofing
- **Webview emulation by default** — Chromium runs with a real Android WebView UA
  (`; wv)` token), WebKit with a real WKWebView UA (no Safari token) and service workers
  blocked, matching WKWebView's App-Bound Domains behavior. UA-sniffing code takes the
  same path as production. Use `--user-agent` for your app's exact UA, `--preset-ua` to opt out
- **Bridge mocking** — `--inject ./bridge-mock.js` runs before page load: mock
  `window.ReactNativeWebView`, `window.AppBridge`, etc.
- **Device presets** — any [Playwright device descriptor](https://playwright.dev/docs/emulation#devices)
  (`--device "iPhone 15"`, `"Pixel 7"`, …)

### Real devices, not approximations
- **iOS Simulator pane** — crosspane compiles a tiny **WKWebView shell app** into the
  simulator: not Safari, the actual webview *component* your hybrid app ships.
  Component-level behavior (e.g. `navigator.serviceWorker === undefined`) reproduces
  exactly. Clicks/scroll/typing are mirrored; console/errors are relayed to the dashboard.
  Falls back to Safari (view-only) if the shell can't build
- **Android emulator pane** — a real headless emulator running your page in a real
  **Android WebView shell app** (Chrome fallback), fully interactive via adb/gRPC.
  A USB-connected Android phone works with the same code
- **Korean/CJK input on Android** — bundled headless IME commits non-ASCII text that
  `adb input text` can't handle
- **High-fps iOS streaming** — ScreenCaptureKit window capture (~30fps, artifact-free)
  after a one-time Screen Recording permission; degrades to clean snapshots without it
- **Self-healing streams** — if the shell app crashes or the capture stream dies
  mid-session, crosspane detects it, relaunches, and keeps the pane alive

### A dashboard built for QA loops
- **Mirrored interaction** — input on any pane replays on every engine; scroll/drag stay
  pane-independent (per-engine scroll physics), clicks/keys/navigation mirror everywhere
- **Local scroll echo** — panes respond to your wheel at 60fps feel while frames stream in
- **Per-engine console & network** — `console.*`, uncaught errors with stacks, failed
  requests, HTTP 4xx/5xx, response timing/headers/body preview — filterable per engine
- **Pixel diff** — the Diff tab overlays two engines' frames and highlights every
  differing pixel
- **One-file bug report** — ⤓ downloads a single self-contained HTML with per-engine
  screenshots, console errors and failed requests
- **Login session persistence** — cookies/storage per engine survive restarts
  (`~/.crosspane/state/<origin>/`); start clean with `--fresh`
- **Runtime pane control** — toggle panes from the toolbar, boot heavy device panes on
  demand, focus one pane (Esc to exit), navigate all engines from the URL bar, one-click
  re-sync when an engine's URL drifts
- **HMR friendly** — engines are real browsers pointed at your dev server; hot reload just works
- **Idle-zero** — no traffic and no capture work when nothing changes and nobody watches

## CLI

```
crosspane <url | :port> [options]

--profile <name>     webview (default) | web | device | full
                       webview: Chromium+WebKit — in-app webview engines, fast loop
                       web:     +Firefox — mobile web cross-browsing
                       device:  webview + real Android emulator / iOS Simulator
                       full:    everything
--engines <list>     engines to auto-start (chromium,webkit,firefox) — the rest stay
                     available as stopped panes in the dashboard
--device <name>      Playwright device preset (default: "iPhone 15")
--port <n>           dashboard port (default: 7788; the default port falls back +1
                     when taken, an explicit port does not)
--host <addr>        bind address (default: 127.0.0.1 — local only; 0.0.0.0 to
                     expose on your network, e.g. for phone testing)
--no-open            don't open the dashboard automatically
--inject <path>      JS injected into every page before load
--user-agent <ua>    exact UA for every engine
--preset-ua          use Playwright preset UA instead of webview UA emulation
--fresh              ignore saved login sessions
--ios-runtime <ver>  iOS Simulator runtime version (e.g. 17.2)
--ios-sim            force the iOS Simulator pane (auto when Xcode exists)
--no-ios-sim         disable the iOS Simulator pane
--android            force the Android pane (auto when the Android SDK exists)
--no-android         disable the Android pane
-v, --version        print the crosspane version
-h, --help           show help
```

## How it works

```
CLI (Node)
 ├─ Playwright: one browser context per engine (device preset + init scripts)
 ├─ Real-device adapters: simctl + WKWebView shell (iOS) / adb + WebView shell (Android)
 ├─ HTTP server: dashboard (React) on :7788 + shell-app control bridge
 └─ WebSocket:
     server → client   binary frame packets ([type][engine][flags][scrollY][JPEG]) + JSON events
     client → server   normalized input commands → mirrored to every engine
```

Frame streaming is tuned per source:

- **Chromium** — CDP screencast: frames are pushed only when the screen changes.
  Idle traffic is zero; interactions render at native frame rates
- **WebKit / Firefox** — adaptive screenshot polling with full-page capture during
  scrolling, so the dashboard pans locally at 60fps
- **iOS Simulator** — ScreenCaptureKit window capture (30fps) with shell-snapshot fallback
- **Android** — scrcpy/screenrecord H.264 stream decoded by WebCodecs in the dashboard

Frames are captured at CSS-pixel scale and drawn straight to a `<canvas>` per pane —
never through React state.

## Platform support

| Pane | macOS | Windows | Linux |
|---|---|---|---|
| Chromium / WebKit / Firefox | ✅ | ✅ | ✅ |
| Android emulator / USB device | ✅ | ✅ | ✅ |
| iOS Simulator | ✅ (Xcode) | — (Apple limitation) | — (Apple limitation) |

Playwright ships WebKit builds for all three OSes, so iOS-approximate testing works even
on Windows/Linux. Missing SDKs degrade gracefully — the pane is skipped with a notice and
everything else still works. CI runs lint + tests + build on all three OSes, plus an
end-to-end smoke (real server + Chromium) on Linux.

## Troubleshooting

- **iOS pane is low-fps** → allow *Screen Recording* for your terminal
  (System Settings → Privacy & Security), then it auto-upgrades within seconds —
  no restart needed
- **Browser missing** → `npx playwright install chromium webkit firefox`
- **Android pane skipped or erroring** → the SDK needs the emulator + a system image +
  an AVD, not just command-line tools. Follow the
  [Android setup guide](https://github.com/yunwoo-yu/crosspane/blob/main/docs/android-setup.md)
  (5 commands from scratch, error → fix table included)
- **iOS pane is view-only** → the WKWebView shell failed to build; the console shows why
  (usually a missing full Xcode — Command Line Tools alone are not enough)

## Roadmap to 1.0

- [ ] `crosspane.config.ts` — device matrix, bridge-mock presets, profiles
- [ ] Windows support for the Android shell-app build (currently falls back to Chrome)
- [ ] USB iOS devices
- [ ] Scenario replay — record an interaction once, replay across engines on demand

## Development

```bash
pnpm install
pnpm --filter crosspane exec playwright install chromium webkit firefox
pnpm test             # unit + integration (no browsers needed)
pnpm build            # dashboard (vite) → cli (tsc + bundle)
pnpm smoke            # end-to-end: real server + Chromium
```

See [ARCHITECTURE.md](https://github.com/yunwoo-yu/crosspane/blob/main/ARCHITECTURE.md)
for the full design rationale and [CONTRIBUTING.md](https://github.com/yunwoo-yu/crosspane/blob/main/CONTRIBUTING.md)
for contribution guidelines.

## License

[MIT](https://github.com/yunwoo-yu/crosspane/blob/main/LICENSE)
