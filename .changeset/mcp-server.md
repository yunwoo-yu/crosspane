---
'crosspane': minor
---

Add `crosspane mcp` — an MCP stdio server that exposes the hub's live sessions to coding
agents, so you can ask "why did the payment webview fail?" instead of reading the dashboard
and copying logs out by hand.

Five tools: `list_sessions`, `get_errors` (exceptions, console errors and failed requests in
one call), `get_console`, `get_network`, and `get_timeline`. Sessions can be named by id, by
label, or by part of a label, and omitted entirely when only one device is attached.

It attaches to the running hub as an ordinary dashboard client over `/ws`, so it receives the
full session history on connect and the hub needed no changes. No new dependencies — the
JSON-RPC layer is implemented directly rather than pulling in a 4 MB SDK for five methods.
