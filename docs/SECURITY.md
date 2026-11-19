# Security

## Reporting a vulnerability

Report privately via [**Report a vulnerability**](https://github.com/thomasfosterau/effect-richtext/security/advisories/new), not a public issue. Include a description, reproduction steps, and the affected version and entry point.

## Scope

The package parses and renders HTML: the DOM parser (`/model`), clipboard handling and the view (`/view`), and the Markdown and HTML helpers. As in ProseMirror, a schema's `parseDOM` / `toDOM` rules decide what markup survives, so parse untrusted content with a schema that admits only what you mean to render. Script execution, or markup a schema does not admit, through those paths is in scope.

## Supply chain

- Publishing uses npm OIDC trusted publishing from a protected, manually approved `release` environment; only that job holds `id-token: write`.
- Privileged release jobs install with `--frozen-lockfile --ignore-scripts`, restore no cache, and publish with `--ignore-scripts`.
- Workflows default to `permissions: {}`, check out without persisted credentials, and pin actions by exact tag, locked to commits by `.github/workflows/actions.lock`.
- Runtime dependencies are `markdown-it`, `rope-sequence` and `w3c-keyname`; `effect` is a peer. pnpm holds new versions for 8 hours, and CI runs `pnpm audit --audit-level high`.
