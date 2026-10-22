# AGENTS.md

`CLAUDE.md` is a symlink to this file. Project conventions live here; personal style preferences live in user memory.

This repo publishes `effect-richtext`, a reimplementation of the core ProseMirror toolkit (`prosemirror-model`, `-transform`, `-state`, `-view`, `-keymap`, `-commands` and the common extras) on Effect 4, as ONE package at the repository root whose parts are subpath entries. ProseMirror's own test suites are the behavioural spec: they are ported under `tests/` and must keep passing. [DESIGN.md](DESIGN.md) is the design note (decisions, the `x` / `xUnsafe` convention, typing, the view, extensions, the compat layer); read it before changing a module.

| Entry | Source | Ported from / purpose |
| --- | --- | --- |
| `effect-richtext/model` | `src/model.ts`, `src/model/` | prosemirror-model (DOM parser / serializer, JSON codecs) |
| `effect-richtext/transform` | `src/transform.ts`, `src/transform/` | prosemirror-transform |
| `effect-richtext/state` | `src/state.ts`, `src/state/` | prosemirror-state |
| `effect-richtext/view`, `/view-css` | `src/view.ts`, `src/view/`, `src/view-css.ts` | prosemirror-view and its stylesheet |
| `effect-richtext/keymap`, `/commands`, `/history`, `/inputrules` | `src/<name>.ts` (+ `src/<name>/`) | the matching prosemirror-\* package |
| `effect-richtext/gapcursor`, `/dropcursor`, `/placeholder` | `src/<name>.ts` | cursors and placeholder decorations |
| `effect-richtext/schema-basic`, `/schema-list`, `/test-builder` | `src/<name>.ts` (+ `src/<name>/`) | the matching prosemirror-\* package |
| `effect-richtext/markdown`, `/html` | `src/markdown.ts`, `src/markdown/`, `src/html.ts` | prosemirror-markdown; HTML string helpers |
| `effect-richtext/reactive` | `src/reactive.ts`, `src/reactive/` | `SubscriptionRef` / `Stream` bindings |
| `effect-richtext/extensions` | `src/extensions.ts`, `src/extensions/` | typed extensions and chainable commands |
| `effect-richtext/compat/*` | `src/compat/` | a ProseMirror-compatible facade over the core |

A new entry is added to `entries` in `vite.config.ts`, to `exports` in `package.json`, to `entry` in `.fallowrc.json` (plus a zone and rule when it is a new layer), and to the tables here and in `README.md`. `src/internal/` and `src/compat/internal/` are never exported.

## Common pitfalls

