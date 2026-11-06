---
"@thomasfosterau/effect-richtext": minor
---

Catch up with the ProseMirror releases published since the port was taken: prosemirror-model 1.25.12, -transform 1.12.5, -view 1.42.9, -commands 1.7.2, -schema-list 1.6.0, -history 1.5.1 and -markdown 1.13.9.

- **Security:** pasted HTML can no longer attach attributes that the schema's validators reject to the nodes of a `data-pm-slice` context (prosemirror-view 1.42.3).
- **Attribute validation happens when nodes and marks are created.** `NodeType.create` / `MarkType.create` (and their `Unsafe` twins) now run each supplied attribute's `validate` and Effect `Schema`, failing with an `AttributeError`, instead of leaving that to `check()` or `fromJSON`. Defaults are not re-validated.
- Step mapping no longer drops `AttrStep`, `AddNodeMarkStep` and `RemoveNodeMarkStep` when mapped over an insertion at their position (`MapResult` deletion flags are no longer set for pure insertions). Inverting mark steps restores excluded marks exactly, using an internal `"markSet"` step when several steps are needed. Replace fitting no longer drops open content or builds invalid slices, and a `ReplaceAroundStep` whose gap would invert is dropped when mapped.
- The undo history no longer reverts the wrong change after a collaborative rebase that covers more steps than it holds.
- `splitBlock` deletes a non-empty selection before deciding how to split. `splitListItem`, `splitListItemKeepMarks`, `liftListItem` and `sinkListItem` accept an array of item types (`ItemTypes`), and `wrapInList` no longer crashes when lists may start with lists.
- The Markdown serializer no longer emits invalid strong/emphasis delimiters when a mark run is broken up by another mark, and keeps ordered lists that start at 0.
- `Fragment.findDiffStart` / `findDiffEnd` never point inside a surrogate pair. `<body>` parses as a block element. A `DOMOutputSpec` must render an `Element`.
- View: mark views may implement `update(mark)`; node decorations update in linear rather than quadratic time per parent; pasted style sheets are applied before parsing; `handleKeyDown` runs at most once per key press and never during composition; `dragCopies` returning `false` is respected; dragging after a triple click extends the selection by whole blocks; plus the cursor-motion, selection, composition and Android input fixes of prosemirror-view 1.41.8–1.42.9.
- compat: `ReplaceError`'s `name` is `"Error"`, as in prosemirror-model.
