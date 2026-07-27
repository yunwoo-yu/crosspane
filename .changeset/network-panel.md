---
"crosspane": minor
---

Network panel: every response is collected per engine and grouped by request
(method+URL) into a comparison table — status and duration side by side across
engines, with automatic highlighting when engines disagree (e.g. WebKit-only 401).
Filters for XHR/fetch-only, errors-only and URL search. This directly answers
"it works on Android but breaks on iOS" debugging: the differing request is
highlighted the moment it happens.
