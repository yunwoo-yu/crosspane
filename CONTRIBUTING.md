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
pnpm exec biome ci .              # what CI actually judges — see below
pnpm check:publishable            # no workspace: specifiers or missing README/LICENSE
pnpm typecheck                    # sources and tests
pnpm test                         # unit + integration
pnpm coverage                     # same, with the coverage ratchet enforced
pnpm build
pnpm smoke                        # e2e: real hub process + agent round-trip
```

`biome ci` is not redundant: `check --write` can pass while `ci` fails, because some rules
(suppression validity, a few a11y ones) are only judged in CI mode. Run it before pushing.

To try your change by hand, `pnpm try` starts the hub and the demo page together and prints
what to open — the demo page is where you click things, the dashboard is where they show up:

```bash
pnpm try            # hub on :7788 + demo page on :7999
pnpm try:lan        # same, bound to 0.0.0.0 so a phone on your Wi-Fi can reach it
pnpm hub            # hub only
pnpm demo           # demo page only
pnpm mcp            # MCP stdio server (needs a running hub)
```

Use different ports with `CROSSPANE_PORT=7801 PORT=7802 pnpm try`; the demo page's `serverUrl`
follows automatically, including the access token when the hub is exposed.

Some regressions only appear in a real browser — a webview-shaped one especially. Screen
recording, clipboard export, and anything layout-related have all shipped broken past a green
`pnpm test`, so exercise those in a browser before opening a PR.

CI runs lint + typecheck + tests + build on macOS, Windows and Linux, and the smoke
test on Linux. A pre-commit hook (husky) enforces Biome on staged files. To run a
single test: `pnpm --filter @crosspane/agent exec vitest run -t "test name"`.

## Repository map

- `packages/protocol` — wire types shared by all three sides. **Types and constants only**
  (it ends up in the user's app bundle through the agent)
- `packages/agent` — the in-page SDK. Held to different standards than the rest:
  zero dependencies, no observable effect on the host page, explicit gating.
  Read `.claude/rules/agent-sdk.md` before touching it
- `packages/agent-replay` — optional screen recording (rrweb). Heavy dependencies are
  allowed here precisely because it is optional; it emits through the core's `agent.emit`
  rather than opening its own transport
- `packages/cli` — hub server (session relay) + dashboard serving + CLI + `crosspane mcp`
- `packages/dashboard` — React dashboard: live sessions and capture-file replay
- `.claude/rules/` — invariants per area (path-scoped). Read the matching rule file
  before touching the protocol or the agent
- `ARCHITECTURE.md` — the design and the reasoning behind each constraint
- `docs/decisions.md` — structural decisions and why, including why the 0.6.x
  engine-mirroring architecture was removed. Read it before proposing to bring anything back

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

### First publish of a new package

npm Trusted Publishing (OIDC) can only be configured on a package that already exists,
so the **first** version of any new package has to be published by hand:

```bash
pnpm build
cd packages/<name> && npm publish --access public
```

Then add the Trusted Publisher on npmjs.com (package → Settings → Trusted Publisher →
this repo + `release.yml`). Every release after that is automatic.

The version PR also refreshes `pnpm-lock.yaml` (the root `version` script does this) —
changesets updates package versions and inter-package ranges but not the lockfile, and CI
installs with `--frozen-lockfile`.

Publishing runs through `scripts/ci-publish.mjs` (`npm publish` directly, then
`changeset tag`) — `changeset publish` cannot be used here because it routes through
`pnpm publish --no-git-checks`, which recent npm versions reject.
