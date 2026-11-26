// Ported from prosemirror-view/test/webtest-domchange.ts (MIT, Marijn Haverbeke and others).
// Changes: imports only (ProseMirror packages -> @thomasfosterau/effect-richtext/compat/*, ist ->
// ../utils/ist.ts, ./view.js -> ./compat-view.ts, mocha describe/it ->
// @effect/vitest; type-only imports marked as such) and dprint formatting
import { describe, it } from "@effect/vitest"
import * as Clock from "effect/Clock"
import { EditorState, TextSelection } from "@thomasfosterau/effect-richtext/compat/state"
import {
  a,
  blockquote,
  br,
  doc,
  em,
  eq,
  h1,
  img as img_,
  p,
  pre,
  strong
} from "@thomasfosterau/effect-richtext/compat/test-builder"
import { ReplaceStep, type Step } from "@thomasfosterau/effect-richtext/compat/transform"
import ist from "../utils/ist.ts"
import { instanceOf, present } from "../utils/present.ts"
import { findTextNode, flush, tempEditor } from "./compat-view.ts"

const img = img_({ src: "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" })

function setSel(aNode: Node, aOff: number, fNode?: Node, fOff = 0) {
  const r = document.createRange(),
    s = present(window.getSelection())
  r.setEnd(fNode || aNode, fNode ? fOff : aOff)
  r.setStart(aNode, aOff)
  s.removeAllRanges()
  s.addRange(r)
}

