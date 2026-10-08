import { describe, it } from "@effect/vitest"
import { Option } from "effect"
import { keymap } from "effect-richtext/compat/keymap"
import { toCore as modelToCore } from "effect-richtext/compat/model"
import { EditorState, Plugin, toCore as stateToCore } from "effect-richtext/compat/state"
import { doc, p, schema } from "effect-richtext/compat/test-builder"
import { Decoration, DecorationSet, EditorView, fromCore, toCore } from "effect-richtext/compat/view"
import * as CoreView from "effect-richtext/view"
import ist from "../utils/ist.ts"
import { workspace } from "./helpers.ts"

describe("compat view bridge", () => {
  it("runs ProseMirror-style plugins and keymaps", () => {
    const space = workspace()
    let viewSeen: EditorView | null = null, updates = 0
    const plugin = new Plugin({
      props: {
        decorations(state) {
          return DecorationSet.create(state.doc, [Decoration.inline(1, 2, { class: "first" })])
        },
        nodeViews: {
          horizontal_rule() {
            return { dom: document.createElement("hr") }
          }
        }
      },
      view(view) {
        viewSeen = view
        return {
          update() {
            updates++
          }
        }
      }
    })
    const view = new EditorView(space, {
      state: EditorState.create({
        doc: doc(p("foo")),
        plugins: [
          plugin,
          keymap({
            "Ctrl-x": (state, dispatch) => {
              if (dispatch) dispatch(state.tr.insertText("X", 1))
              return true
            }
          })
        ]
      })
    })
    try {
      ist(viewSeen, view)
      ist(fromCore(toCore(view)), view)
      ist(view.dom.querySelector(".first")!.textContent, "f")
      view.dispatchEvent(new KeyboardEvent("keydown", { key: "x", ctrlKey: true }))
      ist(view.state.doc.textContent, "Xfoo")
      ist(updates > 0)
      ist(view.someProp("decorations") !== undefined)
    } finally {
      view.destroy()
    }
  })

  it("wraps a view created with the core API", () => {
    const space = workspace()
    const state = EditorState.create({ doc: doc(p("bar")) })
    const core = CoreView.EditorView.makeUnsafe(space, { state: stateToCore(state) })
    try {
      const view = fromCore(core)
      ist(view instanceof EditorView)
      ist(view.state, state)
      view.dispatch(view.state.tr.insertText("!"))
      ist(view.state.doc.textContent, "!bar")
      ist(Option.isSome(core.nodeDOM(0)))
      ist(view.nodeDOM(0), Option.getOrNull(core.nodeDOM(0)))
      ist(modelToCore(view.state.doc), core.state.doc)
      ist(view.state.schema, schema)
    } finally {
      core.destroy()
    }
  })
})
