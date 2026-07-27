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
- **Mirrored interaction**: click/scroll on any pane replays on every engine
- **Per-engine console**: `console.*`, uncaught errors (with stack), failed network requests — filterable by engine
- **HMR friendly**: engines are real browsers pointed at your dev server, so hot reload just works
- **Device presets**: any [Playwright device descriptor](https://playwright.dev/docs/emulation#devices) (`--device "iPhone 15"`, `"Pixel 7"`, …)
- **Bridge mocking**: `--inject ./bridge-mock.js` injects a script before page load — mock your app's `window.AppBridge` etc.

## CLI

```
crosspane <url | :port> [options]

--engines <list>   chromium,webkit,firefox (default: all)
--device <name>    Playwright device preset (default: "iPhone 15")
--port <n>         dashboard port (default: 7788)
--fps <n>          capture frame rate (default: 4)
--inject <path>    JS injected into every page before load
```

## How it works

```
CLI (Node)
 ├─ Playwright: one browser context per engine (device preset + init scripts)
 ├─ HTTP server: serves the dashboard (React) on :7788
 └─ WebSocket:
     server → client   JPEG frames (polling), console/pageerror/requestfailed events
     client → server   normalized click coords, scroll deltas → replayed via Playwright on all engines
```

Frame capture uses `page.screenshot()` polling (default 4 fps) because WebKit/Firefox expose no screencast API. Good enough for visual verification; not meant for watching animations.

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
