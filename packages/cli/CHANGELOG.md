# crosspane

## 0.2.0

### Minor Changes

- 0d13067: Login session persistence: each engine's cookies and storage (`storageState`) are
  saved to `~/.crosspane/state/<origin>/<engine>.json` on shutdown and restored on
  the next run — no more re-logging into your app in every engine every time.
  Use `--fresh` to start with a clean session.