- **Never edit a version in `package.json`.** Versions live in the `pnpm-workspace.yaml` catalog (`catalogMode: strict` rejects anything else). After editing it, run `pnpm install` and commit `pnpm-lock.yaml`, or CI fails with `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`. `@effect/tsgo`, `@typescript/native` and `vite-plus` move together (the tsgo patch hard-errors at install on an unsupported `tsc` or `oxlint`); read their catalog comments first.
- **`dist/` is the product.** `vp pack` (tsdown) emits one file per source module (`unbundle`) and `exports` points only at `dist/`. Tests import the package by name; `vite.config.ts`'s `resolve.alias` and `tsconfig.test.json`'s `paths` map that name to `src/`, so tests never need a build, and docgen examples (which do) go through `dist/`.
- **`sideEffects` is a list, and it is load-bearing.** `gapcursor` (registers its selection's JSON id), `test-builder` (the `tag` getter) and every `compat/*` module (wrapper registration) run top-level statements; everything else must stay pure declarations so a consumer's bundler can drop it. A new top-level statement means a new entry in `package.json`'s `sideEffects`.
- **Hot paths are synchronous on purpose.** Model, transform and view algorithms run per keystroke: library internals call the `Unsafe` twins or `@internal …OrNull` helpers, and only the public surface is wrapped in `Effect` (DESIGN.md, "Fallible operations"). Do not route an inner loop through `Effect` or a Schema decode.
- **The compat facade mirrors ProseMirror's API exactly.** `src/compat/*` exists so ProseMirror code runs unchanged; its exported names and signatures follow ProseMirror's, not this repo's conventions. ProseMirror's own suites run against it (`tests/compat/`, `tests/view/compat-*`).
- **`effect` is a peer, never a dependency.** Two copies break `Context` / `Layer` / `Schema` identity; the consuming app owns the singleton.
- **`vp run docgen` executes your examples.** `@effect/docgen` compiles every JSDoc `@example` and runs it (`"runExamples": true`), importing the package by name through `dist/`. An example must be complete (import everything it uses), must not use `declare const`, and must not throw.

## Conventions

- **Effect-first, as DESIGN.md records.** Every fallible public operation `x` returns an `Effect` with tagged errors and has a synchronous `xUnsafe` twin that throws the same error value; absent values are `Option`; errors are `Schema.TaggedError` classes with a `message`, one family per layer (`model/errors.ts`, `transform/errors.ts`, …).
- **Optional props and fields are declared `T | undefined`**, never bare `x?: T` where a caller may forward an optional of its own: the repo compiles with `exactOptionalPropertyTypes`.
- **Relative imports carry their `.ts` extension** (`rewriteRelativeImportExtensions`). Modules import each other through relative paths (`../model.ts`); Effect is imported per module (`import * as Option from "effect/Option"`), never from the `"effect"` barrel.
- **Formatting is Oxfmt with this repo's style**: no semicolons, no trailing commas, 120 columns (`fmt` in `vite.config.ts`). The pre-commit hook and the PostToolUse hook apply it.
- **Tests import from `@effect/vitest`** (`it.effect`, `assert`) or `vite-plus/test`, never `vitest`. `tests/<module>/*.test.ts` mirrors the module it covers; ported ProseMirror suites stay as close to the originals as possible (`tests/utils/ist.ts`; `getSome` in `tests/utils/option.ts` unwraps an `Option` or fails the test). `tests/**/*.types.ts` hold compile-time assertions (`Expect<Equals<…>>` and expect-error directives), type-checked by `vp run check`, never executed; a negative type assertion never lives in a runtime test file.
- **Every export has a doc comment** whose first sentence stands alone in a hover, plus `@since` and `@category`; it documents defaults, units, the error channel and the reason for any non-obvious choice.
- **Lint**: the Effect preset (`@mpsuesser/oxlint-plugin-effect` + `@effect/tsgo/oxlint-presets`) is on. The "ported-code allowances" in `vite.config.ts` sit at `warn` with a site count; a new site is a defect, and a rule goes back to `error` when its count reaches zero. Fix findings by changing the code, never with disable comments.

### Module boundaries

`.fallowrc.json` encodes the layering and `fallow` enforces it: `model` imports only `internal`; `transform` adds `model`; `state` and `view` import each other (commands and plugin props take the view) plus the layers below; `commands`, `keymap`, `history`, `schema-list` and the extras (`inputrules`, `gapcursor`, `dropcursor`, `placeholder`, `reactive`) sit on top; `extensions` may use any core module; nothing but `compat` imports `compat`, and nothing in the core imports `extensions`. `fallow guard <files>` shows the rules for a file before you change it. `.fallow-baselines/` records the complexity and duplication the port inherited from ProseMirror (and the compat facade's mirror of the core), so the audit holds new code to the thresholds in `.fallowrc.json` without failing on that inheritance. Re-save a baseline (`fallow health --save-baseline .fallow-baselines/health.json`, `fallow dupes --save-baseline .fallow-baselines/dupes.json`) only to shrink it, never to admit a new finding.

## Commands

- `pnpm install` — dependencies plus the Vite+ git hooks (pre-commit runs `vp staged`: format + lint on staged files) and the `prepare` step that patches the native `tsc` / `oxlint` with `@effect/tsgo`. No pre-push hook: run the gates yourself.
- `vp check` — format + lint (Oxfmt + Oxlint). `vp run check` — the type gate: `src` under `tsconfig.json`, then the tests (including `tests/**/*.types.ts`) under `tsconfig.test.json`. They are different commands.
- `vp run test:unit` — the `node` test project (happy-dom).
- `vp run test:browser` — the `browser` project: prosemirror-view's suites in headless Chromium via Playwright. Needs a Chromium: `vp exec playwright install chromium`, or point `PLAYWRIGHT_CHROMIUM_EXECUTABLE` at an installed one (agent containers: `/opt/pw-browsers/chromium`).
- `vp run build` — `vp pack` → `dist/`.
- `vp run docgen` — builds, then compiles and runs every `@example` against `dist/` and writes the (git-ignored) API reference under `docs/`.
- `vp run test:coverage` — both test projects under one Istanbul map at `coverage/coverage-final.json`, which `fallow audit` reads for exact per-function CRAP scores. Without the map fallow scores every function as uncovered, and any function with cyclomatic complexity ≥ 5 fails the gate on its own.
- `pnpm changeset` — add a changeset.

Invoke everything through `vp` (`vp exec` for a dependency's binary; `vp run <task>` instead of bare `pnpm`). Node and pnpm only: no npm, npx, yarn or bun. The sanctioned non-`vp` invocations: `pnpm install` (and `pnpm install --frozen-lockfile` in CI), `pnpm audit`, `pnpm changeset` / `pnpm publish` on the release path. Single-check variants are in [CONTRIBUTING.md](CONTRIBUTING.md#running-individual-checks).

## Verification

Before you report work as done, run the gates below in order and quote each command with its final pass/fail. If a gate can't run here, say which and why in the PR body; never imply it ran.

1. From a clean install, which is what CI sees: `rm -rf node_modules dist && pnpm install --frozen-lockfile`.
2. `vp check`
3. `vp run check`
4. `vp run test:unit`
5. `vp run test:browser` (needs a Chromium; see Commands)
6. `vp run build`
7. `vp run docgen`
8. `pnpm audit --audit-level high` (network)
9. `vp run test:coverage`, then `fallow audit --format json --quiet --explain --gate-marker agent` (the fallow gate below; not a CI step). The PreToolUse fallow gate audits against `coverage/coverage-final.json` and never refreshes it, so run `test:coverage` first.

Steps 2–8 are CI's required `ci` job, in its order ([ci.yml](.github/workflows/ci.yml)). `CONTRIBUTING.md` and the PR template link here rather than restating the list.

## Branches and pull requests

- Branch off `trunk`; PR against `trunk`; squash-merge with a conventional prefix (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`). Rebase onto `origin/trunk` before opening or updating a PR; never merge `trunk` into your branch (GitHub's Update-branch button merges).
- Agent work uses git worktrees under `.claude/worktrees/`, one per branch, named `issue-<n>-<slug>` for issue-linked work. Start every command that targets a worktree with an explicit `cd` and confirm with `git log -1` before committing. A worktree needs its own `pnpm install`: the linked `vp` re-execs the nearest `node_modules/vite-plus/bin/vp` walking up from cwd.
- Every change to the published package's behaviour carries a changeset (`pnpm changeset`). Changes to doc comments that reach the emitted `.d.ts` take a `patch` changeset; other docs-only changes (READMEs, guidance), CI and tooling need none. Never publish or version by hand: the Release workflow opens the version PR (`chore: version packages`) and the owner merges it. Publishing is npm trusted publishing (OIDC) from the protected `release` environment; there is no `NPM_TOKEN` ([PUBLISHING.md](PUBLISHING.md)).
- Push your branch when a commit is ready. This repo grants no standing approval to open pull requests: open one only when the owner asks for it in the current session.
- GitHub writes go to `thomasfosterau/effect-richtext` only — never to ProseMirror, the consuming applications or the owner's other libraries without the owner's explicit approval for that action in the current session. Pass `-R thomasfosterau/effect-richtext` whenever the cwd might be another checkout. If another repo needs something, say so in the PR body.

## Work tracker

- Issues in `thomasfosterau/effect-richtext` are the backlog: when you find work you can't do now, file an issue rather than leaving a TODO. There is no in-repo backlog file.
- The issue is the spec — read its comments; later comments override the body. Re-verify the issue's code claims against current `trunk` before editing.
- Record decisions and findings as comments on the issue they were found working.
- Stop-and-report is a valid outcome: on a blocker outside the issue's scope, comment the evidence on the issue and stop.
- Scope cut mid-PR becomes a linked issue before merge.

## Effect

Read the installed package before writing Effect code: `node_modules/effect/dist/*.d.ts` (and `node_modules/effect/src`, plus `node_modules/effect/AGENTS.md` / `ai-docs/` where shipped). Never guess at an Effect API.

- The pinned version is the `effect` entry in `pnpm-workspace.yaml`'s catalog; the published peer floor is under `catalogs.peers`. Raising the floor is a breaking change.
- Tagged errors are `Schema.TaggedError<Self>()(tag, fields)` classes.
- Plugins, commands and view props may return Effects; their requirements (`R`) and errors (`E`) are tracked through `EditorState` / `EditorView` types (DESIGN.md, "Commands and plugins"). Keep that inference intact: a change that widens a command's `R` to `any` or drops an `E` is a type regression even when every test passes, and `tests/**/*.types.ts` is where it gets pinned.

## Agent sessions

- The SessionStart hook (`.claude/hooks/session-start.sh`) installs dependencies against the lockfile and puts `vp` (a re-exec shim that prefers the nearest worktree's `node_modules`), `fallow` and `tsx` on PATH for non-interactive shells. It hydrates no secrets; none are needed, and nothing here can publish.
- A PreToolUse hook (`.claude/hooks/fallow-gate.sh`) blocks `git commit` / `git push` when `fallow audit --base origin/trunk` fails; it reads the coverage map on disk, so run `vp run test:coverage` first. A PostToolUse hook runs `vp fmt` on every source, JSON, CSS or Markdown file you write or edit.
- Every gate in [Verification](#verification) runs in an agent session; the browser tests need `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium` there, and `pnpm audit` needs the network.

## Documentation surfaces

`README.md` is both the landing page and the API overview consumers read on npm (it ships in the tarball, so its links are absolute or relative to files that ship); [DESIGN.md](DESIGN.md) is the design note (not published); `CONTRIBUTING.md` carries human setup, hooks and single-check commands; `PUBLISHING.md` the release pipeline and its one-time owner setup; `SECURITY.md` the reporting channel and supply-chain posture. No `docs/` tree is committed (`docs/` is docgen output); decisions go in issue comments.

---

## Fallow local gate

Before any `git commit` or `git push`, run `fallow audit --format json --quiet --explain --gate-marker agent`. If the verdict is `fail`, fix the reported findings before retrying. Treat JSON runtime errors like `{ "error": true, ... }` as non-blocking. Audit defaults to `gate=new-only`: only findings introduced by the current changeset affect the verdict.

## Fallow task map

| When the agent is about to...                                     | Run                                          |
| ----------------------------------------------------------------- | -------------------------------------------- |
| delete an "unused" export or file                                 | `fallow dead-code --trace <file>:<export>`   |
| delete an "unused" dependency                                     | `fallow dead-code --trace-dependency <name>` |
| commit or open a PR                                               | `fallow audit --base <ref>`                  |
| check which architecture rules apply to a file before changing it | `fallow guard <files>`                       |
| understand a finding                                              | `fallow explain <issue-type>`                |
