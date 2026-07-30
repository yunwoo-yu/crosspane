---
'crosspane': minor
---

The ingest key is generated once and reused — nothing for you to create or copy

`--ingest-key` shifted the work onto the user: run `openssl rand -hex 8`, put it in an env var,
keep it in sync. That is the library's job, not yours.

The hub now generates the key on first run, saves it to `~/.crosspane/config.json` (mode 0600),
and reuses it on every restart. An address baked into a deployed app keeps working with no
setup at all. `--ingest-key` / `CROSSPANE_INGEST_KEY` still overrides it for a shared team hub
or CI, and `CROSSPANE_CONFIG_DIR` moves the file.

`--public-url` is remembered in the same file, so a stable tunnel address is given once instead
of living in a shell profile. Later runs are just `crosspane`; pass an empty string to forget it.

The read token deliberately stays ephemeral: it can read session logs, so regenerating it every
restart is a safety property, and it never goes into an app.

If the file can't be written the hub still starts, but says so — a key that silently changes
would make a deployed app look broken for no visible reason.
