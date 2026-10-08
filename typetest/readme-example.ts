// Kept in sync with the README example so it stays type-correct.
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

const program = Effect.gen(function*() {
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
