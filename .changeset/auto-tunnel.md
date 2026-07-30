---
'crosspane': minor
---

`--tunnel` starts the tunnel for you, and gating no longer leads with a URL parameter

**`--tunnel`.** Reaching a hub from a deployed `https://` page needs a tunnel, and doing it by hand
meant two terminals and copying an address that changes every run. The hub now starts your
installed `cloudflared` or `ngrok` itself and advertises the address it reports, so
`crosspane --tunnel --write-env` is the whole thing — the address lands in `.env.local` and there is
nothing to copy. Stopping the hub stops the tunnel and removes the entry. Session logs transit that
provider, which is why it stays an explicit flag, and no binary is ever downloaded for you.

**Gating.** The docs recommended `enabled: isDebugActivated`, which opts a device in through
`?__crosspane=on`. That cannot work in a webview the app opens itself — there is no address bar —
and that webview is most of what this tool exists for. The guidance now leads with gating on
something the app already knows (`enabled: () => user.isQA`), with the link-based check offered
only for pages that have no user model, like a static site or a kiosk. No behaviour change;
`isDebugActivated` is unchanged and still exported.
