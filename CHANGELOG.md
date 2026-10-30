# effect-richtext

## 0.1.0

### Minor Changes

- [#4](https://github.com/thomasfosterau/effect-richtext/pull/4) [`fd867b4`](https://github.com/thomasfosterau/effect-richtext/commit/fd867b42c40ead920aaf5e9169ecd344ab0e69f5) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Ship the package from `dist/`: every subpath entry (`effect-richtext/model`, `/state`, `/view`, …, `/compat/*`) now resolves to built ESM plus declarations, and the unused `.` entry (there was no `src/index.ts`) is gone. The public error classes (`PositionError`, `ReplaceError`, `StepError`, `StateError`, `ViewError`, `KeymapError`, `MarkdownError`, `MissingDocumentError`, …) are now `Schema.TaggedError` classes with the same tags and `message` field. `EditorView<S, never, never>` is assignable to `EditorView<S, any, any>` again under TypeScript 7.

### Patch Changes

- [#10](https://github.com/thomasfosterau/effect-richtext/pull/10) [`891f563`](https://github.com/thomasfosterau/effect-richtext/commit/891f56385efb4ae95300c3d5acae13fcd4fd95c1) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - `DOMSerializer.renderSpecUnsafe`'s `blockArraysIn` parameter is now typed as the node or mark `Attrs` it is documented to take, instead of `object`.

- [#16](https://github.com/thomasfosterau/effect-richtext/pull/16) [`303f885`](https://github.com/thomasfosterau/effect-richtext/commit/303f88512307630be754db9cefec5f24f1a83a5c) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - JSON now goes through Effect Schema's JSON codec instead of `JSON.parse` / `JSON.stringify`. Behaviour is unchanged except at one edge: copying a slice whose wrapping nodes carry attributes with no JSON form (a `BigInt`, a cycle) now writes an empty `data-pm-slice` context instead of throwing, so the copy still succeeds without the wrapper context.

- [#20](https://github.com/thomasfosterau/effect-richtext/pull/20) [`894abdf`](https://github.com/thomasfosterau/effect-richtext/commit/894abdf7b2955e013bbfe4c6651ec6c02bc36f4a) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Recognise functions with `Predicate.isFunction` rather than `instanceof Function` (input-rule attributes, Markdown token `attrs`, plugin props), so a function from another realm (an iframe's) is treated as a function too.
