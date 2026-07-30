---
'@crosspane/agent': minor
'crosspane': minor
---

Zero-config hub address: `initCrosspane({ label })` now needs no `serverUrl`

The agent resolves the hub itself — explicit `serverUrl` > build-time injected env >
`http://localhost:7788` when the page is on loopback > offline capture only. On localhost
that means no address, no token, no config.

For phones and deployed URLs, `crosspane --write-env` writes the hub's address (and access
token) into `.env.local` under a managed block, picking the variable name from your
`package.json` (`NEXT_PUBLIC_`/`VITE_`/`PUBLIC_`/`REACT_APP_`). The block is removed when the
hub stops, so a dead address can't linger.

Safe on deployed builds by design: the agent only auto-connects when the page itself is on
loopback, and an injected address on any other host also requires per-device activation via
`?__crosspane=on`. The activation link carries only "on" — the destination always comes from
the build, never from the URL. A hand-written `serverUrl` keeps working unchanged and needs no
activation.

Also adds `agent.live`, so an app can tell whether it is streaming or recording offline.
