# Contributing

## Workflow

The main branch is `trunk`. Branch off `trunk`, open a pull request into `trunk`, and squash-merge with a conventional prefix (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`).

- **Open a draft PR early**, so others can see the work is taken.
- **One PR per change**, even a large one spanning many sessions or commits.
- **Rebase, don't merge.** Rebase onto `origin/trunk`; never merge `trunk` into your branch (GitHub's Update-branch button merges).
- **File issues** for bugs or improvements you spot outside your change, rather than fixing them in passing or leaving a TODO. Keep issue bodies evergreen: context, problem, findings and the chosen solution, edited in place.
- **Dependabot** keeps dependencies current; update one by hand only when your work needs it or Dependabot can't (see [Dependencies](#dependencies)).

## Toolchain

[Vite+](https://viteplus.dev) (`vp`) manages Node and pnpm; use it rather than calling them directly (`vp exec <bin>`, not `npx`). `vp install` installs dependencies, the git hooks and the Effect-patched `tsc` / `oxlint` (`prepare`). The pre-commit hook ([.vite-hooks/pre-commit](../.vite-hooks/pre-commit)) runs `vp staged` (format with fixes, then lint) and then `vp run fallow:audit`.

| Command | What it does |
| --- | --- |
| `vp check` | Format and lint (Oxfmt, Oxlint with the Effect presets), type-aware |
| `vp run check` | The type gate: `src`, then the tests and `tests/**/*.types.ts` |
| `vp run test:unit` | The `node` test project (happy-dom) |
| `vp run test:browser` | prosemirror-view's suites in headless Chromium (installs it unless `PLAYWRIGHT_CHROMIUM_EXECUTABLE` names one) |
| `vp run build` | `vp pack` → `dist/` |
| `vp run docgen` | Builds, then compiles and runs every JSDoc example; writes `docs/api/` (not committed) |
| `vp run bench` | Times `tests/bench/workloads.ts` on ProseMirror and on `dist/` (`BENCH_FILTER`, `BENCH_ROUNDS`); not a gate |
| `vp run ci` | Everything CI runs |
| `vp test run path/to/file` | One test file |

[Fallow](https://docs.fallow.tools) checks module boundaries (`.fallowrc.json`), complexity and duplication; use it to polish your work (`vp run fallow`), as guidance rather than dogma. The pre-commit hook runs `vp run fallow:audit`, which refreshes the coverage map and fails only on findings the change introduces against `origin/trunk`. `.fallow-baselines/` records what the port inherited from ProseMirror; re-save a baseline only to shrink it. Before deleting "unused" code, trace it: `vp exec fallow dead-code --trace <file>:<export>`.

## Coding guidelines

- **Effect.** Use Effect (v4) idioms throughout, and prefer Effect's own modules (`Option`, `Array`, `Match`, `Schema`, …) to hand-rolled equivalents; convert existing code when you touch it, where practical. Exceptions: non-Effect APIs (adapt them at the edge), the `compat/*` facade, which mirrors ProseMirror's API exactly, and hot paths where measurement shows plain code is needed (model, transform and view algorithms run per keystroke, so internals call the `…Unsafe` twins). Read the installed package rather than guessing an API (`node_modules/effect/`). [DESIGN.md](DESIGN.md) records the conventions: `x` / `xUnsafe` pairs, `Option` for absent values, one `Schema.TaggedError` family per layer.
- **Lint.** Fix findings in code. The allowances in `vite.config.ts` sit at `warn` with a site count: a new site is a defect; lower the count as sites go and delete the line at zero.
- **Packaging.** `dist/` is the product, one file per source module. The layout is Effect v4's: each public module is a PascalCase file (`src/Model.ts`), on its own PascalCase subpath and re-exported as a namespace from `src/index.ts`; its implementation lives in a lowercase directory (`src/model/`). A new module goes in `entries` (`vite.config.ts`), `exports` (`package.json`), `entry` and a boundary zone (`.fallowrc.json`), `src/index.ts` and the README table. A module with top-level statements needs a `sideEffects` entry in `package.json` and stays out of `index.ts`. `compat/*` keeps ProseMirror's lowercase names. The lowercase `exports` aliases of 0.2 are deprecated and go in the next breaking release.
- **Comments.** A file-level comment only for real context, in under 50 words. Doc comments where they help someone reading IntelliSense, adding to the signature; docgen requires `@since` and `@category` on exports, and its examples must be complete programs that run without throwing. Inline comments only for what the code can't say. Don't reference issues, PRs or CI runs.
- **Tests** check logic. ProseMirror's suites are ported under `tests/` and are the spec; keep them close to the originals. Don't test what the type system or a lint enforces; pin types in `tests/**/*.types.ts` instead. Tests import from `@effect/vitest` or `vite-plus/test`, never `vitest`.

## Before pushing

Run `vp run ci`, or the gates one at a time: `vp check`, `vp run check`, `vp run test:unit`, `vp run test:browser`, `vp run docgen` (builds first), `pnpm audit --audit-level high` (network). Say in the PR body which couldn't run.

CI ([ci.yml](../.github/workflows/ci.yml)) runs `vp run ci` on Node `lts` and `latest`. Workflows pin actions by exact tag, locked to commits by `.github/workflows/actions.lock`: run `gh actions-lock` after changing a `uses:`. `uvx zizmor --offline .github` audits the workflows.

## Changesets

Every change to the published package's behaviour carries a changeset (`vp exec changeset`), including doc-comment changes that reach the emitted `.d.ts` (`patch`). Other docs, CI and tooling changes need none. Never version or publish by hand: the Release workflow opens a "chore: version packages" PR, and merging it publishes ([PUBLISHING.md](PUBLISHING.md)).

## Dependencies

Every external version is in the `pnpm-workspace.yaml` catalog; `package.json` uses `catalog:` / `catalog:peers`. After editing the catalog, run `vp install` and commit `pnpm-lock.yaml`. Dependabot groups the sets that must move together but can't make these moves; make them in a PR from a new branch started from its head (never push to a `dependabot/*` branch, which stops it rebasing), and it closes its own PR once yours merges:

- **Toolchain** (`vite-plus`): run `vp dlx --package=vite-plus@<v> vp migrate --no-interactive` to re-pin `vite` and `vitest`, then drop any `minimumReleaseAgeExclude` it adds, and move the `.devcontainer/devcontainer.json` image tag to the same version. `typescript` / `@typescript/native` move only with an `@effect/tsgo` that supports them.
- **Peers**: raise `catalogs.peers.effect` only when a dependency requires it; that is a breaking change.
