---
'crosspane': patch
---

Fix `--lan-tls` pointing the dashboard at a hostname its certificate doesn't cover

`--lan-tls` printed the dashboard as `https://localhost:<port>`, but the certificate only covers
`*.local-ip.sh`. The page could be opened by clicking through the warning — and then the WebSocket
could never connect, because browsers do not allow certificate exceptions for a WebSocket handshake.
The result was a dashboard stuck on `connecting…` with no clue why, while agents were connecting to
the same hub perfectly well. Found by using it: a phone was streaming the whole time and the
dashboard simply couldn't show it.

The dashboard URL now uses the certificate's hostname.

The dashboard also stops hiding the reason: after a few failed attempts it shows the address it is
trying to reach, and hovering shows it immediately. A certificate-name mismatch is invisible
otherwise.
