---
"@thomasfosterau/effect-richtext": minor
---

Initial release: an Effect 4 reimplementation of the core ProseMirror toolkit as one package with subpath entries: `@thomasfosterau/effect-richtext/model`, `/transform`, `/state`, `/view` (with `/view-css`), `/keymap`, `/commands`, `/history`, `/inputrules`, `/gapcursor`, `/dropcursor`, `/placeholder`, `/schema-basic`, `/schema-list`, `/test-builder`, `/markdown`, `/html`, `/reactive`, `/extensions`, and a ProseMirror-compatible facade under `/compat/*`. ProseMirror's own test suites are ported and pass against both the core and the facade.
