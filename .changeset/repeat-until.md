---
'@crosspane/protocol': minor
'@crosspane/agent': minor
---

Record when a repeated error stopped, not just when it started.

Coalescing consecutive duplicates keeps the first occurrence's timestamp so the timeline
position stays put — but that alone loses something important. An error repeating every five
seconds for ten minutes collapsed to a single line stamped `10:00:00 ×120`, which reads as
"it happened a few times at the start and stopped". Whether it is *still* happening is often
the most useful fact in the log.

`console` and `pageerror` events now carry an optional `repeatUntil` (the last occurrence), and
the dashboard shows the span next to the count — `×120 10m` — so an ongoing failure can't be
mistaken for a burst. Bursts shorter than a second show no span, since a duration adds nothing
there.
