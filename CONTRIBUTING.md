# Contributing to crosspane

By participating you agree to our [Code of Conduct](CODE_OF_CONDUCT.md).
Security issues: see [SECURITY.md](SECURITY.md) — please report privately.

## Setup

Requires **Node ≥ 20** and **pnpm 10** (CI uses Node 20/22 and pnpm 10).
No browser binaries or device SDKs needed.

```bash
pnpm install
pnpm build
```

## Verify your change

```bash
pnpm exec biome check --write .   # format + lint
pnpm test                         # unit + integration
pnpm build
pnpm smoke                        # e2e: real hub process + agent round-trip
```

CI runs lint + typecheck + tests + build on macOS, Windows and Linux, and the smoke
test on Linux. A pre-commit hook (husky) enforces Biome on staged files. To run a
single test: `pnpm --filter @crosspane/agent exec vitest run -t "test name"`.

## Repository map

- `packages/protocol` — wire types shared by all three sides. **Types and constants only**
  (it ends up in the user's app bundle through the agent)
- `packages/agent` — the in-page SDK. Held to different standards than the rest:
  zero dependencies, no observable effect on the host page, explicit gating.
  Read `.claude/rules/agent-sdk.md` before touching it
- `packages/cli` — hub server (session relay) + dashboard serving + CLI
- `packages/dashboard` — React dashboard: live sessions and capture-file replay
- `.claude/rules/` — invariants per area (path-scoped). Read the matching rule file
  before touching the protocol or the agent
- `ARCHITECTURE.md` — full design rationale, including why the 0.6.x engine-mirroring
  architecture was removed

## Conventions

- Conventional commits (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, `test:`)
- User-facing strings are English; code comments and `.claude/rules/` are Korean
- New OS-specific logic must be a pure, unit-tested function
- **Agent changes need extra care**: every hook must preserve the original behavior and
  return a teardown function; anything that grows the bundle needs a justification
- **If your change affects users** (fix, feature, behavior change), add a changeset:
  run `pnpm changeset`, pick `patch` or `minor`, and describe the change in one or two
  sentences (this becomes the CHANGELOG entry). Internal-only changes (docs, tests,
  refactors with no visible effect) don't need one.

## Releasing (maintainers)

Releases are automated with [changesets](https://github.com/changesets/changesets):

1. PRs land on `main` with changeset files (see above)
2. The release workflow opens/updates a **"chore: version packages"** PR that bumps
   versions and updates each package's `CHANGELOG.md`
3. Merging that PR publishes to npm (Trusted Publishing/OIDC) and pushes git tags

Publishing runs through `scripts/ci-publish.mjs` (`npm publish` directly, then
`changeset tag`) — `changeset publish` cannot be used here because it routes through
`pnpm publish --no-git-checks`, which recent npm versions reject.
