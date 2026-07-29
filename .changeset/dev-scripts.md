---
'crosspane': patch
---

Add named scripts for running things by hand. `node packages/cli/dist/index.js` in one terminal
and `node examples/demo/serve.mjs` in another is not memorable, and forgetting the second one
leaves the dashboard looking empty with no explanation.

```bash
pnpm try        # hub + demo page together, prints what to open
pnpm try:lan    # same, reachable from a phone on your Wi-Fi
pnpm hub
pnpm demo
pnpm mcp
```

Two related fixes: the demo server now reports a port collision in one line instead of throwing
a Node stack trace, and the demo page takes the hub's port from the server rather than
hard-coding 7788 — so `CROSSPANE_PORT=7801 PORT=7802 pnpm try` connects instead of silently
failing to.
