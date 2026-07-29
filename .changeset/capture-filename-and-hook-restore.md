---
'@crosspane/agent': patch
'crosspane': patch
---

Two fixes found by adding coverage to previously untested paths.

**Navigation hook now restores the true original.** `hookNavigation` stored
`history.pushState.bind(history)` as the "original" and restored that on `dispose()`, so every
init → dispose cycle left another `bind` layer wrapped around `history.pushState` and the real
original was never recovered. This is the permanent-pollution failure mode the SDK is supposed
to prevent, and it triggers in HMR and in any app that toggles the agent.

**Capture filenames keep non-ASCII labels.** The label was sanitized with `[^\w-]+`, which
does not match Korean (or any non-Latin script) — a label like `결제 웹뷰` collapsed to a
single `_`, making the filename useless for exactly the teams this tool targets. Labels now
keep letters and digits from any script. The hub's `GET /capture/:id` sends the name as RFC
6266 (`filename*=UTF-8''…` plus an ASCII fallback), because Node rejects non-ASCII header
values and would otherwise throw while writing the response.
