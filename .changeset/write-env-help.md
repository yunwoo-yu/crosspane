---
'crosspane': patch
---

Fix stale `--write-env` help text

It still described the address as carrying a write-only key. Since keys were dropped from the
advertised address, `--write-env` writes just the address.
