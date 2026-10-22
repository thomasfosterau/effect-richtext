// Ported from prosemirror-view/test/webtest-endOfTextblock.ts (MIT, Marijn Haverbeke and others)
import { describe, it } from "@effect/vitest"
import { TextSelection } from "effect-richtext/state"
import { a, doc, p, schema } from "effect-richtext/test-builder"
import { Decoration, DecorationSet } from "effect-richtext/view"
import ist from "../utils/ist.ts"
import { tempEditor } from "./helpers.ts"

describe("EditorView.endOfTextblock", () => {
  it("works at the left side of a textblock", () => {
    const view = tempEditor({ doc: doc(p("a"), p("<a>bcd")) })
    ist(view.endOfTextblock("left"))
    ist(view.endOfTextblock("backward"))
    ist(!view.endOfTextblock("right"))
    ist(!view.endOfTextblock("forward"))
  })

  it("works at the right side of a textblock", () => {
    const view = tempEditor({ doc: doc(p("abc<a>"), p("d")) })
    ist(!view.endOfTextblock("left"))
    ist(!view.endOfTextblock("backward"))
    ist(view.endOfTextblock("right"))
    ist(view.endOfTextblock("forward"))
  })

  it("works in the middle of a textblock", () => {
    const view = tempEditor({ doc: doc(p("a<a>b")) })
    ist(!view.endOfTextblock("left"))
    ist(!view.endOfTextblock("backward"))
    ist(!view.endOfTextblock("right"))
    ist(!view.endOfTextblock("forward"))
  })

  it("works at the start of the document", () => {
    const view = tempEditor({ doc: doc(p("<a>bcd")) })
    ist(view.endOfTextblock("left"))
    ist(view.endOfTextblock("backward"))
    ist(!view.endOfTextblock("right"))
    ist(!view.endOfTextblock("forward"))
  })

  it("works at the end of the document", () => {
    const view = tempEditor({ doc: doc(p("abc<a>")) })
    ist(!view.endOfTextblock("left"))
    ist(!view.endOfTextblock("backward"))
    ist(view.endOfTextblock("right"))
    ist(view.endOfTextblock("forward"))
  })

  it("works for vertical motion in a one-line block", () => {
    const view = tempEditor({ doc: doc(p("abc<a>")) })
    ist(view.endOfTextblock("up"))
    ist(view.endOfTextblock("down"))
  })

  it("works for vertical motion at the end of a wrapped block", () => {
    const view = tempEditor({ doc: doc(p("foo ".repeat(99) + "<a>foo")) })
    ist(!view.endOfTextblock("up"))
    ist(view.endOfTextblock("down"))
  })

  it("works for vertical motion at the start of a wrapped block", () => {
    const view = tempEditor({ doc: doc(p("foo <a>" + "foo ".repeat(99))) })
    ist(view.endOfTextblock("up"))
    ist(!view.endOfTextblock("down"))
  })

  it("works for virtual motion when in a mark", () => {
    const view = tempEditor({
      doc: doc(p(a("fo<a>o "), "foo ".repeat(49), a("fo<b>o "), "foo ".repeat(49), a("fo<c>o")))
    })
    ist(view.endOfTextblock("up"))
    ist(!view.endOfTextblock("down"))
    view.dispatchUnsafe(
      view.state.tr.setSelectionUnsafe(TextSelection.createUnsafe(view.state.doc, (view.state.doc as any).tag.b))
    )
    ist(!view.endOfTextblock("up"))
    ist(!view.endOfTextblock("down"))
    view.dispatchUnsafe(
      view.state.tr.setSelectionUnsafe(TextSelection.createUnsafe(view.state.doc, (view.state.doc as any).tag.c))
    )
    ist(!view.endOfTextblock("up"))
    ist(view.endOfTextblock("down"))
  })

  // Bidi functionality only works when the browser has Selection.modify
  if (!(getSelection() as any).modify) return

  it("works at the start of an RTL block", () => {
    const view = tempEditor({ doc: doc(p("<a>مرآة")) })
    view.dom.style.direction = "rtl"
    ist(!view.endOfTextblock("left"))
    ist(view.endOfTextblock("backward"))
    ist(view.endOfTextblock("right"))
    ist(!view.endOfTextblock("forward"))
  })

  it("works at the end of an RTL block", () => {
    const view = tempEditor({ doc: doc(p("مرآة<a>")) })
    view.dom.style.direction = "rtl"
    ist(view.endOfTextblock("left"))
    ist(!view.endOfTextblock("backward"))
    ist(!view.endOfTextblock("right"))
    ist(view.endOfTextblock("forward"))
  })

  it("works inside an RTL block", () => {
    const view = tempEditor({ doc: doc(p("مر<a>آة")) })
    view.dom.style.direction = "rtl"
    ist(!view.endOfTextblock("left"))
    ist(!view.endOfTextblock("backward"))
    ist(!view.endOfTextblock("right"))
    ist(!view.endOfTextblock("forward"))
  })

  it("works in a bidirectional block", () => {
    const view = tempEditor({ doc: doc(p("proseمرآة<a>")) })
    ist(!view.endOfTextblock("left"))
    ist(!view.endOfTextblock("backward"))
    ist(view.endOfTextblock("forward"))
  })

  it("works in a cursor wrapper", () => {
    const view = tempEditor({ doc: doc(p("foo<a>")) })
    view.dispatchUnsafe(view.state.tr.setStoredMarks([schema.marks.em.createUnsafe()]))
    ist(!view.endOfTextblock("backward"))
  })

  it("works after a widget", () => {
    const d = doc(p("fo<a>o")),
      w = document.createElement("span")
    w.textContent = "!"
    const view = tempEditor({
      doc: d,
      decorations() {
        return DecorationSet.create(d, [Decoration.widget(3, w)])
      }
    })
    ist(!view.endOfTextblock("backward"))
  })
})