describe("DOM change", () => {
  it("notices when text is added", () => {
    const view = tempEditor({ doc: doc(p("hello")) })
    present(findTextNode(view.dom, "hello")).nodeValue = "heLllo"
    flush(view)
    ist(view.state.doc, doc(p("heLllo")), eq)
  })

  it("notices when text is removed", () => {
    const view = tempEditor({ doc: doc(p("hello")) })
    present(findTextNode(view.dom, "hello")).nodeValue = "heo"
    flush(view)
    ist(view.state.doc, doc(p("heo")), eq)
  })

  it("handles ambiguous changes", () => {
    const view = tempEditor({ doc: doc(p("hello")) })
    present(findTextNode(view.dom, "hello")).nodeValue = "helo"
    flush(view)
    ist(view.state.doc, doc(p("helo")), eq)
  })

  it("respects stored marks", () => {
    const view = tempEditor({ doc: doc(p("hello")) })
    view.dispatch(view.state.tr.addStoredMark(view.state.schema.marks.em.create()))
    present(findTextNode(view.dom, "hello")).nodeValue = "helloo"
    flush(view)
    ist(view.state.doc, doc(p("hello", em("o"))), eq)
  })

  it("can add a node", () => {
    const view = tempEditor({ doc: doc(p("hello")) })
    const txt = present(findTextNode(view.dom, "hello"))
    present(txt.parentNode).appendChild(document.createTextNode("!"))
    flush(view)
    ist(view.state.doc, doc(p("hello!")), eq)
  })

  it("can remove a text node", () => {
    const view = tempEditor({ doc: doc(p("hello")) })
    const txt = present(findTextNode(view.dom, "hello"))
    present(txt.parentNode).removeChild(txt)
    flush(view)
    ist(view.state.doc, doc(p()), eq)
  })

  it("can add a paragraph", () => {
    const view = tempEditor({ doc: doc(p("hello")) })
    view.dom.insertBefore(document.createElement("p"), view.dom.firstChild).appendChild(document.createTextNode("hey"))
    flush(view)
    ist(view.state.doc, doc(p("hey"), p("hello")), eq)
  })

  it("supports duplicating a paragraph", () => {
    const view = tempEditor({ doc: doc(p("hello")) })
    view.dom
      .insertBefore(document.createElement("p"), view.dom.firstChild)
      .appendChild(document.createTextNode("hello"))
    flush(view)
    ist(view.state.doc, doc(p("hello"), p("hello")), eq)
  })

  it("support inserting repeated text", () => {
    const view = tempEditor({ doc: doc(p("hello")) })
    present(findTextNode(view.dom, "hello")).nodeValue = "helhello"
    flush(view)
    ist(view.state.doc, doc(p("helhello")), eq)
  })

  it("detects an enter press", () => {
    let enterPressed = false
    const view = tempEditor({
      doc: doc(blockquote(p("foo"), p("<a>"))),
      handleKeyDown: (_view, event) => {
        if (event.keyCode == 13) return (enterPressed = true)
        return false
      }
    })
    const bq = present(view.dom.querySelector("blockquote"))
    bq.appendChild(document.createElement("p"))
    flush(view)
    ist(enterPressed)
  })

  it("detects an enter press creating a different block", () => {
    let enterPressed = false
    const view = tempEditor({
      doc: doc(h1("<a>")),
      handleKeyDown: (_view, event) => {
        if (event.keyCode == 13) return (enterPressed = true)
        return false
      }
    })
    const h2 = view.dom.appendChild(document.createElement("h2"))
    setSel(h2, 0)
    flush(view)
    ist(enterPressed)
  })

  it("detects a simple backspace press", () => {
    let backspacePressed = false
    const view = tempEditor({
      doc: doc(p("foo"), p("<a>bar")),
      handleKeyDown: (_view, event) => {
        if (event.keyCode == 8) return (backspacePressed = true)
        return false
      }
    })
    view.dom.removeChild(present(view.dom.lastChild))
    present(view.dom.firstChild).textContent = "foobar"
    flush(view)
    ist(backspacePressed)
  })

  it("detects a complex backspace press", () => {
    let backspacePressed = false
    const view = tempEditor({
      doc: doc(blockquote(blockquote(p("foo")), p("<a>", br(), "bar"))),
      handleKeyDown: (_view, event) => {
        if (event.keyCode == 8) return (backspacePressed = true)
        return false
      }
    })
    const bq = present(view.dom.firstChild)
    bq.removeChild(present(bq.lastChild))
    instanceOf(HTMLElement, present(bq.firstChild).firstChild).innerHTML = "foo<br>bar"
    flush(view)
    ist(backspacePressed)
  })

  it("doesn't route delete as backspace", () => {
    let backspacePressed = false
    const view = tempEditor({
      doc: doc(p("foo<a>"), p("bar")),
      handleKeyDown: (_view, event) => {
        if (event.keyCode == 8) return (backspacePressed = true)
        return false
      }
    })
    view.dom.removeChild(present(view.dom.lastChild))
    present(view.dom.firstChild).textContent = "foobar"
    flush(view)
    ist(!backspacePressed)
  })

  it("correctly adjusts the selection", () => {
    const view = tempEditor({ doc: doc(p("abc<a>")) })
    const textNode = present(findTextNode(view.dom, "abc"))
    textNode.nodeValue = "abcd"
    setSel(textNode, 3)
    flush(view)
    ist(view.state.doc, doc(p("abcd")), eq)
    ist(view.state.selection.anchor, 4)
    ist(view.state.selection.head, 4)
  })

  it("handles splitting of a textblock", () => {
    const view = tempEditor({ doc: doc(h1("abc"), p("defg<a>")) })
    const para = present(view.dom.querySelector("p"))
    const split = instanceOf(HTMLElement, present(para.parentNode).appendChild(para.cloneNode()))
    split.innerHTML = "fg"
    present(findTextNode(para, "defg")).nodeValue = "dexy"
    setSel(present(split.firstChild), 1)
    flush(view)
    ist(view.state.doc, doc(h1("abc"), p("dexy"), p("fg")), eq)
    ist(view.state.selection.anchor, 13)
  })

  it("handles a deep split of nodes", () => {
    const view = tempEditor({ doc: doc(blockquote(p("ab<a>cd"))) })
    const quote = present(view.dom.querySelector("blockquote"))
    const quote2 = view.dom.appendChild(quote.cloneNode(true))
    present(findTextNode(quote, "abcd")).nodeValue = "abx"
    const text2 = present(findTextNode(quote2, "abcd"))
    text2.nodeValue = "cd"
    setSel(present(text2.parentNode), 0)
    flush(view)
    ist(view.state.doc, doc(blockquote(p("abx")), blockquote(p("cd"))), eq)
    ist(view.state.selection.anchor, 9)
  })

  it("can delete the third instance of a character", () => {
    const view = tempEditor({ doc: doc(p("foo xxx<a> bar")) })
    present(findTextNode(view.dom, "foo xxx bar")).nodeValue = "foo xx bar"
    flush(view)
    ist(view.state.doc, doc(p("foo xx bar")), eq)
  })

  it("can read a simple composition", () => {
    const view = tempEditor({ doc: doc(p("hello")) })
    present(findTextNode(view.dom, "hello")).nodeValue = "hellox"
    flush(view)
    ist(view.state.doc, doc(p("hellox")), eq)
  })

  it("can delete text in markup", () => {
    const view = tempEditor({ doc: doc(p("a", em("b", img, strong("cd<a>")), "e")) })
    present(findTextNode(view.dom, "cd")).nodeValue = "c"
    flush(view)
    ist(view.state.doc, doc(p("a", em("b", img, strong("c")), "e")), eq)
  })

  it("recognizes typing inside markup", () => {
    const view = tempEditor({ doc: doc(p("a", em("b", img, strong("cd<a>")), "e")) })
    present(findTextNode(view.dom, "cd")).nodeValue = "cdxy"
    flush(view)
    ist(view.state.doc, doc(p("a", em("b", img, strong("cdxy")), "e")), eq)
  })

  it("resolves ambiguous text input", () => {
    const view = tempEditor({ doc: doc(p("fo<a>o")) })
    view.dispatch(view.state.tr.addStoredMark(view.state.schema.marks.strong.create()))
    present(findTextNode(view.dom, "foo")).nodeValue = "fooo"
    flush(view)
    ist(view.state.doc, doc(p("fo", strong("o"), "o")), eq)
  })

  it("does not repaint a text node when it's typed into", () => {
    const view = tempEditor({ doc: doc(p("fo<a>o")) })
    present(findTextNode(view.dom, "foo")).nodeValue = "fojo"
    let mutated = false
    const observer = new MutationObserver(() => (mutated = true))
    observer.observe(view.dom, { subtree: true, characterData: true, childList: true })
    flush(view)
    ist(view.state.doc, doc(p("fojo")), eq)
    ist(!mutated)
    observer.disconnect()
  })

  it("understands text typed into an empty paragraph", () => {
    const view = tempEditor({ doc: doc(p("<a>")) })
    present(view.dom.querySelector("p")).textContent = "i"
    flush(view)
    ist(view.state.doc, doc(p("i")), eq)
  })

  it("doesn't treat a placeholder BR as real content", () => {
    const view = tempEditor({ doc: doc(p("i<a>")) })
    present(view.dom.querySelector("p")).innerHTML = "<br>"
    flush(view)
    ist(view.state.doc, doc(p()), eq)
  })

  it("fixes text changes when input is ignored", () => {
    const view = tempEditor({ doc: doc(p("foo")), dispatchTransaction: () => undefined })
    present(findTextNode(view.dom, "foo")).nodeValue = "food"
    flush(view)
    ist(view.dom.textContent, "foo")
  })

  it("fixes structure changes when input is ignored", () => {
    const view = tempEditor({ doc: doc(p("foo", br(), "bar")), dispatchTransaction: () => null })
    const para = present(view.dom.querySelector("p"))
    para.replaceChild(document.createElement("img"), present(para.lastChild))
    flush(view)
    ist(view.dom.textContent, "foobar")
  })

  it("aborts when an incompatible state is set", () => {
    const view = tempEditor({ doc: doc(p("abcde")) })
    present(findTextNode(view.dom, "abcde")).nodeValue = "xabcde"
    view.dispatchEvent(new Event("input"))
    view.updateState(EditorState.create({ doc: doc(p("uvw")) }))
    flush(view)
    ist(view.state.doc, doc(p("uvw")), eq)
  })

  it("recognizes a mark change as such", () => {
    const view = tempEditor({
      doc: doc(p("one")),
      dispatchTransaction(tr) {
        ist(tr.steps.length, 1)
        ist(tr.steps[0].toJSON().stepType, "addMark")
        view.updateState(view.state.apply(tr))
      }
    })
    present(view.dom.querySelector("p")).innerHTML = "<b>one</b>"
    flush(view)
    ist(view.state.doc, doc(p(strong("one"))), eq)
  })

  it("preserves marks on deletion", () => {
    const view = tempEditor({ doc: doc(p("one", em("x<a>"))) })
    present(view.dom.querySelector("em")).innerText = ""
    view.dispatchEvent(new Event("input"))
    flush(view)
    view.dispatch(view.state.tr.insertText("y"))
    ist(view.state.doc, doc(p("one", em("y"))), eq)
  })

  it("works when a node's contentDOM is deleted", () => {
    const view = tempEditor({ doc: doc(p("one"), pre("two<a>")) })
    present(view.dom.querySelector("pre")).innerText = ""
    view.dispatchEvent(new Event("input"))
    flush(view)
    ist(view.state.doc, doc(p("one"), pre()), eq)
    ist(view.state.selection.head, 6)
  })

  it("doesn't redraw content with marks when typing in front", () => {
    const view = tempEditor({ doc: doc(p("foo", em("bar"), strong("baz"))) })
    const bar = present(findTextNode(view.dom, "bar")),
      foo = present(findTextNode(view.dom, "foo"))
    foo.nodeValue = "froo"
    flush(view)
    ist(view.state.doc, doc(p("froo", em("bar"), strong("baz"))), eq)
    ist(bar.parentNode && view.dom.contains(bar.parentNode))
    ist(foo.parentNode && view.dom.contains(foo.parentNode))
  })

  it("doesn't redraw content with marks when typing inside mark", () => {
    const view = tempEditor({ doc: doc(p("foo", em("bar"), strong("baz"))) })
    const bar = present(findTextNode(view.dom, "bar")),
      foo = present(findTextNode(view.dom, "foo"))
    bar.nodeValue = "baar"
    flush(view)
    ist(view.state.doc, doc(p("foo", em("baar"), strong("baz"))), eq)
    ist(bar.parentNode && view.dom.contains(bar.parentNode))
    ist(foo.parentNode && view.dom.contains(foo.parentNode))
  })

  it("maps input to coordsAtPos through pending changes", () => {
    const view = tempEditor({ doc: doc(p("foo")) })
    view.dispatchEvent(new Event("input"))
    view.dispatch(view.state.tr.insertText("more text"))
    ist(view.coordsAtPos(13))
  })

  it("notices text added to a cursor wrapper at the start of a mark", () => {
    const view = tempEditor({ doc: doc(p(strong(a("foo<a>"), "bar"))) })
    present(findTextNode(view.dom, "foo")).nodeValue = "fooxy"
    flush(view)
    ist(view.state.doc, doc(p(strong(a("foo"), "xybar"))), eq)
  })

  it("removes cursor wrapper text when the wrapper otherwise remains valid", () => {
    const view = tempEditor({ doc: doc(p(a(strong("foo<a>"), "bar"))) })
    present(findTextNode(view.dom, "foo")).nodeValue = "fooq"
    flush(view)
    ist(view.state.doc, doc(p(a(strong("fooq"), "bar"))), eq)
    ist(!findTextNode(view.dom, "\ufeffq"))
  })

  it("doesn't confuse backspace with delete", () => {
    let steps: Step[] = []
    const view = tempEditor({
      doc: doc(p("a<a>a")),
      dispatchTransaction(tr) {
        steps = tr.steps
        view.updateState(view.state.apply(tr))
      }
    })

    view.input.lastKeyCode = 8
    view.input.lastKeyCodeTime = Clock.Clock.defaultValue().currentTimeMillisUnsafe()
    present(findTextNode(view.dom, "aa")).nodeValue = "a"
    flush(view)

    ist(steps.length, 1)
    ist(instanceOf(ReplaceStep, steps[0]).from, 1)
    ist(instanceOf(ReplaceStep, steps[0]).to, 2)
  })

  it("can disambiguate a multiple-character backspace event", () => {
    let steps: Step[] = []
    const view = tempEditor({
      doc: doc(p("foo<a>foo")),
      dispatchTransaction(tr) {
        steps = tr.steps
        view.updateState(view.state.apply(tr))
      }
    })

    view.input.lastKeyCode = 8
    view.input.lastKeyCodeTime = Clock.Clock.defaultValue().currentTimeMillisUnsafe()
    present(findTextNode(view.dom, "foofoo")).nodeValue = "foo"
    flush(view)

    ist(steps.length, 1)
    ist(instanceOf(ReplaceStep, steps[0]).from, 1)
    ist(instanceOf(ReplaceStep, steps[0]).to, 4)
  })

  it("doesn't confuse delete with backspace", () => {
    let steps: Step[] = []
    const view = tempEditor({
      doc: doc(p("a<a>a")),
      dispatchTransaction(tr) {
        steps = tr.steps
        view.updateState(view.state.apply(tr))
      }
    })

    present(findTextNode(view.dom, "aa")).nodeValue = "a"
    flush(view)

    ist(steps.length, 1)
    ist(instanceOf(ReplaceStep, steps[0]).from, 2)
    ist(instanceOf(ReplaceStep, steps[0]).to, 3)
  })

  it("doesn't confuse delete with backspace for multi-character deletions", () => {
    let steps: Step[] = []
    const view = tempEditor({
      doc: doc(p("one foo<a>foo three")),
      dispatchTransaction(tr) {
        steps = tr.steps
        view.updateState(view.state.apply(tr))
      }
    })

    present(findTextNode(view.dom, "one foofoo three")).nodeValue = "one foo three"
    flush(view)

    ist(steps.length, 1)
    ist(instanceOf(ReplaceStep, steps[0]).from, 8)
    ist(instanceOf(ReplaceStep, steps[0]).to, 11)
  })

  it("creates a correct step for an ambiguous selection-deletion", () => {
    let steps: Step[] = []
    const view = tempEditor({
      doc: doc(p("la<a>la<b>la")),
      dispatchTransaction(tr) {
        steps = tr.steps
        view.updateState(view.state.apply(tr))
      }
    })

    view.input.lastKeyCode = 8
    view.input.lastKeyCodeTime = Clock.Clock.defaultValue().currentTimeMillisUnsafe()
    present(findTextNode(view.dom, "lalala")).nodeValue = "lala"
    flush(view)

    ist(steps.length, 1)
    ist(instanceOf(ReplaceStep, steps[0]).from, 3)
    ist(instanceOf(ReplaceStep, steps[0]).to, 5)
  })

  it("creates a step that covers the entire selection for partially-matching replacement", () => {
    let steps: Step[] = []
    const view = tempEditor({
      doc: doc(p("one <a>two<b> three")),
      dispatchTransaction(tr) {
        steps = tr.steps
        view.updateState(view.state.apply(tr))
      }
    })

    present(findTextNode(view.dom, "one two three")).nodeValue = "one t three"
    flush(view)
    ist(steps.length, 1)
    ist(instanceOf(ReplaceStep, steps[0]).from, 5)
    ist(instanceOf(ReplaceStep, steps[0]).to, 8)
    ist(instanceOf(ReplaceStep, steps[0]).slice.content.toString(), '<"t">')

    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 7, 12)))
    present(findTextNode(view.dom, "one t three")).nodeValue = "one t e"
    flush(view)
    ist(steps.length, 1)
    ist(instanceOf(ReplaceStep, steps[0]).from, 7)
    ist(instanceOf(ReplaceStep, steps[0]).to, 12)
    ist(instanceOf(ReplaceStep, steps[0]).slice.content.toString(), '<"e">')
  })

  it("doesn't create steps in the middle of surrogate pairs", () => {
    let steps: Step[] = []
    const view = tempEditor({
      doc: doc(p("👽<a>")),
      dispatchTransaction(tr) {
        steps = tr.steps
        view.updateState(view.state.apply(tr))
      }
    })
    present(findTextNode(view.dom, "👽")).nodeValue = "💎👽"
    flush(view)
    ist(steps.length, 1)
    ist(instanceOf(ReplaceStep, steps[0]).from, 1)
    ist(instanceOf(ReplaceStep, steps[0]).slice.content.toString(), '<"💎">')
  })
})
