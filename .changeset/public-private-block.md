---
'crosspane': patch
---

Correct the guidance for debugging a deployed page: a public page can't reach a private address

The docs offered "a public certificate for a name resolving to your LAN IP" as one way to debug an
`https://` page. Measured, and it never works: from `https://example.com`, a WebSocket to a LAN
address carrying a valid Let's Encrypt certificate does not even leave the browser, while the same
page opens a public `wss://` fine and a page on that LAN opens the same address fine. Browsers block
public→private before the network layer, so no certificate — and no `wss://` baked into the build —
changes it.

For a deployed page the receiver has to be public: a tunnel, a hub you deployed, or your own server
holding the logs. `--tls-cert` is for a hub the page can actually reach — the same internal network,
or a public address.
