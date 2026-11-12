# ProseMirror compatibility

`@thomasfosterau/effect-richtext/compat/*` exposes the API of the `prosemirror-*` packages over this package's core, so code written against ProseMirror can switch its imports and run unchanged. ProseMirror's own test suites run against these modules with import-only changes.

| ProseMirror package        | Compat module                                         |
| -------------------------- | ----------------------------------------------------- |
| `prosemirror-model`        | `@thomasfosterau/effect-richtext/compat/model`        |
| `prosemirror-transform`    | `@thomasfosterau/effect-richtext/compat/transform`    |
| `prosemirror-state`        | `@thomasfosterau/effect-richtext/compat/state`        |
| `prosemirror-view`         | `@thomasfosterau/effect-richtext/compat/view`         |
| `prosemirror-keymap`       | `@thomasfosterau/effect-richtext/compat/keymap`       |
| `prosemirror-commands`     | `@thomasfosterau/effect-richtext/compat/commands`     |
| `prosemirror-schema-basic` | `@thomasfosterau/effect-richtext/compat/schema-basic` |
| `prosemirror-schema-list`  | `@thomasfosterau/effect-richtext/compat/schema-list`  |
| `prosemirror-test-builder` | `@thomasfosterau/effect-richtext/compat/test-builder` |
| `orderedmap`               | `@thomasfosterau/effect-richtext/compat/orderedmap`   |

## Switching imports

Change the import specifiers, or alias them in your bundler. With Vite:

```ts
import { defineConfig } from "vite"

const compat = (name: string) => `@thomasfosterau/effect-richtext/compat/${name}`

export default defineConfig({
  resolve: {
    alias: {
      "prosemirror-model": compat("model"),
      "prosemirror-transform": compat("transform"),
      "prosemirror-state": compat("state"),
      "prosemirror-view": compat("view"),
      "prosemirror-keymap": compat("keymap"),
      "prosemirror-commands": compat("commands")
    }
  }
})
```

Alias every `prosemirror-*` package you use together. A facade object from a compat module and an object from the real ProseMirror package are different classes and do not mix.

## What the facade does

- **ProseMirror's shapes.** Facade methods return `null` where the core returns an `Option`, and throw ProseMirror's exceptions (`RangeError`, `ReplaceError`, `TransformError`, `SyntaxError` for content expressions) where the core fails with tagged errors. Commands are plain `(state, dispatch?, view?) => boolean` functions.
- **Stable identity.** Each core object has one facade, so `doc.child(0) === doc.child(0)` holds as it does in ProseMirror.
- **Subclassing.** Subclasses of `Step` and `Selection`, and of the built-in steps and selections, work in core transforms, the history and the view. `Step.jsonID` and `Selection.jsonID` register their deserializers with the core.
- **Plugins and views.** `new Plugin(spec)` and `new EditorView(place, props)` take ProseMirror-style specs and props. Node and mark views returned by ProseMirror-style constructors are adapted.

## Mixing the two APIs

Each compat module exports `toCore` and `fromCore` to move a value between the facade and the core, and `compat/state` exports `toCoreCommand` and `fromCoreCommand` for commands. That lets an application move to the core's Effect API one module at a time:

```ts
import { toCore } from "@thomasfosterau/effect-richtext/compat/model"
import { schema } from "@thomasfosterau/effect-richtext/compat/schema-basic"

const coreSchema = toCore(schema) // a core `DocSchema`
```

The design of the facade is described in [DESIGN.md](../DESIGN.md).
