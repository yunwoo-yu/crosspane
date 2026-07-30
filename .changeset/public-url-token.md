---
'crosspane': patch
---

`--public-url` now generates the access token

The token was keyed off `--host` alone, so `crosspane --public-url https://<tunnel>` kept the
default loopback binding and issued no token — a hub reachable from the entire internet with no
authentication, and the startup output even claimed `--no-auth` was in effect. A tunnel or
reverse proxy is exposure, so it now requires the token like `--host` does.
