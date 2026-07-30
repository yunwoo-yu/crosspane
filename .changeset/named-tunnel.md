---
'crosspane': minor
---

`--hostname` sets up the permanent tunnel for you, so a deployed app needs no manual tunnel work

`--tunnel` handled the local case, but a deployed app's address lives in its deployment config and
a quick tunnel picks a new hostname every run. That left four `cloudflared` commands to run by hand.

`crosspane --tunnel --hostname crosspane.example.com` now creates the named tunnel, routes DNS to
it and runs it. It is idempotent — "already exists" counts as success — so the same command works
on day one and every day after, and the value in your deployment config never changes.

One step genuinely can't be automated: `cloudflared tunnel login` opens a browser, because a
permanent public hostname belongs to an account. Looked for a way around that and measured the
alternatives — ngrok's free plan refuses custom subdomains ("Only paid plans may create endpoints
with custom subdomains"), while Tailscale Funnel gives a stable `*.ts.net` with no domain at all
and can be used through `--public-url`.

A quick tunnel now also says that its address changes per run, so it's clear when a deployed app
would go stale.
