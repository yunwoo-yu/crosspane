---
"@crosspane/agent": patch
---

Guard against double initialization: calling `initCrosspane` twice now returns the existing agent instead of installing a second layer of hooks. Double-hooking produced duplicate events and left `console`/`fetch` permanently wrapped, since `dispose()` only unwound one layer — a real hazard with hot reloads and duplicated bundles. Console and error text is also capped (`maxTextLength`, default 10000 chars) so a page logging huge objects can't crowd out the ring buffer or the wire; truncated entries say so rather than silently losing data.
