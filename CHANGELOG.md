# @thomasfosterau/effect-richtext

## 0.4.0

### Minor Changes

- [#120](https://github.com/thomasfosterau/effect-richtext/pull/120) [`b3f2661`](https://github.com/thomasfosterau/effect-richtext/commit/b3f2661e21046b8cb8a710d36312dc29912abc5d) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - `MarkdownSerializer.serialize` now returns `Effect<string, MarkdownError>`, failing in the error channel when strict mode meets a node or mark type with no serializer, like `MarkdownParser.parse`. The throwing version is now `serializeUnsafe`:
  
  ```ts
  // before
  const text = defaultMarkdownSerializer.serialize(doc)
  // after
  const text = yield * defaultMarkdownSerializer.serialize(doc)
  // or, synchronously
  const text = defaultMarkdownSerializer.serializeUnsafe(doc)
  ```

- [#161](https://github.com/thomasfosterau/effect-richtext/pull/161) [`bd79820`](https://github.com/thomasfosterau/effect-richtext/commit/bd798204db46af10ac31b059e235c3ecb5af8844) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - **Breaking:** the core API has no `null`s left. A value that may be absent is an `Option`, and an argument or spec field that may be left out is optional (`x?: T`), never `T | null` or `T | undefined`. The compat facade keeps ProseMirror's `null`s and converts them at the boundary, so code written against `compat/*` is unaffected.
  
  - **Removed `…OrNull` twins.** `ContentMatch.matchTypeOrNull`, `matchFragmentOrNull`, `defaultTypeOrNull`, `fillBeforeOrNull` and `findWrappingOrNull`; `Node.nodeAtOrNull`; `ResolvedPos.nodeAfterOrNull`, `nodeBeforeOrNull`, `marksAcrossOrNull` and `blockRangeOrNull`; `NodeType.createAndFillOrNull` (now `createAndFillOption`); `DOMSerializer.serializeMarkOrNull`; `Mapping.getMirrorOrUndefined`; `Selection.findFromOrNull`; `TextSelection.$cursorOrNull`; `EditorState.storedMarksOrNull`; `GapCursor.findGapCursorFromOrNull`. Use the `Option` accessors. `DOMParser.matchTagOrNull` / `matchStyleOrNull` are now `matchTagIn` / `matchStyleIn`, returning an `Option`.
  - **Fields and results that are now `Option`s:** `StepResult.doc` / `failed`; `MapResult.recover`; `Slice.insertAt`; `ContentMatch.computeWrapping`; `NodeType.markSet`, `defaultAttrs`; `Extension.spec` / `priority`; `EditorView.dragging` (a `ViewDragging`), `domSelection()`, `runEffect()`, `someProp()`, `markCursor`, `cursorWrapper`, `trackWrites` and `lastSelectedViewDesc`; `Decoration.map`; the Markdown parser state's `addNode` / `closeNode` and the serializer state's `closed`.
  - **Hooks that now return an `Option`:** `appendTransaction`, `createSelectionBetween`, `clipboardTextParser`, `SplitNodeType` (`splitBlockAs`), `ParseOptions.ruleFromNode`, and the `getPos` passed to node views and widget decorations. The `decorations` prop returns a `DecorationSource` (`DecorationSet.empty` for none). Input rule handlers return a transaction or an `Option` of one.
  - **`null` arguments removed:** node and mark attributes (`create*`, `DocSchema.node`, `setNodeMarkup`, `setBlockType`, `wrapIn`, `wrapInList`, builders), `Fragment.from()`, `Mark.setFrom()`, `textBetween`, `ResolvedPos` depth arguments, `removeMark`, `Transaction.setStoredMarks()` (call it with no argument to clear), `EditorStateConfig.storedMarks`, `renderSpec`'s namespace, and `ViewPlace` (pass a no-op function for a detached view). `split` / `canSplit` take `typesAfter` as an array of `Option`s; `wrapRangeInList` takes an `Option` transaction.
  - **Other shapes:** a parse rule's `getAttrs` returns `Attrs | boolean` (`true` matches with the rule's own attributes); its `namespace` is an `Option` (absent: any namespace, `None`: no namespace). `DecorationAttrs` values are strings, `DOMSerializer` mark maps leave out the marks they don't render, and `Fragment.toJSON` / `Slice.toJSON` return an empty value rather than `null`.

- [#123](https://github.com/thomasfosterau/effect-richtext/pull/123) [`f963d1d`](https://github.com/thomasfosterau/effect-richtext/commit/f963d1d07b30b85cf852020ee48930e0d22af05a) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - `/Reactive` adds `editorStateAtom(source)` and `selectAtom(source, f, eq?)`: read-only `effect/reactivity` atoms over a `StateRef` or `EditorObserver`, for UIs that render from atoms. Effect still marks the `Atom` API as unstable, so these may change with an Effect minor release.

- [#124](https://github.com/thomasfosterau/effect-richtext/pull/124) [`f777c95`](https://github.com/thomasfosterau/effect-richtext/commit/f777c95497850ba317642a520674c3e69b7884f2) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - `EditorStateConfig` takes a `clock` (default `Date.now`) that `state.tr` stamps `Transaction.time` from. States derived by `apply` and `reconfigure` keep it, and `reconfigure` and `fromJSON` accept one too. Pass a controllable clock to test time-dependent plugins such as the history's `newGroupDelay` grouping.

### Patch Changes

- [#143](https://github.com/thomasfosterau/effect-richtext/pull/143) [`9cf3f99`](https://github.com/thomasfosterau/effect-richtext/commit/9cf3f99761a87f63bc487660e77b6bd84800151e) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Replace the core's `as any` casts with typed code. `ParseRule.skip` now also accepts a DOM node, which the view already passed to parse that node's content instead.

- [#131](https://github.com/thomasfosterau/effect-richtext/pull/131) [`c4483c7`](https://github.com/thomasfosterau/effect-richtext/commit/c4483c7e0a9262e82cdcf41c7e1cd3cb295527ca) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Empty node, mark and command maps in the extension and schema types are now written as an internal `NoKeys` alias instead of `{}`; the types are unchanged.

- [#141](https://github.com/thomasfosterau/effect-richtext/pull/141) [`bcf583f`](https://github.com/thomasfosterau/effect-richtext/commit/bcf583ffd235ae3850035f48f26a09d25278b94c) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Brand every `Schema.TaggedError` class, so error classes with the same fields are no longer structurally interchangeable.

- [#138](https://github.com/thomasfosterau/effect-richtext/pull/138) [`d76b30c`](https://github.com/thomasfosterau/effect-richtext/commit/d76b30cfe6db331de835096b305891121021593d) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - `compat/*` fixes found by running TipTap and ProseKit on the facade: a `Selection` subclass can set `Sub.prototype.visible = false` (as prosemirror-gapcursor does, which failed on import), and commands read state-like objects through their public `doc`, `selection`, `storedMarks` and `tr` (as TipTap's chained commands pass them), instead of silently applying to the original state.

- [#156](https://github.com/thomasfosterau/effect-richtext/pull/156) [`eafcf81`](https://github.com/thomasfosterau/effect-richtext/commit/eafcf81ad971568c9de20862c7ba7346797aecf2) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - `compat/transform`'s `ReplaceStep` now has ProseMirror's static `MAP_BIAS`. Setting it to `-1` keeps an inserting step mapped over an insertion at the same position before that insertion; it reads and writes the core `ReplaceStep.MAP_BIAS`.

- [#126](https://github.com/thomasfosterau/effect-richtext/pull/126) [`d1c9db1`](https://github.com/thomasfosterau/effect-richtext/commit/d1c9db19d7a679df226784fffcb11f2fad01294d) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - `Editor` commands no longer cast away the error channel of the dispatch they receive. A dispatch whose plugins fail now records the failure, skips the command's later dispatches, and fails the command when it finishes, as `StateRef.execute` already does. Before, the failure cut the command short partway through.

- [#152](https://github.com/thomasfosterau/effect-richtext/pull/152) [`6e8a98b`](https://github.com/thomasfosterau/effect-richtext/commit/6e8a98b275db78bff12adeb696f427d3f8e205aa) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Replace imperative loops with Effect `Array` and `Record` helpers across the package, keeping plain loops only on benchmarked hot paths. No API changes.

- [#125](https://github.com/thomasfosterau/effect-richtext/pull/125) [`d1bfb9d`](https://github.com/thomasfosterau/effect-richtext/commit/d1bfb9d81eceb02a8ba80ecb2c16485d479d35d9) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - `MarkdownSerializerState.getEnclosingWhitespace` now returns the named `EnclosingWhitespace` type (exported from `/Markdown`), with the same shape as before.

- [#147](https://github.com/thomasfosterau/effect-richtext/pull/147) [`2d44a16`](https://github.com/thomasfosterau/effect-richtext/commit/2d44a16a7488c66c17f49527822f955faf4e99fa) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Code that used to fail with a `TypeError` on a missing value now checks for it. Commands return `false`, view and DOM helpers skip the step or fall back, and broken invariants throw the layer's own error (`TransformError`, `StepError`, `SelectionError`, `ViewError`, `MarkdownError`, `PositionError`) with a message. A parse rule whose `contentElement` selector matches nothing now parses the whole element.

- [#127](https://github.com/thomasfosterau/effect-richtext/pull/127) [`98f60e1`](https://github.com/thomasfosterau/effect-richtext/commit/98f60e1bf9580493bb0a65406dd63ad8d7c03402) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - `DOMOutputSpec` now includes `string`, as ProseMirror's does. A string renders as a text node wherever a spec is rendered. Before, a string was accepted only at the top level of `renderSpec`, and the default `text` serializer cast its string to fit the type.

- [#130](https://github.com/thomasfosterau/effect-richtext/pull/130) [`a010663`](https://github.com/thomasfosterau/effect-richtext/commit/a01066315c1cfd4ffbc0f92514c219c9af6b1c3f) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Internal: replace the remaining `typeof` checks with `Predicate` guards. No behaviour changes.

- [#142](https://github.com/thomasfosterau/effect-richtext/pull/142) [`0254344`](https://github.com/thomasfosterau/effect-richtext/commit/02543449d89923fe569af42d8f27ac3c51033ad6) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Rename shadowing locals and parameters, including `ContentExpr`'s type parameter (now `Names`) and the parameters of `TestBuilder.eq`. No behaviour changes.

- [#129](https://github.com/thomasfosterau/effect-richtext/pull/129) [`054116a`](https://github.com/thomasfosterau/effect-richtext/commit/054116a11106b445cd6e9ce1635934f885665efb) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - `CommandSignature.signature` now returns `this["Return"]` instead of `unknown`, so the signature's return type is the one the signature declares.

- [#151](https://github.com/thomasfosterau/effect-richtext/pull/151) [`d2a3df7`](https://github.com/thomasfosterau/effect-richtext/commit/d2a3df7d65c986a68a2299e87a1712725d8f0482) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Internals of the commands, history, drop cursor, placeholder, input rules, state, Markdown and extensions modules use `Option` instead of `null` or `undefined`. The history state's `@internal` `prevRanges` is now an `Option`.

- [#122](https://github.com/thomasfosterau/effect-richtext/pull/122) [`378f859`](https://github.com/thomasfosterau/effect-richtext/commit/378f859bb8e206992aef7dc4f11fe72c9e1ce7ca) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - `EditorState.fromJSON` now rejects an array with "Invalid input for EditorState.fromJSON", and `Selection.fromJSON` rejects a non-string `type` with "Invalid input for Selection.fromJSON", instead of failing later with a less specific error.

- [#149](https://github.com/thomasfosterau/effect-richtext/pull/149) [`8b40323`](https://github.com/thomasfosterau/effect-richtext/commit/8b4032308d86cf3abbe094f4942d2d32067a46f2) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Type assertions are justified or removed throughout. `DOMParser` matches elements with the standard `Element.matches` only (no vendor-prefixed fallbacks), and the drop cursor no longer throws when the node beside it renders to a non-element.

- [#133](https://github.com/thomasfosterau/effect-richtext/pull/133) [`c50d829`](https://github.com/thomasfosterau/effect-richtext/commit/c50d8296c6f4f2796744041cd869cbcc286a2a01) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - `Mark.sameSet` (core and compat) and `DocSchema.make` / `makeUnsafe` now declare `this: void`. They can be passed around unbound, as `Model.make` already does.

- [#155](https://github.com/thomasfosterau/effect-richtext/pull/155) [`6812a51`](https://github.com/thomasfosterau/effect-richtext/commit/6812a5189c3519e9031e7099503b5ec31ce5d87a) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Replace unsafe type assertions with type guards where one can check the value: DOM nodes, shadow roots, mouse and drag events, Safari's composed selection ranges, and DOM output specs. Synthesised key events are now real `KeyboardEvent`s, and `coordsAtPos` fails with a `ViewError`, rather than a `TypeError`, if it meets a non-element where it expects one.

- [#128](https://github.com/thomasfosterau/effect-richtext/pull/128) [`4153f37`](https://github.com/thomasfosterau/effect-richtext/commit/4153f37bb64a617ae408fd9771a3578ee103c58d) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - `EditorStateConfig.clock` now defaults to Effect's default `Clock` rather than to `Date.now`; both read the same time. The view's input handling also reads timestamps from the state's clock, so a clock you pass in drives its timing checks (such as composition and key timing) as well as `Transaction.time`.

## 0.3.0

### Minor Changes

- [#103](https://github.com/thomasfosterau/effect-richtext/pull/103) [`58e8c66`](https://github.com/thomasfosterau/effect-richtext/commit/58e8c663074c13b42b3f9c0699e015e83c1faa79) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Adopt Effect's module layout. Each module now has a PascalCase subpath, and the package root re-exports each one as a namespace:
  
  ```ts
  import { EditorState } from "@thomasfosterau/effect-richtext/State"
  // or
  import { State } from "@thomasfosterau/effect-richtext"
  State.EditorState.create({ schema })
  ```
  
  | 0.2 subpath                                            | New subpath                                           |
  | ------------------------------------------------------ | ----------------------------------------------------- |
  | `/model`, `/transform`, `/state`, `/view`, `/view-css` | `/Model`, `/Transform`, `/State`, `/View`, `/ViewCss` |
  | `/keymap`, `/commands`, `/history`, `/inputrules`      | `/Keymap`, `/Commands`, `/History`, `/InputRules`     |
  | `/gapcursor`, `/dropcursor`, `/placeholder`            | `/GapCursor`, `/DropCursor`, `/Placeholder`           |
  | `/schema-basic`, `/schema-list`, `/test-builder`       | `/SchemaBasic`, `/SchemaList`, `/TestBuilder`         |
  | `/markdown`, `/html`, `/reactive`, `/extensions`       | `/Markdown`, `/Html`, `/Reactive`, `/Extensions`      |
  
  Migration: replace each lowercase subpath in your imports with its PascalCase name. The lowercase subpaths still resolve to the same files in this release, but are deprecated and will be removed in the next breaking release. `GapCursor` and `TestBuilder` register state when imported, so they are only on their own subpaths, not on the root. `compat/*` is unchanged.

### Patch Changes

- [#98](https://github.com/thomasfosterau/effect-richtext/pull/98) [`f080d3f`](https://github.com/thomasfosterau/effect-richtext/commit/f080d3fff280d0ef218fdd4d749eac48a735562b) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - `html.serialize`, `html.parse`, `html.parseSlice`, `StateRef.make` and `EditorObserver.make` are now `Effect.fn` functions, so each run opens a tracing span named after the function and adds it to stack traces. Signatures are unchanged.

- [#98](https://github.com/thomasfosterau/effect-richtext/pull/98) [`2e7f120`](https://github.com/thomasfosterau/effect-richtext/commit/2e7f1204f2f9fdc3bca989d435c11411a49013cd) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - `isModelError` is now `Schema.is` of the union of the model error classes, so it recognises instances of those classes only. Before, any object whose `_tag` named a model error passed.

- [#98](https://github.com/thomasfosterau/effect-richtext/pull/98) [`354a4c7`](https://github.com/thomasfosterau/effect-richtext/commit/354a4c7758b2bd3bc2469dd0e68c945fc7e4c815) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Export `NodeJSONSchema` from `/model`: the Effect `Schema` for a node's JSON shape, annotated with the `NodeJSON` identifier so `Schema.toJsonSchemaDocument` can derive a JSON Schema for stored documents.

- [#95](https://github.com/thomasfosterau/effect-richtext/pull/95) [`aeef354`](https://github.com/thomasfosterau/effect-richtext/commit/aeef354faad52b6ff0004011900ac53f2281f9d2) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - `DocSchema.text` / `textUnsafe` now return a `TextNode` typed by the schema they are called on (`TextNode<this>`), so generic code holding a schema `Sc` gets a `Node<Sc>` without a cast. Concrete schemas see the same type as before.

- [#98](https://github.com/thomasfosterau/effect-richtext/pull/98) [`b61cef9`](https://github.com/thomasfosterau/effect-richtext/commit/b61cef979433c9f1c9671d313620a27da5216b0c) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - `EditorView.destroy` (and closing the scope of `EditorView.make`) now interrupts handler and dispatch effects that are still running in the background, instead of letting them run against the destroyed view. An effect interrupted this way is not reported to `onError`.

## 0.2.1

### Patch Changes

- [#86](https://github.com/thomasfosterau/effect-richtext/pull/86) [`bc5eefb`](https://github.com/thomasfosterau/effect-richtext/commit/bc5eefbed752fdbdc73b9af172ae0f37b059d2fb) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - `EditorState.apply` / `applyTransaction` (and their `Unsafe` twins) now run each plugin hook once per transaction. When a hook returned an Effect, they used to start over on the effectful path and run the hooks before it a second time; they now continue from that hook, as `create` already did. `reconfigureUnsafe` likewise stays synchronous until a hook returns an Effect.

## 0.2.0

### Minor Changes

- [#63](https://github.com/thomasfosterau/effect-richtext/pull/63) [`ab4dca7`](https://github.com/thomasfosterau/effect-richtext/commit/ab4dca7968a878519fd291791724a3d42e70e092) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - `editor.chain()…run` is now an `Effect`, not a function returning one: write `yield* editor.chain().toggleMark("em").run` (no call parentheses). An Effect is already lazy, so the wrapping function added nothing.

### Patch Changes

- [#56](https://github.com/thomasfosterau/effect-richtext/pull/56) [`78d7ec9`](https://github.com/thomasfosterau/effect-richtext/commit/78d7ec9139e95c3549e7ec20c3a7de2e287eca33) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Ship `CHANGELOG.md` in the npm tarball, so the release notes can be read from `node_modules`.

- [#64](https://github.com/thomasfosterau/effect-richtext/pull/64) [`c300a33`](https://github.com/thomasfosterau/effect-richtext/commit/c300a338efdef63981432ac4a993c97377438580) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Doc comments on the model, transform, state, commands, history, keymap, markdown, html, schema and test-builder entries now carry runnable `@example`s.

- [#63](https://github.com/thomasfosterau/effect-richtext/pull/63) [`8d887fe`](https://github.com/thomasfosterau/effect-richtext/commit/8d887fe92ac9cbbd8f59b516a76aaf48348b335f) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - The view's `editable` prop is read as the boolean its type declares: any falsy result makes the view read-only, where before only `false` did. The compat facade keeps ProseMirror's rule (only `false` is "not editable"). Pasted-text transforms, command results and decoration attributes are likewise passed through without re-coercion.

- [#66](https://github.com/thomasfosterau/effect-richtext/pull/66) [`1aa281c`](https://github.com/thomasfosterau/effect-richtext/commit/1aa281c3b3f5c49ba6f56aba917cc55106246f90) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Heading `level`, ordered-list `order` and the Markdown schema's equivalents are now declared with `Schema.Int`, so decoding rejects non-integer and non-finite values (`NaN`, `Infinity`) that were previously accepted.

## 0.1.0

### Minor Changes

- [#27](https://github.com/thomasfosterau/effect-richtext/pull/27) [`d6dc32d`](https://github.com/thomasfosterau/effect-richtext/commit/d6dc32d3b696972b36a12a2387ef36b44d818055) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Initial release: an Effect 4 reimplementation of the core ProseMirror toolkit as one package with subpath entries: `@thomasfosterau/effect-richtext/model`, `/transform`, `/state`, `/view` (with `/view-css`), `/keymap`, `/commands`, `/history`, `/inputrules`, `/gapcursor`, `/dropcursor`, `/placeholder`, `/schema-basic`, `/schema-list`, `/test-builder`, `/markdown`, `/html`, `/reactive`, `/extensions`, and a ProseMirror-compatible facade under `/compat/*`. ProseMirror's own test suites are ported and pass against both the core and the facade.

- [#36](https://github.com/thomasfosterau/effect-richtext/pull/36) [`7e3d56c`](https://github.com/thomasfosterau/effect-richtext/commit/7e3d56c6a2418c1044c70cac47b72fde126bf8fe) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Mark constructors no longer accept `null` for "no attributes": omit the argument, or pass `undefined`. This covers `MarkType.create` / `createUnsafe`, `DocSchema.mark` / `markUnsafe`, and `toggleMark`'s `attrs` parameter, which now defaults to `undefined`. The compat facade keeps ProseMirror's `null` (`MarkType.create(null)`, `Schema.mark(name, null)`, `toggleMark(type, null)`) and maps it to `undefined`.

- [#35](https://github.com/thomasfosterau/effect-richtext/pull/35) [`f8d4ba9`](https://github.com/thomasfosterau/effect-richtext/commit/f8d4ba90a37d6c9df50a686a1b9ca232e82f603d) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Tighten the document schema's types. These are type-level changes that may reject code that compiled before; runtime behaviour is unchanged.
  
  - Node and mark constructors (`NodeType.create*`, `MarkType.create*`, `DocSchema.node` / `mark` and their `Unsafe` twins) require the attributes argument when the type has an attribute without a default, so `schema.nodes.image.createUnsafe()` no longer compiles when `src` is required. `NodesWithOptionalAttrs<Sc>` / `MarksWithOptionalAttrs<Sc>` name the types that may omit it.
  - `schema.nodes[name]` / `schema.marks[name]` for a name the schema does not declare is typed `| undefined`.
  - `DocSchema.make` / `makeUnsafe` check specs with literal names at compile time (`SchemaSpecCheck`). An unknown content, `marks` or `excludes` reference fails to compile. So does a missing top or `text` node, a name used by both a node and a mark, an attribute `default` that is not a value of its `schema`, or an unknown `validate` type name. Untyped (`NodeSpecs`) specs keep the runtime check only.
  - An attribute's type follows its `validate` type names (`"string|null"` is `string | null`). An attribute with no `schema`, `validate` string or non-null `default` is `unknown` instead of `any`.
  - `ContentMatch.compile` accepts node type tables with missing entries. The new `MarksInput<Sc>` type names the marks parameter of node constructors.

- [#4](https://github.com/thomasfosterau/effect-richtext/pull/4) [`fd867b4`](https://github.com/thomasfosterau/effect-richtext/commit/fd867b42c40ead920aaf5e9169ecd344ab0e69f5) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Ship the package from `dist/`: every subpath entry (`@thomasfosterau/effect-richtext/model`, `/state`, `/view`, …, `/compat/*`) now resolves to built ESM plus declarations, and the unused `.` entry (there was no `src/index.ts`) is gone. The public error classes (`PositionError`, `ReplaceError`, `StepError`, `StateError`, `ViewError`, `KeymapError`, `MarkdownError`, `MissingDocumentError`, …) are now `Schema.TaggedError` classes with the same tags and `message` field. `EditorView<S, never, never>` is assignable to `EditorView<S, any, any>` again under TypeScript 7.

- [#28](https://github.com/thomasfosterau/effect-richtext/pull/28) [`3815868`](https://github.com/thomasfosterau/effect-richtext/commit/38158680a56860214eb605b05200d1b3f6801107) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Catch up with the ProseMirror releases published since the port was taken: prosemirror-model 1.25.12, -transform 1.12.5, -view 1.42.9, -commands 1.7.2, -schema-list 1.6.0, -history 1.5.1 and -markdown 1.13.9.
  
  - **Security:** pasted HTML can no longer attach attributes that the schema's validators reject to the nodes of a `data-pm-slice` context (prosemirror-view 1.42.3).
  - **Attribute validation happens when nodes and marks are created.** `NodeType.create` / `MarkType.create` (and their `Unsafe` twins) now run each supplied attribute's `validate` and Effect `Schema`, failing with an `AttributeError`, instead of leaving that to `check()` or `fromJSON`. Defaults are not re-validated.
  - Step mapping no longer drops `AttrStep`, `AddNodeMarkStep` and `RemoveNodeMarkStep` when mapped over an insertion at their position (`MapResult` deletion flags are no longer set for pure insertions). Inverting mark steps restores excluded marks exactly, using an internal `"markSet"` step when several steps are needed. Replace fitting no longer drops open content or builds invalid slices, and a `ReplaceAroundStep` whose gap would invert is dropped when mapped.
  - The undo history no longer reverts the wrong change after a collaborative rebase that covers more steps than it holds.
  - `splitBlock` deletes a non-empty selection before deciding how to split. `splitListItem`, `splitListItemKeepMarks`, `liftListItem` and `sinkListItem` accept an array of item types (`ItemTypes`), and `wrapInList` no longer crashes when lists may start with lists.
  - The Markdown serializer no longer emits invalid strong/emphasis delimiters when a mark run is broken up by another mark, and keeps ordered lists that start at 0.
  - `Fragment.findDiffStart` / `findDiffEnd` never point inside a surrogate pair. `<body>` parses as a block element. A `DOMOutputSpec` must render an `Element`.
  - View: mark views may implement `update(mark)`; node decorations update in linear rather than quadratic time per parent; pasted style sheets are applied before parsing; `handleKeyDown` runs at most once per key press and never during composition; `dragCopies` returning `false` is respected; dragging after a triple click extends the selection by whole blocks; plus the cursor-motion, selection, composition and Android input fixes of prosemirror-view 1.41.8–1.42.9.
  - compat: `ReplaceError`'s `name` is `"Error"`, as in prosemirror-model.

### Patch Changes

- [#30](https://github.com/thomasfosterau/effect-richtext/pull/30) [`2cb1a37`](https://github.com/thomasfosterau/effect-richtext/commit/2cb1a37b7905aff38efac1982430b6a5a7e32177) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Speed up complex editing workloads in the core:
  
  - Classes compile their fields as constructor assignments (`useDefineForClassFields: false`), which makes building nodes, fragments, marks, resolved positions and steps cheaper.
  - `EditorState.createUnsafe` runs plugin `init` hooks synchronously unless one returns an Effect. Each hook still runs once.
  - Attributes whose Schema has no transformation skip the Schema codec in `toJSON`. In `fromJSON` they skip it once the value passes the Schema's guard.
  - A keydown that no keymap binds settles without forking a fiber.

- [#29](https://github.com/thomasfosterau/effect-richtext/pull/29) [`913f050`](https://github.com/thomasfosterau/effect-richtext/commit/913f050f4c75297b24ca2e418388b9326f1d78b7) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - `Node.fromJSON` / `DocSchema.nodeFromJSON` no longer re-check attributes their `Schema` has just decoded (roughly 10% faster on attribute-heavy documents). A `ReplaceError` for content that doesn't fit its node again names that content (`Invalid content for node paragraph: <…>`); the compat facade passes the same message through.

- [#45](https://github.com/thomasfosterau/effect-richtext/pull/45) [`4dab935`](https://github.com/thomasfosterau/effect-richtext/commit/4dab935aad16256f3c656a100d949b25343e3a6e) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - The `effect` peer range is now `^4.0.0` (was `^4.0.2`), per the peer-range policy: no dependency needs more, and the package's checks, unit and browser suites pass against effect 4.0.0. Only the range widens; no code changes.

- [#10](https://github.com/thomasfosterau/effect-richtext/pull/10) [`891f563`](https://github.com/thomasfosterau/effect-richtext/commit/891f56385efb4ae95300c3d5acae13fcd4fd95c1) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - `DOMSerializer.renderSpecUnsafe`'s `blockArraysIn` parameter is now typed as the node or mark `Attrs` it is documented to take, instead of `object`.

- [#16](https://github.com/thomasfosterau/effect-richtext/pull/16) [`303f885`](https://github.com/thomasfosterau/effect-richtext/commit/303f88512307630be754db9cefec5f24f1a83a5c) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - JSON now goes through Effect Schema's JSON codec instead of `JSON.parse` / `JSON.stringify`. Behaviour is unchanged except at one edge: copying a slice whose wrapping nodes carry attributes with no JSON form (a `BigInt`, a cycle) now writes an empty `data-pm-slice` context instead of throwing, so the copy still succeeds without the wrapper context.

- [#27](https://github.com/thomasfosterau/effect-richtext/pull/27) [`b60dd1d`](https://github.com/thomasfosterau/effect-richtext/commit/b60dd1d2d7365aa71deb887970a5c581c5ea89fe) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - `Step.fromJSON` now rejects a non-string `stepType` as invalid input (`JSONError` "Invalid input for Step.fromJSON") instead of looking it up as a stringified key; a string `stepType` with no registered step still reports "No step type … defined". Error messages that list attribute types or marks now join them explicitly (the text is unchanged).

- [#20](https://github.com/thomasfosterau/effect-richtext/pull/20) [`894abdf`](https://github.com/thomasfosterau/effect-richtext/commit/894abdf7b2955e013bbfe4c6651ec6c02bc36f4a) Thanks [@thomasfosterau](https://github.com/thomasfosterau)! - Recognise functions with `Predicate.isFunction` rather than `instanceof Function` (input-rule attributes, Markdown token `attrs`, plugin props), so a function from another realm (an iframe's) is treated as a function too.
