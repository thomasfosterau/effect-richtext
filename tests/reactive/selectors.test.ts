import { describe, it } from "@effect/vitest"
import type { Node } from "effect-richtext/model"
import { isMarkActive, isNodeActive } from "effect-richtext/reactive"
import { EditorState, NodeSelection } from "effect-richtext/state"
import { blockquote, doc, em, h2, img, li, p, schema, strong, ul } from "effect-richtext/test-builder"
import { selFor } from "../state/state.ts"
import ist from "../utils/ist.ts"

const stateFor = (d: Node<any>) => EditorState.createUnsafe({ doc: d, selection: selFor(d) })

describe("isMarkActive", () => {
  it("uses the marks at the cursor", () => {
    ist(isMarkActive(stateFor(doc(p(strong("fo<a>o")))), "strong"))
    ist(!isMarkActive(stateFor(doc(p(strong("foo"), "b<a>ar"))), "strong"))
    ist(isMarkActive(stateFor(doc(p(em("f<a>oo")))), schema.marks.em))
  })

  it("uses stored marks", () => {
    const state = stateFor(doc(p("fo<a>o")))
    const stored = state.applyUnsafe(state.tr.addStoredMark(schema.marks.strong.createUnsafe()))
    ist(isMarkActive(stored, "strong"))
    const s2 = stateFor(doc(p(strong("fo<a>o"))))
    ist(!isMarkActive(s2.applyUnsafe(s2.tr.removeStoredMark(schema.marks.strong)), "strong"))
  })

  it("checks the selected range", () => {
    ist(isMarkActive(stateFor(doc(p("<a>foo ", strong("bar<b>")))), "strong"))
    ist(!isMarkActive(stateFor(doc(p("<a>foo<b> ", strong("bar")))), "strong"))
  })
})

describe("isNodeActive", () => {
  it("finds ancestors of the selection", () => {
    const state = stateFor(doc(blockquote(ul(li(p("f<a>oo"))))))
    ist(isNodeActive(state, "paragraph"))
    ist(isNodeActive(state, "list_item"))
    ist(isNodeActive(state, schema.nodes.blockquote))
    ist(!isNodeActive(state, "heading"))
  })

  it("matches attributes", () => {
    const state = stateFor(doc(h2("f<a>oo")))
    ist(isNodeActive(state, "heading"))
    ist(isNodeActive(state, "heading", { level: 2 }))
    ist(!isNodeActive(state, "heading", { level: 1 }))
  })

  it("requires the whole selection to be inside the node", () => {
    ist(!isNodeActive(stateFor(doc(blockquote(p("f<a>oo")), p("b<b>ar"))), "blockquote"))
    ist(isNodeActive(stateFor(doc(blockquote(p("f<a>oo"), p("b<b>ar")))), "blockquote"))
  })

  it("handles node selections", () => {
    const d = doc(p("foo", img()))
    const state = EditorState.createUnsafe({ doc: d, selection: NodeSelection.createUnsafe(d, 4) })
    ist(isNodeActive(state, "image"))
    ist(isNodeActive(state, "image", { src: "img.png" }))
    ist(!isNodeActive(state, "image", { src: "other.png" }))
    ist(isNodeActive(state, "paragraph"))
    ist(!isNodeActive(stateFor(doc(p("foo<a>", img()))), "image"))
  })
})
