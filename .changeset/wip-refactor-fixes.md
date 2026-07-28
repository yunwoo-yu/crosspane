---
"crosspane": patch
---

Fix fixed/sticky chrome misplacement while dragging in WebKit panes (viewport-mode demotion via pinnedChrome edge probing). Internal refactors: socket hook split into event-log/frame-router/useEventBatcher/useFrameHub, App derived state extracted to session-view, unified shell event parser, expanded test coverage (209 tests).
