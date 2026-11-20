# Publishing

Releases use [Changesets](https://github.com/changesets/changesets) and npm [trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC); there is no `NPM_TOKEN`.

## Flow

1. A change that affects the published package carries a changeset (`vp exec changeset`).
2. On `trunk`, the [Release](../.github/workflows/release.yml) workflow opens or updates a "chore: version packages" PR (`pnpm run version`: `changeset version`, `vp fmt`, lockfile refresh; `"format": false` in `.changeset/config.json` because Changesets' own formatter detection picks Vite+'s IDE-only `oxfmt` shim).
3. Merging that PR runs `vp run release` (a `vite.config.ts` task; there is no publish script) in the protected `release` environment: the build, then `vp pm publish --access public --no-git-checks -- --ignore-scripts` (a no-op when npm already has the version; pnpm does the OIDC exchange itself), then `changeset git-tag`, which tags the version and reports the tag to the Changesets action; the action pushes it and creates the GitHub release. A failed publish stops before tagging. pnpm attaches provenance only once the repository and package are public.

`vp run release:dry-run` builds and lists what `vp pm publish` would publish, without publishing or tagging.

## One-time setup

1. **Settings → Actions → General**: allow GitHub Actions to create pull requests.
2. **Bootstrap the package**: a trusted publisher needs an existing package, so publish the first version by hand from a clean `trunk`: `vp install --frozen-lockfile`, `vp run release:dry-run`, then `vp run release`, then `git push origin --tags`.
3. **npm → package → Settings → Trusted Publisher**: GitHub Actions, `thomasfosterau/effect-richtext`, workflow `release.yml`, environment `release`. Remove any automation tokens.
4. **Settings → Environments → `release`**: required reviewer, deployments from `trunk` only.
5. **Protect `trunk`**: require PRs and the `ci (node lts)` and `ci (node latest)` checks.
