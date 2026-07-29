---
'@crosspane/agent': minor
---

Add `agent.copyCapture()` — puts the capture JSON on the clipboard and resolves to whether it
worked.

Offline capture is the main path on a security-locked build, but the only exit was a blob
download, which a webview honours only if the host app implements downloads (and in-app
browsers usually block outright) — with no way to detect the failure from JavaScript. The
modern alternatives are unavailable exactly where they are needed: an in-house build served
from `http://<lan-ip>` is not a secure context, so `navigator.clipboard` and `navigator.share`
are `undefined` there. `copyCapture()` therefore falls back to `execCommand('copy')`, which is
the working path in that environment rather than a legacy one.

The README now documents how to get a capture off a locked device, including the
native-bridge route for React Native and WKWebView hosts.
