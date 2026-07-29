# @crosspane/agent-replay

## 0.2.1

### Patch Changes

- Updated dependencies [bdaa6ee]
- Updated dependencies [66bc6e8]
- Updated dependencies [5b76984]
- Updated dependencies [9bd4782]
- Updated dependencies [c42a14d]
- Updated dependencies [ef8e7ac]
- Updated dependencies [f2cd34f]
  - @crosspane/agent@0.5.0

## 0.2.0

### Minor Changes

- 348209f: Screen recording, as an opt-in plugin. `@crosspane/agent-replay` records the DOM with rrweb and rides the core agent's existing session timeline, so screen frames stay ordered alongside console and network events and land in `.crosspane.json` exports. The dashboard gains a **Screen** tab that plays them back, loading the player lazily so nobody pays for it unless a session actually has a recording.

  A prebuilt single-file bundle is included for environments without a bundler; it keeps `@crosspane/agent` external so the page reuses the agent instance it already loaded rather than starting a second session.

  It is a separate package because rrweb is tens of times larger than the core agent — the "no third-party dependencies, a few KB" promise of `@crosspane/agent` stays intact. The core gains one small extension point (`agent.emit`) and the protocol a generic `screen` event whose `format` field leaves room for non-rrweb capture methods later.

### Patch Changes

- Updated dependencies [348209f]
- Updated dependencies [c53c60b]
  - @crosspane/agent@0.4.0
