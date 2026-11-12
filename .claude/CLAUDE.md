# CLAUDE.md

Claude Code guidance for this repository. The project's conventions, commands and gates are in the files imported below; this file adds only what is specific to Claude Code sessions.

- @../AGENTS.md
- @../CONTRIBUTING.md
- @../README.md

## Sessions

- The SessionStart hook (`.claude/hooks/session-start.sh`) installs the global Vite+ CLI at the catalog's `vite-plus` pin with the official installer (npm-provenance and SHA-512 checked; it needs `vite.plus` and `viteplus.dev` on the environment's allowlist), links `vp` and `vpx` into `~/.local/bin` (the CLI lives under `$VP_HOME` when set, as in the Vite+ container image, else `~/.local/share/vite-plus`), and runs `vp install --frozen-lockfile`. The global `vp` delegates to each checkout's own `vite-plus` (worktrees included); everything else goes through it: `vp exec fallow …` for fallow, `vpx <file>.ts` for scripts. Nothing else is put on PATH, and the hook removes the `fallow` / `tsx` links and the walking `vp` shim earlier versions made. `tsx` is installed only because `@effect/docgen` requires it as a peer and runs it itself; never invoke it directly. If the installer can't run, `vp` falls back to this checkout's `node_modules` copy. It hydrates no secrets; none are needed, and nothing here can publish.
- A PreToolUse hook (`.claude/hooks/fallow-gate.sh`) blocks `git commit` / `git push` when `fallow audit --base origin/trunk` (run as `vp exec fallow`) fails; it runs only in this checkout and its `.claude/worktrees/*`, and anywhere else runs none of that tree's tooling and skips the audit with a notice; it reads the coverage map on disk, so run `vp run test:coverage` first. A PostToolUse hook runs `vp fmt` on every source, JSON, CSS or Markdown file you write or edit.
- Every gate in [Verification](../AGENTS.md#verification) runs in an agent session; the browser tests need `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium` there, and `pnpm audit` needs the network.

## Worktrees

- Agent work uses git worktrees under `.claude/worktrees/`, one per branch, named `issue-<n>-<slug>` for issue-linked work. Start every command that targets a worktree with an explicit `cd` and confirm with `git log -1` before committing. A worktree needs its own `vp install`: the global `vp` (linked into `~/.local/bin` by the SessionStart hook) delegates to the checkout's own `vite-plus`.
