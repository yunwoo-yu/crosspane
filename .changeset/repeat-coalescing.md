---
'@crosspane/protocol': minor
'@crosspane/agent': minor
---

Collapse consecutive duplicate console events into one with a `repeat` count.

A broken webview emits the same error thousands of times per second, and that one line used
to consume every buffer in the system. Measured before this change: after 3,000 identical
messages, the hub's 2,000-event history held **one distinct message** and the error that
started the cascade was gone — which makes the capture file, the primary path on a
security-locked build, useless exactly when it matters.

Coalescing happens in the agent's ring buffer (so exported captures stay useful) and in the
live transport's pending queue (so the hub's history and any late-joining dashboard see it
too, and the connection carries less). Only console and page errors coalesce — network and
navigation events stay separate, because requesting the same URL twice is not the same fact
as requesting it once. The first occurrence's timestamp is kept so timeline position doesn't
drift, and the count is shown rather than hidden.

`SessionEvent` gains an optional `repeat` field on `console` and `pageerror` (absent means 1),
which is backward compatible — older dashboards ignore it, and the capture file version is
unchanged.
