---
"crosspane": patch
---

Fix a broken dependency spec that made `npm install crosspane@0.7.0` fail with `EUNSUPPORTEDPROTOCOL`. The published manifest carried `"@crosspane/protocol": "workspace:*"` because `npm publish` — unlike `pnpm publish` — does not rewrite the workspace protocol. Dependencies now use plain semver ranges, with `link-workspace-packages` keeping local development linked, and a `check:publishable` script fails the build if a workspace/link/file specifier ever reaches a publishable package again.
