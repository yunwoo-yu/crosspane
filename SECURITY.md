# Security Policy

## Supported versions

Only the latest published version of `crosspane` receives security fixes
(the project is pre-1.0).

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Instead use
[GitHub private vulnerability reporting](https://github.com/yunwoo-yu/crosspane/security/advisories/new).

You can expect an initial response within a week. Once a fix is released the
report will be credited (unless you prefer otherwise).

## Scope notes

crosspane is a **local development tool**. Its threat model assumptions:

- The dashboard server binds to `127.0.0.1` by default and mirrors input into real
  browser sessions — anything that lets a remote party reach that channel
  (bind bypass, WebSocket origin-check bypass, shell-bridge abuse) is in scope.
- Login state saved under `~/.crosspane/state/` contains real cookies — anything
  that exfiltrates or mishandles it is in scope.
- Running crosspane against a malicious *target page* should never compromise the
  host beyond what a regular browser visit could — escapes from the engine
  sandbox via crosspane's injection/bridge code are in scope.
- Using `--host 0.0.0.0` intentionally exposes the dashboard to the network;
  risks inherent to that explicit opt-in are out of scope.
