# Extensions

`@thomasfosterau/effect-richtext/extensions` is a composition layer on top of the core, in the style of ProseKit and TipTap. It is additive (no core module imports it) and unopinionated: no UI, no styling, no required node set.

An extension is an immutable tree of facets: nodes, marks, plugins, keymaps and commands. `union` merges extensions, and `createEditor` turns one into an editor whose commands, node builders and requirements are all typed from what the extension declares.

## A basic editor

```ts
import { Effect } from "effect"
import { createEditor, defineBasicExtension } from "@thomasfosterau/effect-richtext/extensions"

const mountBasicEditor = Effect.fn("mountBasicEditor")(function* (place: HTMLElement) {
  const editor = yield* createEditor(defineBasicExtension())
  yield* editor.mount(place)
  yield* editor.chain().setBlockType("heading", { level: 2 }).toggleMark("strong").run
})
```

`createEditor(extension, { doc?, selection? })` returns an `Effect`. Its error channel holds the schema, model and state errors plus whatever the extension's plugins and commands can fail with, and its requirements are the services they need. `doc` may be a node, its JSON or an HTML string. `createEditorUnsafe` is the synchronous twin for extensions that need no services.

`editor.mount(place)` creates the view with `EditorView.make`, so it needs a `Scope`: the view is destroyed when the scope closes. `editor.unmount` destroys it early and keeps its last state.

## Adding your own commands

```ts
import { Effect } from "effect"
import { createEditor, defineBasicExtension, defineCommands, union } from "@thomasfosterau/effect-richtext/extensions"
import type { Command } from "@thomasfosterau/effect-richtext/state"

const extension = union(
  defineBasicExtension(),
  defineCommands({
    greet:
      (name: string): Command =>
      (state, dispatch) =>
        dispatch ? Effect.as(dispatch(state.tr.insertTextUnsafe(`Hello ${name}`)), true) : Effect.succeed(true)
  })
)

const program = Effect.gen(function* () {
  const editor = yield* createEditor(extension)
  yield* editor.commands.greet("you")
  yield* editor.commands.toggleMark("strong") // only the merged schema's mark names type-check
  const canUndo = yield* editor.can().undo()
})
```

- `editor.commands.x(...)` runs one command and dispatches what it produces. It succeeds with `true` when the command applied.
- `editor.chain()…run` queues commands and applies them to one shared transaction, so the whole chain is one undo step. Each command sees the document, selection and stored marks the previous ones produced. `run` succeeds with `true` when every command applied. A command named `run` cannot be chained.
- `editor.can().x(...)` runs the command without dispatching, to ask whether it would apply.
- A plugin failure reaches the caller in the error channel. A mismatched transaction (a `StateError`) is a defect.

## Building content

`editor.nodes`, `editor.marks` and `editor.text` are synchronous builders typed from the schema. They throw like the core's `Unsafe` constructors.

```ts
const { nodes } = editor
yield * editor.setContent(nodes.doc(nodes.heading({ level: 2 }, "Hello"), nodes.paragraph("world")))
```

## Priorities and merging

`Priority.lowest` … `Priority.highest` and `withPriority` order facets, highest first and then by declaration order. The order decides the schema's node and mark order, the plugin and keymap order, and which command wins a name clash. Inner priorities win over outer ones. Specs with the same name are shallow-merged: attributes are merged, and the higher priority wins a conflict. Each keymap facet becomes its own keymap plugin; `defineBaseKeymap` is `low`, and `defineParagraph` is `highest` so the paragraph is the default block.

See the doc comments in [`src/extensions/`](https://github.com/thomasfosterau/effect-richtext/tree/trunk/src/extensions) for every `define…` helper.
