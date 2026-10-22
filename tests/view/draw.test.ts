// Ported from prosemirror-view/test/webtest-draw.ts (MIT, Marijn Haverbeke and others)
import { describe, it } from "@effect/vitest"
import { DocSchema } from "effect-richtext/model"
import { Plugin } from "effect-richtext/state"
import { doc, h1, hr, p, pre, schema, strong } from "effect-richtext/test-builder"
import ist from "../utils/ist.ts"
import { tempEditor } from "./helpers.ts"

describe("EditorView draw", () => {
  it("updates the DOM", () => {
    const view = tempEditor({ doc: doc(p("foo")) })
    view.dispatchUnsafe(view.state.tr.insertTextUnsafe("bar"))
    ist(view.dom.textContent, "barfoo")
  })

  it("doesn't redraw nodes after changes", () => {
    const view = tempEditor({ doc: doc(h1("foo<a>"), p("bar")) })
    const oldP = view.dom.querySelector("p")
    view.dispatchUnsafe(view.state.tr.insertTextUnsafe("!"))
    ist(view.dom.querySelector("p"), oldP)
  })

  it("doesn't redraw nodes before changes", () => {
    const view = tempEditor({ doc: doc(p("foo"), h1("bar")) })
    const oldP = view.dom.querySelector("p")
    view.dispatchUnsafe(view.state.tr.insertTextUnsafe("!", 2))
    ist(view.dom.querySelector("p"), oldP)
  })

  it("doesn't redraw nodes between changes", () => {
    const view = tempEditor({ doc: doc(p("foo"), h1("bar"), pre("baz")) })
    const oldP = view.dom.querySelector("p")
    const oldPre = view.dom.querySelector("pre")
    view.dispatchUnsafe(view.state.tr.insertTextUnsafe("!", 2))
    ist(view.dom.querySelector("p"), oldP)
    ist(view.dom.querySelector("pre"), oldPre)
  })

  it("doesn't redraw siblings of a split node", () => {
    const view = tempEditor({ doc: doc(p("foo"), h1("bar"), pre("baz")) })
    const oldP = view.dom.querySelector("p")
    const oldPre = view.dom.querySelector("pre")
    view.dispatchUnsafe(view.state.tr.splitUnsafe(8))
    ist(view.dom.querySelector("p"), oldP)
    ist(view.dom.querySelector("pre"), oldPre)
  })

  it("doesn't redraw siblings of a joined node", () => {
    const view = tempEditor({ doc: doc(p("foo"), h1("bar"), h1("x"), pre("baz")) })
    const oldP = view.dom.querySelector("p")
    const oldPre = view.dom.querySelector("pre")
    view.dispatchUnsafe(view.state.tr.joinUnsafe(10))
    ist(view.dom.querySelector("p"), oldP)
    ist(view.dom.querySelector("pre"), oldPre)
  })

  it("doesn't redraw after a big deletion", () => {
    const view = tempEditor({ doc: doc(p(), p(), p(), p(), p(), p(), p(), p(), h1("!"), p(), p()) })
    const oldH = view.dom.querySelector("h1")
    view.dispatchUnsafe(view.state.tr.deleteUnsafe(2, 14))
    ist(view.dom.querySelector("h1"), oldH)
  })

  it("adds classes from the attributes prop", () => {
    const view = tempEditor({ doc: doc(p()), attributes: { class: "foo bar" } })
    ist(view.dom.classList.contains("foo"))
    ist(view.dom.classList.contains("bar"))
    ist(view.dom.classList.contains("ProseMirror"))
    view.update({ state: view.state, attributes: { class: "baz" } })
    ist(!view.dom.classList.contains("foo"))
    ist(view.dom.classList.contains("baz"))
  })

  it("adds style from the attributes prop", () => {
    const view = tempEditor({
      doc: doc(p()),
      attributes: { style: "border: 1px solid red;" },
      plugins: [
        new Plugin({ props: { attributes: { style: "background: red;" } } }),
        new Plugin({ props: { attributes: { style: "color: red;" } } })
      ]
    })
    ist(view.dom.style.border, "1px solid red")
    ist(view.dom.style.backgroundColor, "red")
    ist(view.dom.style.color, "red")
  })

  it("can set other attributes", () => {
    const view = tempEditor({ doc: doc(p()), attributes: { spellcheck: "false", "aria-label": "hello" } })
    ist(view.dom.spellcheck, false)
    ist(view.dom.getAttribute("aria-label"), "hello")
    view.update({ state: view.state, attributes: { style: "background-color: yellow" } })
    ist(view.dom.hasAttribute("aria-label"), false)
    ist(view.dom.style.backgroundColor, "yellow")
  })

  it("can't set the contenteditable attribute", () => {
    const view = tempEditor({ doc: doc(p()), attributes: { contenteditable: "false" } })
    ist(view.dom.contentEditable, "true")
  })

  it("understands the editable prop", () => {
    const view = tempEditor({ doc: doc(p()), editable: () => false })
    ist(view.dom.contentEditable, "false")
    view.update({ state: view.state })
    ist(view.dom.contentEditable, "true")
  })

  it("doesn't redraw following paragraphs when a paragraph is split", () => {
    const view = tempEditor({ doc: doc(p("abcde"), p("fg")) })
    const lastPara = view.dom.lastChild
    view.dispatchUnsafe(view.state.tr.splitUnsafe(3))
    ist(view.dom.lastChild, lastPara)
  })

  it("doesn't greedily match nodes that have another match", () => {
    const view = tempEditor({ doc: doc(p("a"), p("b"), p()) })
    const secondPara = view.dom.querySelectorAll("p")[1]
    view.dispatchUnsafe(view.state.tr.splitUnsafe(2))
    ist(view.dom.querySelectorAll("p")[2], secondPara)
  })

  it("creates and destroys plugin views", () => {
    const events: string[] = []
    class PluginView {
      update() {
        events.push("update")
      }
      destroy() {
        events.push("destroy")
      }
    }
    const plugin = new Plugin({
      view() {
        events.push("create")
        return new PluginView()
      }
    })
    const view = tempEditor({ plugins: [plugin] })
    view.dispatchUnsafe(view.state.tr.insertTextUnsafe("u"))
    view.destroy()
    ist(events.join(" "), "create update destroy")
  })

  it("redraws changed node views", () => {
    const view = tempEditor({ doc: doc(p("foo"), hr()) })
    ist(view.dom.querySelector("hr"))
    view.setProps({
      nodeViews: {
        horizontal_rule: () => {
          return { dom: document.createElement("var") }
        }
      }
    })
    ist(!view.dom.querySelector("hr"))
    ist(view.dom.querySelector("var"))
  })

  it("doesn't get confused by merged nodes", () => {
    const view = tempEditor({ doc: doc(p(strong("one"), " two ", strong("three"))) })
    view.dispatchUnsafe(view.state.tr.removeMark(1, 4, schema.marks.strong))
    ist(view.dom.querySelectorAll("strong").length, 1)
  })

  it("doesn't redraw too much when marks are present", () => {
    const s = DocSchema.makeUnsafe({
      nodes: {
        doc: { content: "paragraph+", marks: "m" },
        text: { group: "inline" },
        paragraph: schema.spec.nodes.paragraph
      },
      marks: {
        m: {
          toDOM: () => ["div", { class: "m" }, 0] as const,
          parseDOM: [{ tag: "div.m" }]
        }
      }
    })
    const paragraphs = []
    for (let i = 1; i <= 10; i++) {
      paragraphs.push(s.nodeUnsafe("paragraph", null, [s.textUnsafe("para " + i)], [s.markUnsafe("m")]))
    }
    const view = tempEditor({
      doc: s.nodeUnsafe("doc", null, paragraphs)
    })
    const initialChildren = Array.from(view.dom.querySelectorAll("p"))
    const newParagraphs = []
    for (let i = -6; i < 0; i++) {
      newParagraphs.push(s.nodeUnsafe("paragraph", null, [s.textUnsafe("para " + i)], [s.markUnsafe("m")]))
    }
    view.dispatchUnsafe(view.state.tr.replaceWithUnsafe(0, 8, newParagraphs))
    const currentChildren = Array.from(view.dom.querySelectorAll("p"))
    let sameAtEnd = 0
    while (
      sameAtEnd < currentChildren.length &&
      sameAtEnd < initialChildren.length &&
      currentChildren[currentChildren.length - sameAtEnd - 1] == initialChildren[initialChildren.length - sameAtEnd - 1]
    ) {
      sameAtEnd++
    }
    ist(sameAtEnd, 9)
  })
})
