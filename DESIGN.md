# effect-richtext design

`effect-richtext` reimplements the core of the ProseMirror ecosystem (`prosemirror-model`, `-transform`, `-state`, `-view`, `-keymap`, `-commands`) on top of [Effect](https://effect.website) 4. It is a single package; the parts of the toolkit are exposed as subpath modules.

This document records the design decisions agreed for the project and the conventions every module follows.

## Decisions

| Topic | Decision |
| --- | --- |
| Effect version | Effect **4.x** (`effect@^4.0.2`). |
| Effect depth | **Effect everywhere**: every fallible public operation returns an `Effect` with tagged errors. |
| Absent values | Accessors that may not produce a value return **`Option<A>`** (`node.firstChild`, `$pos.nodeAfter`, `match.matchType(t)`, …). |
| Document typing | Schemas are fully typed. Node/mark names are literal unions, attributes are described with Effect `Schema`s, and **content expressions are typed combinators** (`Content.seq`, `Content.oneOrMore`, …) so the allowed children of every node type are known statically. |
| Plugin requirements | Plugins and commands carry their Effect requirements (`R`) in their types; editor state/view accumulate them. |
| Packaging | **One package**, everything (core, extras, ProseMirror compatibility layer) exposed as subpath modules. |
| Tooling | The family's Vite+ toolchain on pnpm 11: `vp check` (Oxfmt + Oxlint with the Effect preset), native `tsc` 7 patched by `@effect/tsgo`, Vitest via `vite-plus/test` + `@effect/vitest` (happy-dom; browser mode with Playwright for view tests), `vp pack` (tsdown), docgen, fallow, Changesets. Commands and gates live in [AGENTS.md](./AGENTS.md). |
| Extras (after core) | Extensions + chainable commands; editing essentials (history, input rules, basic/list schemas, gap/drop cursor, placeholder); reactive bindings (SubscriptionRef/Stream); HTML + Markdown serializers. |

## Module layout

```
src/
  model.ts          barrel for effect-richtext/model
  model/*.ts        implementation
  transform.ts      effect-richtext/transform
  state.ts          effect-richtext/state
  view.ts           effect-richtext/view
  keymap.ts         effect-richtext/keymap
  commands.ts       effect-richtext/commands
  schema-basic.ts   effect-richtext/schema-basic
  schema-list.ts    effect-richtext/schema-list
  test-builder.ts   effect-richtext/test-builder
  history.ts        effect-richtext/history   (undo/redo, uses rope-sequence)
  html.ts           effect-richtext/html      (HTML string helpers, HtmlEnvironment)
  markdown.ts       effect-richtext/markdown  (markdown-it parser + serializer)
  reactive.ts       effect-richtext/reactive  (SubscriptionRef/Stream bindings)
  inputrules.ts     effect-richtext/inputrules  (input rules; handlers may return Option/Effect)
  gapcursor.ts      effect-richtext/gapcursor   (GapCursor selection + plugin, gapCursorCSS)
  dropcursor.ts     effect-richtext/dropcursor  (drop cursor plugin)
  placeholder.ts    effect-richtext/placeholder (placeholder decorations, placeholderCSS)
  view-css.ts       effect-richtext/view-css    (prosemirror-view's stylesheet as viewCSS, injectCSS helpers)
  extensions.ts     effect-richtext/extensions (typed extensions, Editor, chainable commands)
  compat/*.ts       effect-richtext/compat/*  (ProseMirror-compatible facades)
  internal/*.ts     not exported
```

Each public module `src/<name>.ts` re-exports its implementation from `src/<name>/*.ts`. Modules import each other through relative paths (`../model.ts`).

## Conventions

### Fallible operations: `x` and `xUnsafe`

Every fallible public operation comes in two flavours:

- `x(...)`: returns `Effect.Effect<A, E>` where `E` is a union of tagged errors.
- `xUnsafe(...)`: synchronous; throws the same tagged error value.

`Unsafe` variants exist because editors run model code on every keystroke and the ported algorithms are deeply synchronous. Library internals call the `Unsafe` variants (or `@internal` `...OrNull` helpers) and only the public surface is wrapped, using `attempt` from `src/internal/attempt.ts`, which turns expected tagged errors into failures and anything else into defects.

Errors are `Schema.TaggedError` classes with a `message` field, one family per layer (`model/errors.ts`, `transform/errors.ts`, …). Each layer exports a union type and an `is…Error` guard.

### Mutable builders

`Transform` and `Transaction` stay mutable, chainable builders (for performance). Each fallible builder method comes as `tr.x(...)`, a lazy `Effect<this, E>` that applies the change when run, and `tr.xUnsafe(...)`, which applies it immediately and returns `this`. Methods that can't fail for valid input (`addMark`, `removeMark`, `setMeta`, `replaceSelection`, …) are plain chainable methods. `Step.apply` returns a `StepResult` (with `Option` fields), like ProseMirror; `Transform.step` fails with a `StepError`.

### Options

Public accessors return `Option`. Hot internal paths may use `@internal` `…OrNull` twins (e.g. `ContentMatch.matchTypeOrNull`, `ResolvedPos.nodeAfterOrNull`) to avoid allocations; these are not part of the public API.

### Typing

- Every model class is generic over the schema: `Node<Sc, N>`, `Fragment<Sc, N>`, `Mark<Sc, M>`, `NodeType<Sc, N>`, `MarkType<Sc, M>`, `Slice<Sc>`, `ResolvedPos<Sc>`. The defaults (`AnySchema`, all names) make untyped usage work everywhere.
- Name parameters are covariant (`out N`) so `Node<Sc, "image">` is a `Node<Sc>`, and `node.is("image")` narrows.
- `ChildNames<Sc, N>` gives the node names allowed as children of `N`; `NodeAttrs<Sc, N>` / `NodeAttrsInput<Sc, N>` give attributes (input makes defaulted attributes optional).

### Content expressions

```ts
Content.seq("heading", Content.zeroOrMore("block")) // ContentExpr<"heading" | "block">
Content.parse("heading block*") // ContentExpr<string> (untyped, PM syntax)
```

### Attributes

```ts
attrs: {
  src: Schema.String,                                     // required, typed
  alt: { schema: Schema.NullOr(Schema.String), default: null },
  legacy: { default: null, validate: "string|null" }       // PM-style, untyped
}
```

Attribute schemas are checked by `Node.check`, and used to decode/encode JSON (`DocSchema.nodeFromJSON`, `Node.toJSON`, `NodeFromJSON(schema)` codec).

### Commands and plugins (state/view layers)

```ts
type Dispatch<Sc> = (tr: Transaction<Sc>) => Effect.Effect<void>
type Command<Sc, E = never, R = never> = (
  state: EditorState<Sc, any, any>,
  dispatch?: Dispatch<Sc>,
  view?: EditorViewLike // EditorView<any, any, any> | undefined
) => Effect.Effect<boolean, E, R>
```

Plugins are `Plugin<PluginState, Sc, E, R>`. The hooks that run while creating or updating a state (`state.init`, `state.apply`, `state.fromJSON`, `filterTransaction`, `appendTransaction`) may return either a plain value or an `Effect`; `E` and `R` are inferred from them. `EditorState<Sc, R, E>` carries the union of its plugins' `R`/`E` (inferred from the `plugins` tuple by `EditorState.create`), and `state.apply(tr)` returns `Effect<EditorState<Sc, R, E>, E | StateError, R>`. `applyUnsafe`/`createUnsafe` are only callable when `R` is `never`. `EditorState` and `EditorView` carry the union of their plugins' requirements; the view is created inside an Effect that provides them, and runs DOM event handlers with the captured context. Handlers that complete synchronously behave exactly like ProseMirror's; asynchronous ones are forked and treated as handled.

### The view

```ts
const view = yield * EditorView.make(place, { state, handleKeyDown, onError }) // needs Scope | R
view.dispatch(tr) // Effect<void>: runs with the captured context, failures go to onError
view.tryDispatch(tr) // Effect<void, E | StateFailure>
view.dispatchUnsafe(tr) // synchronous, throws failures
```

- `EditorView.make` captures `Effect.context<R>()` and registers `destroy` as a scope finalizer; `EditorView.makeUnsafe(place, props, context?)` is for non-Effect callers (the caller destroys the view).
- Event-handler props (`handleKeyDown`, `handleTextInput`, `handleClick*`, `handlePaste`, `handleDrop`, `handleScrollToSelection`, `handleDOMEvents.*`) return `boolean | void | Effect<boolean, E, R>`. Effects are forked with the captured context and polled: a synchronous result is used as-is, a pending fiber counts as handled, a failure is reported to `onError` (default: `Effect.logError`) and counts as not handled.
- Props receive the view as `EditorView<Sc, any, any>`; plugin props are the view's `EditorProps` (bound to the plugin), and `spec.view` gets the view.
- `nodeViews`/`markViews` are keyed by node/mark name and typed per name.
- Nullable accessors return `Option` (`posAtCoords`, `nodeDOM`); `posAtDOM` fails with a `ViewError` (`posAtDOMUnsafe` throws it).
- Internals (view descs, DOM observer, input handling) are synchronous ports of `prosemirror-view`; DOM-triggered transactions are dispatched through the synchronous path with the captured context.

### Reactive bindings

`effect-richtext/reactive` exposes editor states as `SubscriptionRef`s and `Stream`s, without depending on a UI framework:

```ts
// Headless: a state in a SubscriptionRef, updated by dispatching to it.
const ref = yield * StateRef.make(state) // needs Scope | R (captured for plugin hooks)
yield * ref.dispatch(tr) // Effect<void, E | StateFailure>; also dispatchUnsafe, set, execute(command)

// Following a view (no props or plugins are changed).
const observer = yield * observe(view) // EditorObserver.make(view), needs Scope
observer.isMarkActive("strong") // Stream<boolean>
```

Both share `EditorStreams`: `state` (a read-only ref: `get`, `getUnsafe`, `changes`), `transactions` (hot, `{ tr, transactions, state, prevState }`), `docChanges`, `selection` (deduplicated with `Selection.eq`), `select(f, eq = Equal.equals)`, `isMarkActive`, `isNodeActive` and `canExecute(command)`; the observer adds `focus`. State-like streams start with the current value (SubscriptionRef replay) and only emit changes; `transactions` only carries transactions applied after subscribing. All pubsubs are shut down, and listeners removed, when the creating scope closes, which ends every stream.

The observer uses `view.subscribe(listener)`, a minimal listener hook on `EditorView`: listeners are called after every state update (after the DOM and plugin views) with a `ViewUpdate` (`state`, `prevState`, and the `transactions` of the dispatch that caused it: the dispatched transaction plus appended ones, only the dispatched one with a custom `dispatchTransaction`, none for direct `updateState`/`setProps` calls).

### Extensions (`effect-richtext/extensions`)

A ProseKit-style composition layer on top of the core. It is purely additive (no core module imports it) and unopinionated: no UI, no styling, no required node set.

```ts
const extension = union(defineBasicExtension(), defineCommands({ shout: (s: string) => command }))
const editor = yield * createEditor(extension, { doc: "<p>Hi</p>" })
yield * editor.commands.toggleMark("strong") // "strong" must be a mark of the merged schema
yield * editor.chain().setBlockType("heading", { level: 2 }).insertText("!").run() // one transaction
yield * editor.mount(place) // EditorView.make: needs Scope | R
```

- `Extension<T>` is an immutable tree of facets (`nodes`, `marks`, `plugins`, `keymap`, `commands`). `T` records node specs, mark specs, commands (name → argument tuple, or a `CommandSignature` type lambda for schema-dependent signatures such as `toggleMark<M extends MarkNames<Sc>>`) and the `E`/`R` of plugins, keymaps and commands. `union` intersects spec/command records and unions `E`/`R` (same-name specs intersect at the type level, so they should not have conflicting literal properties).
- Priorities (`Priority.lowest`…`highest`, `withPriority`; inner priorities win) order facets, highest first, then by declaration (depth first): schema node/mark order, plugin and keymap order, and which command wins a name clash. Same-name specs are shallow-merged (attrs merged, higher priority wins). Each keymap facet is its own keymap plugin; `defineBaseKeymap` is `low`, `defineParagraph` is `highest` (default block).
- `createEditor(ext, { doc?, selection? })` returns `Effect<Editor<T>, SchemaDefinitionError | ModelError | StateFailure | E, R>` (`createEditorUnsafe` when `R` is `never`). `doc` may be a node, JSON or HTML.
- `Editor` holds the state (the view's state while mounted). `mount` uses `EditorView.make` and registers a finalizer that unmounts; `unmount` destroys the view early and keeps its last state.
- `editor.commands.x(...)` and `editor.chain()…run()` return `Effect<boolean, E, R>`: dispatched transactions are applied immediately (through `view.tryDispatch` when mounted), plugin failures propagate as `E`, a `StateError` (mismatched transaction) is a defect. `editor.can().x(...)` runs the command without `dispatch`.
- Chains use one shared transaction (TipTap's `ChainableState`): commands receive a state whose `doc`/`selection`/stored marks are the transaction's, and whose `tr` is the shared transaction; a transaction a command builds itself is folded into it. Plugin state is the chain's start state. All commands run; the transaction is dispatched when anything changed, and `run` succeeds with `true` when every command applied. A command named `run` is not chainable.
- Node/mark builders (`editor.nodes.heading({ level: 2 }, "Hi")`, `editor.marks.link({ href })`, `editor.text(s, ...marks)`) are synchronous conveniences that throw like the `Unsafe` variants.

### ProseMirror compatibility layer (`effect-richtext/compat/*`)

`compat/model`, `compat/transform`, `compat/state`, `compat/view`, `compat/keymap` and `compat/commands` expose the API of the corresponding `prosemirror-*` packages, so that code written against ProseMirror can switch its imports (e.g. with a bundler alias) and run unmodified. `compat/orderedmap`, `compat/schema-basic`, `compat/schema-list` and `compat/test-builder` cover the packages those depend on.

- **Facade objects.** Every ProseMirror class is a thin facade over a core object, stored under a private symbol, and every method delegates to the core (using the `Unsafe`/`OrNull` variants). Facades return `null` instead of `Option` and throw ProseMirror's exceptions (`RangeError`, `ReplaceError`, `TransformError`, `SyntaxError` for content expressions) instead of failing with tagged errors.
- **Identity.** Core objects are wrapped on demand (`compat/internal/core.ts`): a factory is registered per core class and the facade is cached in a `WeakMap`, so the same core object always yields the same facade (`doc.child(0) === doc.child(0)`). Arrays (mark sets, child arrays) are cached too, and unwrap back to the original core array. Each compat module exports `toCore` / `fromCore` to move between the two APIs.
- **Specs.** `new Schema(spec)` keeps ProseMirror's `OrderedMap` specs in `schema.spec`, and builds the core schema from translated specs whose callbacks (`toDOM`, `leafText`, `toDebugString`, parse rules' `getContent`/`clearMark`) receive facades. `NodeType.spec` returns the original spec. Content expressions are plain strings (the core reads them as ProseMirror syntax).
- **Subclassing.** A subclass of the facade `Step` or `Selection` gets a core object that calls back into it, so custom steps and selections work in core transforms, the history and the view. Subclasses of built-in steps and selections (`class MyStep extends ReplaceStep`) get an instance of a generated subclass of the core class that calls the facade's overrides; facade methods call the core class's own implementation (`callBase`), so overrides can call `super`. `Step.jsonID` / `Selection.jsonID` register deserializers with the core.
- **Commands and plugins.** ProseMirror commands are plain `(state, dispatch?, view?) => boolean` functions; `fromCoreCommand` / `toCoreCommand` convert to and from core commands, running them synchronously. `new Plugin(spec)` keeps the ProseMirror spec and props (bound to the facade plugin) and creates a core plugin whose state hooks, filters, plugin views and props convert their arguments to facades and their results back (`compat/internal/props.ts`); translations are cached so re-translated props keep their identity.
- **View.** `new EditorView(place, props)` creates the core view with `EditorView.makeUnsafe` and translated props; `someProp`, `props` and `dispatch` follow ProseMirror. Node and mark views returned by ProseMirror-style constructors are adapted with a proxy.
- **Tests.** ProseMirror's own test suites run against the facades with import-only changes: `tests/compat/<package>/*.test.ts` (node project) and `tests/compat/model/dom.browser.test.ts` plus `tests/view/compat-*.test.ts` (browser project). Each file lists any other change in its header comment.

### Tests

- Tests live in `tests/<module>/*.test.ts` and use `@effect/vitest` (`it.effect` for Effect tests, `assert` rather than `expect`). They import the package by name (`effect-richtext/model`), which `vite.config.ts` and `tsconfig.test.json` resolve to `src/`.
- ProseMirror's test suites are ported as faithfully as possible; `tests/utils/ist.ts` reproduces the `ist` helper so ported tests stay close to the originals.
- View tests run in Chromium via Vitest browser mode (`tests/view/**`, the `browser` project).
- Type-level tests live in `tests/**/*.types.ts`: never executed, type-checked by `vp run check`. An `Expect<Equals<A, B>>` alias asserts a type, and each `@ts-expect-error` directive asserts that the statement below it must not compile. A failing call's Effect is discarded with `void` so the Effect language service's floating-Effect diagnostic stays quiet.

ProseMirror is MIT licensed, copyright Marijn Haverbeke and others; ported code and tests retain that notice (see `LICENSE`).
