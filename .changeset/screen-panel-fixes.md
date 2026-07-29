---
"crosspane": patch
---

Fix screen replay in the dashboard: the player's stylesheet was never loaded, so controls stacked unstyled and the replay area had no size, and the player was created with an unmeasured width that pushed the recording outside the panel. It now loads the stylesheet alongside the player and sizes itself from a measured container (via `ResizeObserver`), so replays render correctly and follow panel resizes.

Screen events are also batched now instead of triggering a state update per event. rrweb emits one event per DOM mutation, so the previous per-event `setState` copied the whole buffer and re-rendered hundreds of times a second once recording started. They share the existing batching path with logs and network, and are capped per session — trimming only ever happens at a replayable checkpoint, because cutting mid-stream would drop the full snapshot and make the recording unplayable.
