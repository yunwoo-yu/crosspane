---
'crosspane': minor
---

The address is all your app needs — no key appended

Even after the read/write split, the agent's address carried `?k=<key>`, so the value in an app's
env var was an address plus a credential to keep in sync. The key was redundant: Sentry's DSN
carries a public key because one ingest endpoint serves many projects and the key identifies
yours, but a crosspane hub is single-tenant — the address already identifies it. All the key added
was unguessability, which the hostname provides, in exchange for the user managing it.

`/agent` now accepts sessions without a credential, so an env var looks like any other base URL:

```
NEXT_PUBLIC_CROSSPANE_URL=https://crosspane.example.com
```

Reading is unchanged and still requires the `?t=` token on `/ws`, `/capture/:id` and `/hub-info` —
that is the half that protects session logs, and it stays off your pages.

The tradeoff, stated plainly: anyone who knows the address can send junk sessions to your hub
(never read one), and enough of them could push your own out of the retained-session limit.
`--ingest-key <key>` requires `?k=` from senders for a hub that is long-lived and shared. Keys are
no longer generated automatically; if 0.13.x saved one for you, delete `~/.crosspane/config.json`
to drop it.
