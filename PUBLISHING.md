# Publishing & releases

Releases are automated with [Changesets](https://github.com/changesets/changesets) and published to npm via [OIDC trusted publishing](https://docs.npmjs.com/trusted-publishers) — there is no `NPM_TOKEN`. See [SECURITY.md](./SECURITY.md) for the security rationale behind the pipeline. (Adapted from the effect-web library to a single root package.)

## The release flow

1. **Add a changeset with your change.** Run `pnpm changeset`, pick the bump (`patch` / `minor` / `major`) and write a user-facing summary, then commit the generated file alongside your change. Which changes need one is set out in [AGENTS.md](AGENTS.md#branches-and-pull-requests); a doc-comment change that reaches the emitted `.d.ts` takes a `patch`.
2. **Merge to `trunk`.** The [`Release`](./.github/workflows/release.yml) workflow runs and, while changesets are pending, opens or updates a **"chore: version packages"** PR that applies the version bump and rolls the changesets into `CHANGELOG.md`. The version step is `changeset version && vp fmt && pnpm install --lockfile-only`, with `"format": false` in `.changeset/config.json`: Changesets 3 otherwise auto-detects the `oxfmt` binary Vite+ installs and runs it on the new changelog, but that binary is Vite+'s IDE-only shim and exits 1 outside LSP mode. `vp fmt` formats the changelog instead, so the version PR passes `vp check`.
3. **Merge the version PR.** With no changesets left, the workflow builds the package and publishes it to npm via trusted publishing (with provenance once the repository is public — see below), then tags the commit and creates the GitHub release.

The publish step is `pnpm run release`: `vp run build`, then `pnpm publish --access public --no-git-checks --ignore-scripts`, which rewrites the `catalog:` specifiers to concrete ranges and publishes natively: since pnpm 11 `pnpm publish` no longer delegates to the npm CLI, and pnpm itself exchanges the GitHub Actions OIDC token for a short-lived npm token. `--ignore-scripts` keeps every lifecycle script (including this repo's `prepare`) out of the job holding `id-token: write`. Provenance is pnpm's call: with no `pnpm_config_provenance` set it attaches provenance only when the OIDC token reports a public repository **and** the registry reports the package as public, skipping it with an `ERR_PNPM_PROVENANCE_INSUFFICIENT_INFORMATION` warning while the repository is private. `changeset tag` then emits the `New tag:` line the Changesets action uses to push the tag and create the GitHub release.

## Maintainer setup (one-time)

1. **Decide the package name.** The manifest publishes as the unscoped `effect-richtext`; neither `effect-richtext` nor `@thomasfosterau/effect-richtext` exists on npm yet. Renaming later is a breaking change for consumers, so settle it before the first publish.
2. **Allow Actions to open the version PR.** **Settings → Actions → General → Workflow permissions** → enable **"Allow GitHub Actions to create and approve pull requests"**. Without it the built-in `GITHUB_TOKEN` cannot open pull requests, even though the job grants `pull-requests: write`.
3. **Bootstrap the package on npm.** A trusted publisher can only be configured on a package that already exists, so the very first version is published by hand from a clean checkout (`vp run build && pnpm publish --access public`, with an npm login that has publish rights; no `--provenance`, which only CI can generate), or the first `Release` run is given a short-lived granular token via a `NODE_AUTH_TOKEN` step that is removed afterwards.
4. **Configure the trusted publisher** on npmjs.com → the package → **Settings → Trusted Publisher**:
   - Provider: **GitHub Actions**
   - Repository: `thomasfosterau/effect-richtext`
   - Workflow: `release.yml`
   - Environment: `release`

   Then remove any classic automation tokens for the package.

5. **Protect the `release` environment.** **Settings → Environments → `release`** → enable **Required reviewers** (yourself) and restrict deployment to the `trunk` branch, so publishing pauses for manual approval.
6. **Protect `trunk`.** Require pull requests and the passing `ci` check before merge, and disallow direct pushes, so a release can only be triggered by merging the reviewed version PR.
