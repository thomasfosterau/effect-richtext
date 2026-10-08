// Ported from prosemirror-view/test/webtest-view.ts (MIT, Marijn Haverbeke and others)
import { assert, describe, it } from "@effect/vitest"
import { Option } from "effect"
import { DocSchema } from "effect-richtext/model"
import { EditorState } from "effect-richtext/state"
import { doc, em, hr, li, p, schema, strong, ul } from "effect-richtext/test-builder"
import { EditorView } from "effect-richtext/view"
import ist from "../utils/ist.ts"
import { tempEditor, workspace } from "./helpers.ts"

const space = workspace()

describe("EditorView", () => {
  it("can mount an existing node", () => {
    let dom = space.appendChild(document.createElement("article"))
    let view = EditorView.makeUnsafe({ mount: dom }, {
      state: EditorState.createUnsafe({ doc: doc(p("hi")) })
    })
    ist(view.dom, dom)
    ist(dom.contentEditable, "true")
    ist(dom.firstChild!.nodeName, "P")
    view.destroy()
    ist(dom.contentEditable, "inherit")
    space.removeChild(dom)
  })

  it("reflects the current state in .props", () => {
    let view = tempEditor()
    ist(view.state, view.props.state)
    view.dispatchUnsafe(view.state.tr.insertTextUnsafe("x"))
    ist(view.state, view.props.state)
  })

  it("can update props with setProp", () => {
    let view = tempEditor({ scrollThreshold: 100 })
    view.setProps({
      scrollThreshold: undefined,
      scrollMargin: 10,
      state: view.state.applyUnsafe(view.state.tr.insertTextUnsafe("y"))
    })
    ist(view.state.doc.content.size, 3)
    ist(view.props.scrollThreshold == null)
    ist(view.props.scrollMargin, 10)
  })

  it("can update with a state using a different schema", () => {
    let testSchema = DocSchema.makeUnsafe({ nodes: schema.spec.nodes })
    let view = tempEditor({ doc: doc(p(strong("foo"))) })
    view.updateState(EditorState.createUnsafe({ doc: (testSchema.nodes as any).doc.createAndFillOrNull() }))
    ist(!view.dom.querySelector("strong"))
  })

  it("calls handleScrollToSelection when appropriate", () => {
    let called = 0
    let view = tempEditor({
      doc: doc(p("foo")),
      handleScrollToSelection() {
        called++
        return false
      }
    })
    view.focus()
    view.dispatchUnsafe(view.state.tr.scrollIntoView())
    ist(called, 1)
  })

  it("can be queried for the DOM position at a doc position", () => {
    let view = tempEditor({ doc: doc(ul(li(p(strong("foo"))))) })
    let inText = view.domAtPos(4)
    ist(inText.offset, 1)
    ist(inText.node.nodeValue, "foo")
    let beforeLI = view.domAtPos(1)
    ist(beforeLI.offset, 0)
    ist(beforeLI.node.nodeName, "UL")
    let afterP = view.domAtPos(7)
    ist(afterP.offset, 1)
    ist(afterP.node.nodeName, "LI")
  })

  it("can bias DOM position queries to enter nodes", () => {
    let view = tempEditor({ doc: doc(p(em(strong("a"), "b"), "c")) })
    let get = (pos: number, bias: number) => {
      let r = view.domAtPos(pos, bias)
      return (r.node.nodeType == 1 ? r.node.nodeName : r.node.nodeValue) + "@" + r.offset
    }
    ist(get(1, 0), "P@0")
    ist(get(1, -1), "P@0")
    ist(get(1, 1), "a@0")
    ist(get(2, -1), "a@1")
    ist(get(2, 0), "EM@1")
    ist(get(2, 1), "b@0")
    ist(get(3, -1), "b@1")
    ist(get(3, 0), "P@1")
    ist(get(3, 1), "c@0")
    ist(get(4, -1), "c@1")
    ist(get(4, 0), "P@2")
    ist(get(4, 1), "P@2")
  })

  it("can be queried for a node's DOM representation", () => {
    let view = tempEditor({ doc: doc(p("foo"), hr()) })
    ist(Option.getOrThrow(view.nodeDOM(0)).nodeName, "P")
    ist(Option.getOrThrow(view.nodeDOM(5)).nodeName, "HR")
    ist(Option.isNone(view.nodeDOM(3)))
  })

  it("can map DOM positions to doc positions", () => {
    let view = tempEditor({ doc: doc(p("foo"), hr()) })
    ist(view.posAtDOMUnsafe(view.dom.firstChild!.firstChild!, 2), 3)
    ist(view.posAtDOMUnsafe(view.dom, 1), 5)
    ist(view.posAtDOMUnsafe(view.dom, 2), 6)
    ist(view.posAtDOMUnsafe(view.dom.lastChild!, 0, -1), 5)
    ist(view.posAtDOMUnsafe(view.dom.lastChild!, 0, 1), 6)
  })

  it("binds this to itself in dispatchTransaction prop", () => {
    const dom = document.createElement("div")
    let thisBinding
    let view = EditorView.makeUnsafe(dom, {
      state: EditorState.createUnsafe({ doc: doc(p("hi")) }),
      dispatchTransaction: function() {
        thisBinding = this
      }
    })
    view.dispatchUnsafe(view.state.tr.insertTextUnsafe("x"))
    ist(view, thisBinding)
  })
})
