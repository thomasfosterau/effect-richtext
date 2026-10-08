// Tests for effect-richtext/dropcursor (prosemirror-dropcursor has no
// test suite of its own).
import { afterEach, describe, it } from "@effect/vitest"
import { dropCursor } from "effect-richtext/dropcursor"
import { DocSchema } from "effect-richtext/model"
import { marks, nodes } from "effect-richtext/schema-basic"
import { EditorState } from "effect-richtext/state"
import { doc, hr, p } from "effect-richtext/test-builder"
import { EditorView } from "effect-richtext/view"
import ist from "../utils/ist.ts"
import { tempEditor, workspace } from "./helpers.ts"

const cursors = () => document.querySelectorAll(".test-dropcursor")

const drag = (view: EditorView<any, any, any>, type: string, pos: number, relatedTarget: EventTarget | null = null) => {
  const coords = view.coordsAtPos(pos)
  const event = new DragEvent(type, {
    clientX: coords.left,
    clientY: (coords.top + coords.bottom) / 2,
    bubbles: true,
    cancelable: true,
    relatedTarget
  })
  view.dom.dispatchEvent(event)
  return event
}

describe("dropCursor", () => {
  afterEach(() => {
    cursors().forEach((c) => c.remove())
  })

  it("draws an inline cursor on dragover", () => {
    const view = tempEditor({
      doc: doc(p("hello world")),
      plugins: [dropCursor({ class: "test-dropcursor", color: "red", width: 2 })]
    })
    ist(cursors().length, 0)
    drag(view, "dragover", 3)
    ist(cursors().length, 1)
    const cursor = cursors()[0] as HTMLElement
    ist(cursor.classList.contains("prosemirror-dropcursor-inline"))
    ist(cursor.style.backgroundColor, "red")
    ist(cursor.style.width, "2px")
    const rect = cursor.getBoundingClientRect(), coords = view.coordsAtPos(3)
    ist(Math.abs((rect.left + rect.right) / 2 - coords.left) < 1.5)
  })

  it("draws a block cursor between block nodes", () => {
    const view = tempEditor({ doc: doc(p("a"), hr(), hr()), plugins: [dropCursor({ class: "test-dropcursor" })] })
    // The middle of the first horizontal rule resolves to a position between blocks.
    const hrDOM = view.dom.children[1] as HTMLElement
    const rect = hrDOM.getBoundingClientRect()
    view.dom.dispatchEvent(
      new DragEvent("dragover", { clientX: rect.left + 5, clientY: rect.bottom - 1, bubbles: true, cancelable: true })
    )
    const cursor = cursors()[0] as HTMLElement
    ist(cursor)
    ist(cursor.classList.contains("prosemirror-dropcursor-block"))
  })

  it("removes the cursor on dragleave", () => {
    const view = tempEditor({ doc: doc(p("hello")), plugins: [dropCursor({ class: "test-dropcursor" })] })
    drag(view, "dragover", 2)
    ist(cursors().length, 1)
    // Leaving to an element inside the editor keeps the cursor.
    drag(view, "dragleave", 2, view.dom.firstChild)
    ist(cursors().length, 1)
    drag(view, "dragleave", 2, document.body)
    ist(cursors().length, 0)
  })

  it("removes the cursor shortly after a drop", async () => {
    const view = tempEditor({ doc: doc(p("hello")), plugins: [dropCursor({ class: "test-dropcursor" })] })
    drag(view, "dragover", 2)
    ist(cursors().length, 1)
    view.dom.dispatchEvent(new DragEvent("dragend", { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 50))
    ist(cursors().length, 0)
  })

  it("respects disableDropCursor in node specs", () => {
    const schema = DocSchema.makeUnsafe({
      nodes: { ...nodes, paragraph: { ...nodes.paragraph, disableDropCursor: true } },
      marks
    })
    const d = schema.nodeUnsafe("doc", null, [schema.nodeUnsafe("paragraph", null, [schema.textUnsafe("hello")])])
    const view = EditorView.makeUnsafe(workspace(), {
      state: EditorState.createUnsafe({ doc: d, plugins: [dropCursor({ class: "test-dropcursor" })] })
    })
    try {
      drag(view, "dragover", 2)
      ist(cursors().length, 0)
    } finally {
      view.destroy()
    }
  })

  it("stops listening when the view is destroyed", () => {
    const view = tempEditor({ doc: doc(p("hello")), plugins: [dropCursor({ class: "test-dropcursor" })] })
    drag(view, "dragover", 2)
    ist(cursors().length, 1)
    const coords = view.coordsAtPos(3), dom = view.dom
    view.destroy()
    ist(cursors().length, 0)
    dom.dispatchEvent(new DragEvent("dragover", { clientX: coords.left, clientY: coords.top + 1, bubbles: true }))
    ist(cursors().length, 0)
  })
})
