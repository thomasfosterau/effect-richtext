# Guides

Longer-form documentation for `@thomasfosterau/effect-richtext`. The package [README](../README.md) has the install line, the entry-point table and a first example; the design decisions are in [DESIGN.md](../DESIGN.md).

- [Extensions](extensions.md): compose schema specs, plugins, keymaps and commands into a typed editor.
- [ProseMirror compatibility](compat.md): run code written against `prosemirror-*` on this package.

Every export also has a doc comment, and the comments on the main exports carry runnable examples. `vp run docgen` renders them as an API reference under `docs/api/`, which is generated and never committed.
