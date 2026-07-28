---
"crosspane": patch
---

Runtime safety net: global `unhandledRejection`/`uncaughtException` handlers now log the full stack and run the normal shutdown path (previously the process died silently, orphaning browsers/emulators/stream children). Fatal errors keep their stack trace instead of printing only the message. New `--verbose` flag (or `CROSSPANE_VERBOSE=1`) surfaces the causes behind silent fallbacks — CDP screencast failures, capture errors, shell/SCK/IME fallbacks — for actionable bug reports.
