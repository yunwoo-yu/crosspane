# Contributing to crosspane

## Setup

Requires **Node ≥ 20** and **pnpm 10** (CI uses Node 20/22 and pnpm 10).

```bash
pnpm install
pnpm --filter crosspane exec playwright install chromium webkit firefox
pnpm build
```

> The `playwright install` must run in the cli package (`--filter crosspane`), not the
> workspace root — pnpm 10 blocks postinstall scripts at the root, so a root-level
> install exits without downloading anything.

## Verify your change

```bash
pnpm exec biome check --write .   # format + lint
pnpm test                         # unit/integration (no browsers needed)
pnpm build
pnpm smoke                        # e2e: boots the real CLI with chromium
```

CI runs lint + tests + build on macOS, Windows and Linux, and the smoke test on
Linux. A pre-commit hook (husky) enforces Biome on staged files. To run a single
test: `pnpm --filter crosspane exec vitest run -t "test name"`.

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
- **If your change affects users** (fix, feature, behavior change), add a changeset:
  run `pnpm changeset`, pick `patch` or `minor`, and describe the change in one or two
  sentences (this becomes the CHANGELOG entry). Internal-only changes (docs, tests,
  refactors with no visible effect) don't need one.

## Releasing (maintainers)

Releases are automated with [changesets](https://github.com/changesets/changesets):

1. PRs land on `main` with changeset files (see above)
2. The release workflow opens/updates a **"chore: version packages"** PR that bumps
   versions and updates `packages/cli/CHANGELOG.md`
3. Merging that PR publishes to npm (Trusted Publishing/OIDC) and pushes the
   `crosspane@x.y.z` git tag

Manual `npm publish` is not the supported path — `prepublishOnly` (build + tests)
exists only as a last-resort safety net.
