# AGENTS.md

Read [README.md](README.md) and [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) first; [docs/DESIGN.md](docs/DESIGN.md) before changing a module.

- You may open PRs in this repo. Out-of-scope work you spot goes in an issue; then move on. Use the GitHub MCP tools or `gh`.
- Use Effect idioms and Effect v4's own modules; adapt non-Effect APIs at the edge.

## Pitfalls

- **ProseMirror's ported suites are the spec.** The `compat/*` facade mirrors ProseMirror's API exactly (names, `null`, exceptions), not this repo's conventions. The core may diverge where `compat/*` can't observe it.
- **Hot paths stay synchronous.** Don't route model, transform or view inner loops through `Effect` or a Schema decode.
- **Type inference is API.** Widening a command's `R` to `any` or dropping an `E` is a regression even when tests pass; pin it in `tests/**/*.types.ts`.
- **Never bulk-autofix** `typescript/no-unnecessary-type-assertion` / `-type-arguments`: tsrs disagrees with the `check` task's tsc. Fix by hand against `vp run check`.
- **Browser tests** need Chromium; in agent containers set `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium`.

## Pull requests

- **Write the PR body with the `pr` skill** from Matt Pocock's skills (`mattpocock-skills:pr`), filling in the repository's pull request template where there is one.
- **Resolve merge conflicts before you hand a PR over.** Rebase onto `origin/trunk` and push; a PR that conflicts with `trunk` isn't finished.
- **Mark the PR ready for review as soon as the initial draft is finished.** Don't wait for CI to run, for reviews, or for the owner to do it. Keep fixing CI failures and review findings on the ready PR.

## Fallow

- `vp install` links the `fallow` skill into `.claude/skills/fallow` from the installed package (approved under `permissions` in `pnpm-workspace.yaml`); the repository's own fallow rules are in [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md).
