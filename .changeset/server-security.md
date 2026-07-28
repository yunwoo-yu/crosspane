---
"crosspane": patch
---

Security hardening for the dashboard server: binds to 127.0.0.1 by default (new `--host` flag to opt into network exposure, with a warning), WebSocket connections now verify Origin against loopback/same-host (blocks cross-site WebSocket hijacking of the input-mirroring channel), shell bridge endpoints validate the engine name and cap request body size.
