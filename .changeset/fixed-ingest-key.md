---
'crosspane': minor
---

`--ingest-key` and env defaults, so a deployed app stops needing a redeploy per hub restart

The address a deployed app holds has two moving parts and both were moving: a quick tunnel
picks a new hostname each run, and the ingest key was regenerated on every restart. So even
after the credential split made production debugging safe, every hub restart still meant
editing the app's env var and deploying again.

The key had no reason to rotate — it is write-only, so there is nothing to protect by changing
it. `--ingest-key <key>` (or `CROSSPANE_INGEST_KEY`) pins it. `--public-url` also reads
`CROSSPANE_PUBLIC_URL`, so a stable setup lives in your shell profile instead of being retyped.

Pair a fixed key with a permanent hostname — a named `cloudflared` tunnel on a domain you
already own, or Tailscale Funnel — and the value in your app never changes again. The read
token keeps rotating, because that one is sensitive and stays on your machine.
