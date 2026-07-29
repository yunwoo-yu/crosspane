---
'@crosspane/agent': patch
---

Cut the cost of logging large payloads, and stop losing content on circular references.

Console serialization runs on the page's own critical path, so it was measured in a real
browser rather than reasoned about. Two findings:

- **Large arrays were the real cost.** Logging a 10,000-item API response cost 497µs; a
  100,000-element array cost 6ms — a third of a frame, spent by the debugging tool. An array's
  `length` is O(1), so serializing only the head is free to detect: now 64µs and 24µs
  respectively (8× and 250×). The omitted count is reported in the output.
- **Circular references discarded the whole object.** `JSON.stringify` throws on them, and the
  fallback was `String(value)` — `"[object Object]"`, no content at all. Now a second pass with
  a visited set marks just the circular edge, so the rest of the object survives.

Typical logs are unchanged (~1.1µs). Deliberately *not* changed: a plain object with 50,000
keys still costs ~7ms, because `Object.keys` alone is 4.6ms and `JSON.stringify` performs the
same enumeration internally — there is no implementation that avoids it. A hand-written
bounded serializer was tried and reverted: it was 3× slower on everything typical. Both
findings are recorded in `docs/decisions.md`, and `packages/agent/scripts/bench.mjs`
reproduces the numbers.
