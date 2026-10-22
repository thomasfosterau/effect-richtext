# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities privately via GitHub's [**Report a vulnerability**](https://github.com/thomasfosterau/effect-richtext/security/advisories/new) button (Security → Advisories), **not** through public issues.

You can expect an initial response within a few days. Please include a description, reproduction steps, and the affected version and entry point (`effect-richtext/<module>`).

## Supply-chain hardening

This package is published with a hardened, automated pipeline designed to resist supply-chain attacks (e.g. self-propagating npm worms that steal credentials and publish trojanized versions):

- **No long-lived npm token.** Releases use npm [**OIDC Trusted Publishing**](https://docs.npmjs.com/trusted-publishers): GitHub Actions proves its identity to npm with a short-lived, workflow-bound OIDC token. There is no `NPM_TOKEN` secret to steal from CI.
- **Provenance.** Once the source repository is public, every version the release workflow publishes carries [npm provenance](https://docs.npmjs.com/generating-provenance-statements), cryptographically linking the artifact to the exact source commit and workflow. Provenance is only attached when the source repository and the package are both public, so while this repository is private `pnpm publish` skips it with a warning.
- **Install scripts disabled in the release job.** The release workflow installs dependencies with `pnpm install --frozen-lockfile --ignore-scripts`, and turns off pnpm 11's `verify-deps-before-run` for that job (`pnpm_config_verify_deps_before_run: "false"`) so a later `pnpm run` cannot silently re-install with scripts; a compromised (transitive) dependency cannot execute install hooks in the privileged publish job. The publish itself runs as `pnpm publish --ignore-scripts`, so no lifecycle script (`prepublishOnly`, `prepack`, …) runs there either. No unpinned tooling is installed there: pnpm (pinned by `packageManager`) performs the OIDC exchange itself, so npm is never upgraded in the job. CI runs the repo's own `prepare` (the `@effect/tsgo` patch the type gate needs) but only ever holds read permissions.
- **Pinned actions.** All GitHub Actions are pinned to full commit SHAs, so a hijacked tag cannot inject malicious workflow code.
- **Least privilege.** Workflows default to `permissions: {}`; each job opts into only the scopes it needs. CI checks out with `persist-credentials: false`.
- **Small runtime surface.** The package's runtime dependencies are `markdown-it`, `rope-sequence` and `w3c-keyname`; `effect` is a peer the consuming application owns. `pnpm audit --audit-level high` runs in CI.
- **Manual approval gate.** Publishing runs in a protected `release` environment that requires manual approval.
- **Locked dependencies with a cooling-off period.** Installs use `pnpm install --frozen-lockfile` against the committed `pnpm-lock.yaml`; `minimumReleaseAge` holds newly published third-party versions for a day before pnpm will install them; Dependabot proposes updates for review with the same cooldown.

## Release pipeline

The publishing pipeline and its one-time maintainer setup (trusted publisher, protected `release` environment, branch protection) are documented in [PUBLISHING.md](./PUBLISHING.md).

## Scope

`effect-richtext` renders and parses HTML: the DOM parser (`effect-richtext/model`), clipboard handling and the view (`effect-richtext/view`), and the Markdown and HTML helpers. A schema's `parseDOM` / `toDOM` rules decide what markup survives, as in ProseMirror; content from an untrusted source should be parsed with a schema that admits only the nodes, marks and attributes you mean to render. A way to get script execution, or markup a schema does not admit, through those paths is in scope for a report.
