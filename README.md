# crosspane

Preview one URL across **Chromium, WebKit and Firefox** — side by side, in a single dashboard.

Point it at your local dev server (`pnpm dev`) and see how your webview screens render on every engine at once, with mirrored clicks/scrolls and per-engine console logs. WebKit gives you a close approximation of iOS Safari / WKWebView without touching a device.

```
┌─────────────────────────────────────────────────────┐
│ crosspane   http://localhost:3000   iPhone 15  ⟳    │
├───────────────┬────────────────┬────────────────────┤
│  Chromium     │  WebKit        │  Firefox           │
│  (Android WV) │  (iOS WKWV)    │  (Gecko)           │
│   [screen]    │   [screen]     │   [screen]         │
├───────────────┴────────────────┴────────────────────┤
│ console  [all|chromium|webkit|firefox]              │
│ WEBKIT  error  TypeError: x.flatMap is not a func…  │
└─────────────────────────────────────────────────────┘
```

## Quick start

```bash
pnpm install
pnpm exec playwright install chromium webkit firefox   # engine binaries (once)
pnpm build

# terminal 1 — your app
pnpm dev            # e.g. localhost:3000

# terminal 2
node packages/cli/dist/index.js :3000
# → open http://localhost:7788
```

## Features

- **3 real engines**: not viewport spoofing — actual Chromium/WebKit/Firefox render your page
- **Webview environment emulation (default)**: Chromium runs with a real Android WebView
  UA (`; wv)` token), WebKit runs with a real WKWebView UA (no Safari token) and service
  worker registration blocked — so UA-sniffing app code behaves like production. Pass your
  app's exact UA with `--user-agent`, or opt out with `--preset-ua`
- **Real-device panes (auto-detected)**: with Xcode installed, a REAL iOS Simulator pane
  (Apple's actual iOS WebKit build, real iOS fonts/status bar) is added automatically
  (view-only; follows navigate/reload/sync). With the Android SDK installed, a REAL
  Android emulator pane running actual Android Chrome is added — fully interactive via
  adb (tap/swipe/type/back are mirrored). A USB-connected Android phone works too.
- **Mirrored interaction**: click/scroll on any pane replays on every engine
- **Per-engine console**: `console.*`, uncaught errors (with stack), failed network requests — filterable by engine
- **HMR friendly**: engines are real browsers pointed at your dev server, so hot reload just works
- **Device presets**: any [Playwright device descriptor](https://playwright.dev/docs/emulation#devices) (`--device "iPhone 15"`, `"Pixel 7"`, …)
- **Bridge mocking**: `--inject ./bridge-mock.js` injects a script before page load — mock your app's `window.AppBridge` etc.

## CLI

```
crosspane <url | :port> [options]

--profile <name>     webview (default) | web | device | full
                       webview: Chromium+WebKit — in-app webview engines, fast loop
                       web:     +Firefox — mobile web cross-browsing
                       device:  webview + REAL Android emulator / iOS Simulator
                       full:    everything
--engines <list>     override engine list (chromium,webkit,firefox)
--device <name>      Playwright device preset (default: "iPhone 15")
--port <n>           dashboard port (default: 7788)
--inject <path>      JS injected into every page before load
--user-agent <ua>    exact UA for every engine (reproduce your app's webview UA)
--preset-ua          use Playwright preset UA instead of webview UA emulation
--ios-sim            force the real iOS Simulator pane (auto when Xcode exists)
--no-ios-sim         disable the iOS Simulator pane
--android            force the real Android pane (auto when the Android SDK exists)
--no-android         disable the Android pane
```

## How it works

```
CLI (Node)
 ├─ Playwright: one browser context per engine (device preset + init scripts)
 ├─ HTTP server: serves the dashboard (React) on :7788
 └─ WebSocket:
     server → client   binary frame packets ([engine byte][JPEG]) + JSON events
     client → server   normalized click coords, coalesced scroll deltas → mirrored to all engines
```

Frame streaming is per-engine:

- **Chromium** — CDP screencast: the browser pushes a frame only when the screen
  changes, so idle traffic is zero and interactions render at native frame rates
- **WebKit / Firefox** — no screencast API, so adaptive `page.screenshot()` polling:
  slow while idle, fast for 2s after any input, and unchanged frames are never sent

Frames are captured at CSS-pixel scale (not device scale — an iPhone 15 preset is
DPR 3, which would be 9× the pixels) and drawn straight to a `<canvas>` per pane,
bypassing React state entirely.

## Known limits

- Playwright WebKit ≈ iOS WKWebView, but not pixel-identical (font rendering, some CSS quirks)
- Firefox ignores mobile emulation (`isMobile`) — viewport is applied, touch is not
- Text input mirroring is minimal (`keypress` only) — full IME/typing support is on the roadmap

## Roadmap

- [ ] Screenshot diff between engines (pixelmatch) with mismatch highlighting
- [ ] `crosspane.config.ts` — device matrix, bridge mock presets, safe-area overlays
- [ ] Full keyboard/text input mirroring
- [ ] npm publish (`npx crosspane :3000`) with bundled dashboard

## Development

```bash
pnpm install
pnpm typecheck        # both packages
pnpm build            # cli (tsc) + dashboard (vite)

# dashboard dev with HMR (proxies /ws to the CLI on :7788)
node packages/cli/dist/index.js :3000   # terminal 1
pnpm --filter crosspane-dashboard dev   # terminal 2
```

## License

MIT
