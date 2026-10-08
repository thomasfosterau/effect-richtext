# effect-richtext design

`effect-richtext` reimplements the core of the ProseMirror ecosystem
(`prosemirror-model`, `-transform`, `-state`, `-view`, `-keymap`, `-commands`)
on top of [Effect](https://effect.website) 4. It is a single package; the parts of
the toolkit are exposed as subpath modules.

This document records the design decisions agreed for the project and the
conventions every module follows.

## Decisions

| Topic               | Decision                                                                                                                                                                                                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Effect version      | Effect **4.x** (`effect@^4.0.2`).                                                                                                                                                                                                                                       |
| Effect depth        | **Effect everywhere**: every fallible public operation returns an `Effect` with tagged errors.                                                                                                                                                                          |
| Absent values       | Accessors that may not produce a value return **`Option<A>`** (`node.firstChild`, `$pos.nodeAfter`, `match.matchType(t)`, …).                                                                                                                                           |
| Document typing     | Schemas are fully typed. Node/mark names are literal unions, attributes are described with Effect `Schema`s, and **content expressions are typed combinators** (`Content.seq`, `Content.oneOrMore`, …) so the allowed children of every node type are known statically. |
| Plugin requirements | Plugins and commands carry their Effect requirements (`R`) in their types; editor state/view accumulate them.                                                                                                                                                           |
| Packaging           | **One package**, everything (core, extras, ProseMirror compatibility layer) exposed as subpath modules.                                                                                                                                                                 |
| Tooling             | Effect-style: pnpm, `tsc -b`, Vitest + `@effect/vitest` (happy-dom; Vitest browser mode with Playwright for view tests), oxlint + dprint, docgen, Changesets, tstyche.                                                                                                  |
| Extras (after core) | Extensions + chainable commands; editing essentials (history, input rules, basic/list schemas, gap/drop cursor, placeholder); reactive bindings (SubscriptionRef/Stream); HTML + Markdown serializers.                                                                  |

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
  internal/*.ts     not exported
```

Each public module `src/<name>.ts` re-exports its implementation from
`src/<name>/*.ts`. Modules import each other through relative paths (`../model.ts`).

## Conventions

### Fallible operations: `x` and `xUnsafe`

Every fallible public operation comes in two flavours:

- `x(...)`: returns `Effect.Effect<A, E>` where `E` is a union of tagged errors.
- `xUnsafe(...)`: synchronous; throws the same tagged error value.

`Unsafe` variants exist because editors run model code on every keystroke and the
ported algorithms are deeply synchronous. Library internals call the `Unsafe`
variants (or `@internal` `...OrNull` helpers) and only the public surface is
wrapped, using `attempt` from `src/internal/attempt.ts`, which turns expected
tagged errors into failures and anything else into defects.

Errors are `Data.TaggedError` classes with a `message` field, one family per
layer (`model/errors.ts`, `transform/errors.ts`, …). Each layer exports a
union type and an `is…Error` guard.

### Options

Public accessors return `Option`. Hot internal paths may use `@internal`
`…OrNull` twins (e.g. `ContentMatch.matchTypeOrNull`, `ResolvedPos.nodeAfterOrNull`)
to avoid allocations; these are not part of the public API.

### Typing

- Every model class is generic over the schema: `Node<Sc, N>`, `Fragment<Sc, N>`,
  `Mark<Sc, M>`, `NodeType<Sc, N>`, `MarkType<Sc, M>`, `Slice<Sc>`, `ResolvedPos<Sc>`.
  The defaults (`AnySchema`, all names) make untyped usage work everywhere.
- Name parameters are covariant (`out N`) so `Node<Sc, "image">` is a
  `Node<Sc>`, and `node.is("image")` narrows.
- `ChildNames<Sc, N>` gives the node names allowed as children of `N`;
  `NodeAttrs<Sc, N>` / `NodeAttrsInput<Sc, N>` give attributes (input makes
  defaulted attributes optional).

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

Attribute schemas are checked by `Node.check`, and used to decode/encode JSON
(`DocSchema.nodeFromJSON`, `Node.toJSON`, `NodeFromJSON(schema)` codec).

### Commands and plugins (state/view layers)

```ts
type Dispatch<Sc> = (tr: Transaction<Sc>) => Effect.Effect<void>
type Command<Sc, E = never, R = never> = (
  state: EditorState<Sc>,
  dispatch?: Dispatch<Sc>,
  view?: EditorView<Sc>
) => Effect.Effect<boolean, E, R>
```

Plugins are `Plugin<PluginState, Sc, E, R>`. `EditorState` and `EditorView`
carry the union of their plugins' requirements; the view is created inside an
Effect that provides them, and runs DOM event handlers with the captured
context. Handlers that complete synchronously behave exactly like ProseMirror's;
asynchronous ones are forked and treated as handled.

### Tests

- Tests live in `test/<module>/*.test.ts` and use `@effect/vitest`
  (`it.effect` for Effect tests, `assert` rather than `expect`).
- ProseMirror's test suites are ported as faithfully as possible; `test/utils/ist.ts`
  reproduces the `ist` helper so ported tests stay close to the originals.
- View tests run in Chromium via Vitest browser mode (`test/view/**`).

ProseMirror is MIT licensed, copyright Marijn Haverbeke and others; ported
code and tests retain that notice (see `LICENSE`).
