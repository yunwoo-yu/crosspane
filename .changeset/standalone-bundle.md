---
"@crosspane/agent": minor
---

Ship prebuilt single-file bundles so the agent can be used without a bundler — injecting through a proxy, kiosk builds, plain static pages. `dist/crosspane-agent.esm.js` for `<script type="module">` and `dist/crosspane-agent.global.js` (exposes `window.crosspane`) for a classic script tag. Both are ~2.5 KB gzipped and target ES2019, so older Android WebViews are covered. A bundle-size budget test guards against regressions.
