// Kept in sync with the README example so it stays type-correct.
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { baseKeymap, toggleMark } from "@thomasfosterau/effect-richtext/commands"
import { history, redo, undo } from "@thomasfosterau/effect-richtext/history"
import { keymap } from "@thomasfosterau/effect-richtext/keymap"
import { Content, DocSchema } from "@thomasfosterau/effect-richtext/model"
import { EditorState } from "@thomasfosterau/effect-richtext/state"
import { EditorView } from "@thomasfosterau/effect-richtext/view"
import { createEditor, defineBasicExtension } from "@thomasfosterau/effect-richtext/extensions"

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

const mountEditor = Effect.fn("mountEditor")(function* (place: HTMLElement) {
  const state = yield* EditorState.create({
    schema,
    plugins: [
      history(),
      keymap({ "Mod-z": undo, "Mod-y": redo, "Mod-b": toggleMark(schema.marks.strong) }),
      keymap(baseKeymap)
    ]
  })
  const view = yield* EditorView.make(place, { state })
  yield* view.dispatch(view.state.tr.insertTextUnsafe("Hello"))
  // ...the view is destroyed when the scope closes
})

Effect.runFork(Effect.scoped(Effect.andThen(mountEditor(document.body), Effect.never)))

// The README's `@thomasfosterau/effect-richtext/extensions` example.
const mountBasicEditor = Effect.fn("mountBasicEditor")(function* (place: HTMLElement) {
  const editor = yield* createEditor(defineBasicExtension())
  yield* editor.mount(place)
  yield* editor.chain().setBlockType("heading", { level: 2 }).toggleMark("strong").run
})

export { mountBasicEditor }
