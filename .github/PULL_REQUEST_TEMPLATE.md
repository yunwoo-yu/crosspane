<!-- Thanks for contributing! A short description of what & why is enough. -->

## What

## Checklist

- [ ] `biome check --write .` / `pnpm test` / `pnpm build` pass locally
- [ ] `pnpm smoke` passes (needed when behavior changes)
- [ ] Added a changeset (`pnpm changeset`) if this affects users

## If this touches `@crosspane/agent`

<!-- Delete this section if not applicable — otherwise it's the review checklist -->

- [ ] No new dependencies
- [ ] Hooks call the original first and return its result unchanged
- [ ] New hooks return a teardown function, and `dispose()` restores the original
- [ ] `enabled: false` still installs nothing
- [ ] Verified in a real webview (say which one below) — jsdom can't catch everything

Verified on: <!-- e.g. "Android WebView 130 via RN 0.76, iOS 18.2 WKWebView" -->
