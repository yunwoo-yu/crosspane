# Contributing to crosspane

## Setup

```bash
pnpm install
pnpm --filter crosspane exec playwright install chromium webkit firefox
pnpm build
```

## Verify your change

```bash
pnpm exec biome check --write .   # format + lint
pnpm test                         # unit/integration (no browsers needed)
pnpm build
pnpm smoke                        # e2e: boots the real CLI with chromium
```

CI runs all of the above on macOS, Windows and Linux. A pre-commit hook (husky)
enforces Biome on staged files.

## Repository map

- `packages/cli` — engine/real-device sessions, WS server, protocol (single source:
  `src/protocol.ts` — the dashboard imports it directly, keep it browser-safe)
- `packages/dashboard` — React dashboard (frames are drawn to canvas, never React state)
- `.claude/rules/` — invariants per area (path-scoped). Read the matching rule file
  before touching frame pipeline, input mirroring, real-device adapters or the protocol
- `ARCHITECTURE.md` — full design rationale

## Conventions

- Conventional commits (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, `test:`)
- New OS-specific logic must be a pure, unit-tested function (see
  `androidSdkCandidateDirs` for the pattern)
- Real-device adapter behavior can't run in CI — verify locally and note it in the PR

## Releasing (maintainers)

`npm publish` from `packages/cli` — `prepublishOnly` runs build + tests and bundles
the dashboard into `dist/public`.
