---
"@crosspane/agent": patch
"crosspane": patch
---

The agent no longer serializes an entire object before deciding to truncate it. `JSON.stringify` used to run to completion and the result was then cut, so a page logging a large object paid the full cost of building a string that was mostly discarded — instrumentation should not slow down the page it observes. Serialization now stops expanding once it exceeds the text budget, and truncation is reported explicitly rather than silently dropping data.

The dashboard's screen panel also survives environments without `ResizeObserver` instead of throwing on mount; it falls back to a single measurement and gives up resize tracking.
