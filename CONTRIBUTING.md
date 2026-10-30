# Contributing

Maintained by Thomas Foster, with a workflow meant to be approachable for both humans and coding agents. Conventions are in [AGENTS.md](AGENTS.md); the design decisions are in [DESIGN.md](DESIGN.md).

## Setup

Node 22 or newer and pnpm 11 (`corepack enable` picks up the version pinned in `package.json`; no other package manager is used here). Then:

```sh
pnpm install                      # dependencies, git hooks, the @effect/tsgo patch
vp exec playwright install chromium   # once, for the browser tests
```

`vp` is [Vite+](https://viteplus.dev)'s CLI, installed as a dev dependency; run it through `pnpm exec vp` if it is not on your PATH.

## Branches

Branch off `trunk`, rebase rather than merge, squash-merge with a conventional prefix: see [AGENTS.md](AGENTS.md#branches-and-pull-requests).

## Git hooks

Hooks are managed by Vite+; the editable [.vite-hooks/pre-commit](.vite-hooks/pre-commit) is committed. **pre-commit** runs `vp staged` (format + lint on staged files). There is no pre-push hook.

## CI expectations

[ci.yml](.github/workflows/ci.yml) runs one required job, `ci`, whose steps are the gate list in [AGENTS.md](AGENTS.md#verification). [release.yml](.github/workflows/release.yml) runs changesets/action on `trunk`: it opens the version PR while unreleased changesets exist and publishes once it merges, via npm OIDC trusted publishing (see [PUBLISHING.md](PUBLISHING.md)). Both workflows start from `permissions: {}`, pin every action to a commit SHA, and keep Dependabot PRs safe: CI holds a read-only token and no secrets and never persists checkout credentials, and the release job (the only one with `id-token: write`) never runs for `dependabot[bot]`. `uvx zizmor --offline .github` audits them (config in `.github/zizmor.yml`).

## Pre-PR checklist

1. The gates in [AGENTS.md](AGENTS.md#verification), each with its final pass/fail.
2. A changeset (`pnpm changeset`) where [AGENTS.md](AGENTS.md#branches-and-pull-requests) requires one.
3. `git fetch origin trunk && git rebase origin/trunk`
4. Docs: `README.md` for any exported change; `DESIGN.md` for a new convention or decision.

## Running individual checks

```sh
vp lint                                       # oxlint
vp fmt                                        # oxfmt
vp run check                                  # the whole type gate (src, then tests)
vp run test:unit                              # node tests (happy-dom)
vp run test:browser                           # browser tests (Chromium)
vp test run tests/model/node.test.ts          # a single file
vp run build                                  # emit dist/
vp run docgen                                 # examples + API reference under docs/
vp run test:coverage                          # one Istanbul map for fallow
vp run fallow:audit                           # change-set review (not a CI gate)
```
