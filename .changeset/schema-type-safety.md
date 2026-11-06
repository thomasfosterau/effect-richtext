---
"@thomasfosterau/effect-richtext": minor
---

Tighten the document schema's types. These are type-level changes that may reject code that compiled before; runtime behaviour is unchanged.

- Node and mark constructors (`NodeType.create*`, `MarkType.create*`, `DocSchema.node` / `mark` and their `Unsafe` twins) require the attributes argument when the type has an attribute without a default, so `schema.nodes.image.createUnsafe()` no longer compiles when `src` is required. `NodesWithOptionalAttrs<Sc>` / `MarksWithOptionalAttrs<Sc>` name the types that may omit it.
- `schema.nodes[name]` / `schema.marks[name]` for a name the schema does not declare is typed `| undefined`.
- `DocSchema.make` / `makeUnsafe` check specs with literal names at compile time (`SchemaSpecCheck`). An unknown content, `marks` or `excludes` reference fails to compile. So does a missing top or `text` node, a name used by both a node and a mark, an attribute `default` that is not a value of its `schema`, or an unknown `validate` type name. Untyped (`NodeSpecs`) specs keep the runtime check only.
- An attribute's type follows its `validate` type names (`"string|null"` is `string | null`). An attribute with no `schema`, `validate` string or non-null `default` is `unknown` instead of `any`.
- `ContentMatch.compile` accepts node type tables with missing entries. The new `MarksInput<Sc>` type names the marks parameter of node constructors.
