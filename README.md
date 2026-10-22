# effect-richtext

A reimplementation of the core [ProseMirror](https://prosemirror.net) toolkit (`prosemirror-model`, `-transform`, `-state`, `-view`, `-keymap`, `-commands`) on top of [Effect](https://effect.website) 4, in a single package.

- **Strongly typed documents.** Node and mark names are literal types, attributes are described with Effect `Schema`s, and content expressions are typed combinators, so the schema knows which children each node accepts: `doc` built from a `text` node is a compile error, and `node.is("heading")` narrows `node.attrs` to `{ level: number }`.
- **Effect everywhere.** Every fallible operation returns an `Effect` with tagged errors (`PositionError`, `ReplaceError`, `StepError`, …). Each also has a synchronous `…Unsafe` twin for hot paths. Absent values are `Option`s.
- **Typed plugin requirements.** Plugins, commands and view props may return Effects that need services; those requirements (`R`) and errors (`E`) are tracked through `EditorState` and `EditorView`, and provided with ordinary Effect layers. The view is created in a `Scope` and destroyed with it.
- **Faithful port.** ProseMirror's own test suites are ported and pass (model, transform, state, commands, keymap, history, markdown, and all of prosemirror-view's browser tests in real Chromium).
- **Nice-to-haves**, all additive and unopinionated: extensions with typed `editor.commands` / `editor.chain()` / `editor.can()`, input rules, gap and drop cursors, placeholders, undo history, reactive bindings (`SubscriptionRef`/`Stream`), HTML and Markdown serializers.

See [`DESIGN.md`](./DESIGN.md) for the design decisions and conventions.

> Status: experimental (0.x). APIs may change.

## Modules

| Module                         | Ported from / purpose                                        |
| ------------------------------ | ------------------------------------------------------------ |
| `effect-richtext/model`        | prosemirror-model (incl. DOM parser/serializer, JSON codecs) |
| `effect-richtext/transform`    | prosemirror-transform                                        |
| `effect-richtext/state`        | prosemirror-state                                            |
| `effect-richtext/view`         | prosemirror-view                                             |
| `effect-richtext/view-css`     | prosemirror-view's stylesheet                                |
| `effect-richtext/keymap`       | prosemirror-keymap                                           |
| `effect-richtext/commands`     | prosemirror-commands                                         |
| `effect-richtext/history`      | prosemirror-history                                          |
| `effect-richtext/inputrules`   | prosemirror-inputrules                                       |
| `effect-richtext/gapcursor`    | prosemirror-gapcursor                                        |
| `effect-richtext/dropcursor`   | prosemirror-dropcursor                                       |
| `effect-richtext/schema-basic` | prosemirror-schema-basic                                     |
| `effect-richtext/schema-list`  | prosemirror-schema-list                                      |
| `effect-richtext/markdown`     | prosemirror-markdown                                         |
| `effect-richtext/test-builder` | prosemirror-test-builder                                     |
| `effect-richtext/html`         | HTML string helpers                                          |
| `effect-richtext/placeholder`  | placeholder decorations                                      |
| `effect-richtext/reactive`     | `SubscriptionRef`/`Stream` bindings                          |
| `effect-richtext/extensions`   | composable, typed extensions and chainable commands          |
| `effect-richtext/compat/*`     | ProseMirror-compatible facade API                            |

## Example

```ts
import { Effect, Schema } from "effect"
import { baseKeymap, toggleMark } from "effect-richtext/commands"
import { history, redo, undo } from "effect-richtext/history"
import { keymap } from "effect-richtext/keymap"
import { Content, DocSchema } from "effect-richtext/model"
import { EditorState } from "effect-richtext/state"
import { EditorView } from "effect-richtext/view"

const schema = DocSchema.makeUnsafe({
  nodes: {
    doc: { content: Content.oneOrMore("block") },
    paragraph: { group: "block", content: Content.zeroOrMore("text"), toDOM: () => ["p", 0] },
    heading: {
      group: "block",
      content: Content.zeroOrMore("text"),
      attrs: { level: { schema: Schema.Literals([1, 2, 3]), default: 1 } },
      toDOM: (node) => ["h" + node.attrs.level, 0]
    },
    text: {}
  },
  marks: { strong: { toDOM: () => ["strong", 0] } }
})

const program = Effect.gen(function* () {
  const state = yield* EditorState.create({
    schema,
    plugins: [
      history(),
      keymap({ "Mod-z": undo, "Mod-y": redo, "Mod-b": toggleMark(schema.marks.strong) }),
      keymap(baseKeymap)
    ]
  })
  const view = yield* EditorView.make(document.body, { state })
  yield* view.dispatch(view.state.tr.insertTextUnsafe("Hello"))
  // ...the view is destroyed when the scope closes
})

Effect.runFork(Effect.scoped(Effect.andThen(program, Effect.never)))
```

With `effect-richtext/extensions`, the same editor is:

```ts
const editor = yield * createEditor(defineBasicExtension())
yield * editor.mount(document.body)
yield * editor.chain().setBlockType("heading", { level: 2 }).toggleMark("strong").run()
```

## Development

```sh
pnpm install
pnpm check          # tsc -b
pnpm test           # vitest (node + browser projects)
pnpm test-types     # tstyche type tests
pnpm lint-fix       # oxlint + dprint
pnpm docgen         # API docs
```

Browser tests run in Chromium through Vitest browser mode and Playwright. To use a preinstalled Chromium, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE`.

## License

MIT. Portions are derived from ProseMirror, © Marijn Haverbeke and others (MIT); see [`LICENSE`](./LICENSE).
