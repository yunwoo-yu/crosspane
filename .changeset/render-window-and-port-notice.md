---
'crosspane': patch
---

Two fixes for things that were confusing or slow in practice.

**Replay no longer renders an entire capture file at once.** A 100,000-event capture produced
400,000 DOM nodes, a 170MB heap, and a 669ms frozen frame on one keystroke in the filter box.
Every entry is still kept in memory — filter and search reach any of them — but only the most
recent 500 log rows and 800 network rows are rendered, and the number hidden is shown so the
view doesn't quietly look complete. Capture parsing now also coalesces consecutive duplicate
log entries and caps screen-recording events at a replayable checkpoint, matching live behaviour.

**A port fallback is now stated loudly.** Starting the hub while port 7788 is taken silently
moves it to 7789, but your app's `serverUrl` still points at 7788 — so sessions go to the other
hub (or nowhere) and the dashboard sits empty with no hint why. This is now printed as a warning
naming both ports.
