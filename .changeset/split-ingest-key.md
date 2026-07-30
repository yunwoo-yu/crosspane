---
'crosspane': minor
---

Separate write-only ingest key from the read token, so a production page can be debugged

One token guarded both directions: sending sessions and reading them. That made the agent
unusable on a public production page, because the hub address has to reach the client, and
anything a public page knows is public. Putting the agent on a live site leaked a token that
could read every session — measured on a real deployment.

Exposing the hub now generates two credentials:

- **write-only ingest key** (`?k=`) — accepted on `/agent` only. This is what goes into the
  agent's `serverUrl` and into `--write-env`, and it is *designed* to be public. Worst case if
  it leaks: someone sends junk sessions to your hub.
- **read token** (`?t=`) — required on `/ws`, `/capture/:id` and `/hub-info`. Stays on your
  machine; it never belongs in a page.

`/agent` still accepts the read token, so existing `serverUrl` values keep working.

This is the same split as a Sentry DSN public key, and it is what makes "see the errors that
only happen in production" possible without handing strangers your session logs.
