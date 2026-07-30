---
'crosspane': minor
---

`--lan-tls`: reach the hub from a deployed `https://` page over your own Wi-Fi, with no tunnel

Investigating why a deployed page couldn't reach a LAN hub turned up the real cause: it is a
**permission**, not a block. Chrome answers `LocalNetworkAccessPermissionDenied`, and
`local-network-access` is a permission whose state is `prompt` in an ordinary browser. The only other
requirement is a certificate the device trusts.

`crosspane --host 0.0.0.0 --lan-tls` supplies that certificate. The hub serves
`https://<lan-ip-with-dashes>.local-ip.sh` — a Let's Encrypt wildcard published, private key
included, so anyone can serve TLS on a private address. Measured end to end: `https://example.com` →
`wss://…local-ip.sh/agent` → session and console event in the hub.

Honest limits, all surfaced by the CLI rather than left to be discovered:

- the device shows a local-network permission prompt and has to allow it; whether an in-app webview
  shows that prompt is **not verified**
- networks with DNS rebinding protection won't resolve the name — crosspane checks at startup and
  explains, pointing at `--tls-cert` and `--tunnel`
- the certificate's private key is public, so this buys trust rather than secrecy; it replaces plain
  HTTP, and reading sessions still needs the `?t=` token
- it depends on `local-ip.sh` for DNS and the certificate
