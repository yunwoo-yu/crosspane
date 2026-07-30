---
'crosspane': patch
---

Correct the claim that a deployed page can't reach a LAN hub — it's a permission, not a block

The previous release documented, confidently, that a page served from the public internet can never
reach a private address. That was wrong. Asking Chrome directly over CDP gives
`LocalNetworkAccessPermissionDenied`, and `local-network-access` is a real permission whose state is
`prompt` in an ordinary browser — automation denies it by default, which is what the earlier test
actually measured.

With that check lifted and nothing else changed, the whole path works: `https://example.com` →
`wss://<lan-ip>.local-ip.sh/agent` delivered a session and a console event to the hub, over a
genuine Let's Encrypt certificate for a name resolving to the private IP.

Still unverified: whether that prompt can be accepted inside an in-app webview, which is the
environment this project targets. Until that is known the existing options (tunnel, deployed hub,
your own server) remain the documented ones, but "impossible" was the wrong word and is now gone.
