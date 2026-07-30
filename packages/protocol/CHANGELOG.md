# @crosspane/protocol

## 0.5.0

### Minor Changes

- 462e3cf: Signal the end of history replay, so `crosspane mcp` stops answering from a partial one

  The hub sends `hello` and then streams history across several frames. A live UI filling in a few
  frames late is harmless, but `crosspane mcp` answers a question immediately after connecting, and
  between those frames it was answering from **part** of the history — which for a coding agent means
  it could say "no errors" when there were some. It surfaced as a CI flake first: one leg saw one of
  two events and blocked a release.

  The hub now sends `history-complete` once per connection, after the replay, and the MCP server waits
  for it before its first answer. The dashboard ignores it; a new consumer that answers questions
  right after connecting should wait for it too.

  Tests that assert on a frame sequence need to skip it — it is a boundary, not data.

## 0.4.0

### Minor Changes

- 9bd4782: Collapse consecutive duplicate console events into one with a `repeat` count.

  A broken webview emits the same error thousands of times per second, and that one line used
  to consume every buffer in the system. Measured before this change: after 3,000 identical
  messages, the hub's 2,000-event history held **one distinct message** and the error that
  started the cascade was gone — which makes the capture file, the primary path on a
  security-locked build, useless exactly when it matters.

  Coalescing happens in the agent's ring buffer (so exported captures stay useful) and in the
  live transport's pending queue (so the hub's history and any late-joining dashboard see it
  too, and the connection carries less). Only console and page errors coalesce — network and
  navigation events stay separate, because requesting the same URL twice is not the same fact
  as requesting it once. The first occurrence's timestamp is kept so timeline position doesn't
  drift, and the count is shown rather than hidden.

  `SessionEvent` gains an optional `repeat` field on `console` and `pageerror` (absent means 1),
  which is backward compatible — older dashboards ignore it, and the capture file version is
  unchanged.

- c42a14d: Record when a repeated error stopped, not just when it started.

  Coalescing consecutive duplicates keeps the first occurrence's timestamp so the timeline
  position stays put — but that alone loses something important. An error repeating every five
  seconds for ten minutes collapsed to a single line stamped `10:00:00 ×120`, which reads as
  "it happened a few times at the start and stopped". Whether it is _still_ happening is often
  the most useful fact in the log.

  `console` and `pageerror` events now carry an optional `repeatUntil` (the last occurrence), and
  the dashboard shows the span next to the count — `×120 10m` — so an ongoing failure can't be
  mistaken for a burst. Bursts shorter than a second show no span, since a duration adds nothing
  there.

## 0.3.0

### Minor Changes

- 348209f: Screen recording, as an opt-in plugin. `@crosspane/agent-replay` records the DOM with rrweb and rides the core agent's existing session timeline, so screen frames stay ordered alongside console and network events and land in `.crosspane.json` exports. The dashboard gains a **Screen** tab that plays them back, loading the player lazily so nobody pays for it unless a session actually has a recording.

  A prebuilt single-file bundle is included for environments without a bundler; it keeps `@crosspane/agent` external so the page reuses the agent instance it already loaded rather than starting a second session.

  It is a separate package because rrweb is tens of times larger than the core agent — the "no third-party dependencies, a few KB" promise of `@crosspane/agent` stays intact. The core gains one small extension point (`agent.emit`) and the protocol a generic `screen` event whose `format` field leaves room for non-rrweb capture methods later.

## 0.2.0

### Minor Changes

- 79ed26a: **crosspane is now a webview debugging toolkit.**

  The multi-engine preview (Playwright + iOS Simulator + Android emulator mirroring) is gone.
  It could never reach the environments this project actually cares about: production in-app
  webviews, in-app browsers, and security-hardened builds where remote inspectors are blocked
  outright. That version is preserved at the `crosspane@0.6.2` tag.

  What replaces it:

  - **`@crosspane/agent`** — a dependency-free SDK you embed in dev/QA builds. Hooks console,
    uncaught errors, unhandled rejections, fetch/XHR and navigations into a crash-resistant ring
    buffer. Stream live to the hub over your LAN, or export a `.crosspane.json` capture file when
    the network isn't an option (ISMS-P / MDM locked devices).
  - **`crosspane`** — the hub CLI is now a session relay: receives live agents on `/agent`, serves
    the dashboard, replays history to late-joining dashboards. No browser dependencies, so
    installs are megabytes instead of hundreds.
  - **Dashboard** — session list (multiple devices at once, live/ended, error badges), console and
    network panels, and drag-and-drop replay of capture files through the exact same UI.
  - **`@crosspane/protocol`** — shared wire types, published so integrations can build on them.

### Patch Changes

- 107330d: Package docs and metadata for npm: README, LICENSE, repository/homepage/bugs fields.
