---
'crosspane': minor
'@crosspane/agent': patch
---

Require an access token when the hub is exposed to a network.

Measured before this change: with `--host 0.0.0.0`, any device on the same Wi-Fi could connect
to `/ws` with a non-browser client and read every session's full history — console text
included, which in a real session carries tokens and user data — download any capture file from
`/capture/:id`, and register fake sessions through `/agent`. The Origin check that prevents
cross-site WebSocket hijacking does not apply to clients that send no Origin, so it never stood
in the way.

Exposing the hub now generates a one-time token, printed with the URLs at startup and required
on `/ws`, `/agent`, `/capture/:id`, and `/hub-info`. Loopback binds are unchanged — the OS
already restricts those, and a token there would be friction with no benefit. `--no-auth` opts
out for networks you fully trust.

The dashboard picks the token up from its own URL, removes it from the address bar, and keeps it
for the tab. The agent takes it from `serverUrl` (`http://<ip>:7788/?t=…`), and `crosspane mcp`
from `--hub`. `SECURITY.md` now states what exposure means instead of listing it as out of scope.
