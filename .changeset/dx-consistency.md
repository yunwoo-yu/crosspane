---
'crosspane': patch
---

Consistency fixes in the dev scripts and docs.

`pnpm try` printed its guidance in Korean while the rest of the project's user-facing output is
English; it now matches. It also passed `--port` unconditionally, which disabled the hub's
port fallback — so `pnpm hub` moved out of the way when 7788 was taken while `pnpm try` died.
Now the fallback applies to both, the banner waits for the hub to report its real address
instead of guessing, and the demo server starts only after that port is known so the page's
`serverUrl` can't point at a hub that moved.

`ARCHITECTURE.md` had drifted — it described neither the MCP server, the access token, repeat
coalescing, the render cap, nor the capture escape hatches. The bundle-size figure was stated
three different ways across README files and the decision log; all now read the measured value.
