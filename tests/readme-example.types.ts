// Kept in sync with the README example and docs/extensions.md's first
// example so they stay type-correct.
import * as Effect from "effect/Effect"
import { baseKeymap, toggleMark } from "@thomasfosterau/effect-richtext/Commands"
import { keymap } from "@thomasfosterau/effect-richtext/Keymap"
import { Content, DocSchema } from "@thomasfosterau/effect-richtext/Model"
import { EditorState } from "@thomasfosterau/effect-richtext/State"
import { EditorView } from "@thomasfosterau/effect-richtext/View"
import { createEditor, defineBasicExtension } from "@thomasfosterau/effect-richtext/Extensions"

const schema = DocSchema.makeUnsafe({
  nodes: {
    doc: { content: Content.oneOrMore("paragraph") },
    paragraph: { content: Content.zeroOrMore("text"), toDOM: () => ["p", 0] },
    text: {}
  },
  marks: { strong: { toDOM: () => ["strong", 0] } }
})

const mount = Effect.fn("mount")(function* (place: HTMLElement) {
  const state = yield* EditorState.create({
    schema,
    plugins: [keymap({ "Mod-b": toggleMark(schema.marks.strong) }), keymap(baseKeymap)]
  })
  yield* EditorView.make(place, { state }) // destroyed when the scope closes
})

Effect.runFork(Effect.scoped(Effect.andThen(mount(document.body), Effect.never)))

// The first example of docs/extensions.md.
const mountBasicEditor = Effect.fn("mountBasicEditor")(function* (place: HTMLElement) {
  const editor = yield* createEditor(defineBasicExtension())
  yield* editor.mount(place)
  yield* editor.chain().setBlockType("heading", { level: 2 }).toggleMark("strong").run
})

export { mountBasicEditor }
