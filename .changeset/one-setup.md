---
'crosspane': patch
'@crosspane/agent': patch
---

Document one setup instead of one per environment

The docs were organised by environment — localhost, a phone, deployed HTTP, deployed HTTPS,
locked-down — which read as five different ways to install the tool. They aren't: the only thing
that differs is how the page reaches the hub, and one address reachable from everywhere removes
the variation entirely.

The guidance now leads with that single path: one env var holding one address, `enabled:
isDebugActivated`, the same value in every environment including production. The alternatives for
teams who can't route logs through a tunnel (team hub, own certificate, reverse proxy, plain LAN
HTTP) are collapsed into one table behind a fold, since none of them change the app-side code.

No behaviour change; 110 fewer lines of documentation.
