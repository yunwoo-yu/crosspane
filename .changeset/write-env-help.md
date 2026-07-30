---
'crosspane': patch
---

Fix stale `--write-env` help text

It still described the address as carrying a write-only key. Since keys were dropped from the
advertised address, `--write-env` writes just the address.

Also makes the "cloudflared not installed" message actionable: it now lists how to install it,
notes that `npx cloudflared` is a community wrapper rather than a Cloudflare-published package, and
points at the alternatives that need no install at all (Tailscale Funnel for a permanent address,
ngrok for a throwaway one).
