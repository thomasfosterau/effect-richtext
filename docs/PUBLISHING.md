# Publishing

Releases use [Changesets](https://github.com/changesets/changesets) and npm [trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC); there is no `NPM_TOKEN`.

## Flow

1. A change that affects the published package carries a changeset (`vp exec changeset`).
2. On `trunk`, the [Release](../.github/workflows/release.yml) workflow opens or updates a "chore: version packages" PR (`pnpm run version`: `changeset version`, `vp fmt`, lockfile refresh; `"format": false` in `.changeset/config.json` because Changesets' own formatter detection picks Vite+'s IDE-only `oxfmt` shim).
3. Merging that PR runs `pnpm run release` in the protected `release` environment: build, `pnpm publish --recursive --ignore-scripts` (a no-op when npm already has the version; pnpm does the OIDC exchange itself), `changeset tag`. pnpm attaches provenance only once the repository and package are public.

## One-time setup

1. **Settings → Actions → General**: allow GitHub Actions to create pull requests.
2. **Bootstrap the package**: a trusted publisher needs an existing package, so publish the first version by hand (`vp run build && pnpm publish --access public`).
3. **npm → package → Settings → Trusted Publisher**: GitHub Actions, `thomasfosterau/effect-richtext`, workflow `release.yml`, environment `release`. Remove any automation tokens.
4. **Settings → Environments → `release`**: required reviewer, deployments from `trunk` only.
5. **Protect `trunk`**: require PRs and the `ci (node lts)` and `ci (node latest)` checks.
