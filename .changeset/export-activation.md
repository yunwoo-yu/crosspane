---
'@crosspane/agent': patch
---

Export `isDebugActivated`, and honour the activation parameter on localhost

Applying the agent to a real production site surfaced two problems.

**The activation check wasn't available to the app.** Gating installation so that real visitors
get no hooks at all is the normal thing to want on a live site, and `enabled` is the switch for
it — but the agent kept its opt-in check private, so the app had to reimplement parameter
reading, storage and the try/catch around it. That's now one import:

```ts
initCrosspane({ serverUrl, enabled: isDebugActivated })
```

**The activation parameter was silently ignored on loopback.** `resolveActivation` returned early
for localhost without reading or persisting it, so `?__crosspane=on` didn't survive a navigation
(breaking any app that gates on the stored value) and `?__crosspane=off` did nothing at all.
Turning it off is now also recorded rather than just cleared — clearing left "no preference",
which on loopback means on, so the choice came back on the next load.
