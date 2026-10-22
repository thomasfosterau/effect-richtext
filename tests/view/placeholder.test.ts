// Tests for effect-richtext/placeholder.
import { describe, it } from "@effect/vitest"
import { placeholder, placeholderCSS } from "effect-richtext/placeholder"
import { TextSelection } from "effect-richtext/state"
import { blockquote, doc, h1, p } from "effect-richtext/test-builder"
import type { EditorView } from "effect-richtext/view"
import { injectCSSUnsafe } from "effect-richtext/view-css"
import ist from "../utils/ist.ts"
import { tempEditor } from "./helpers.ts"

const decorated = (view: EditorView<any, any, any>) => Array.from(view.dom.querySelectorAll("[data-placeholder]"))

describe("placeholder", () => {
  it("decorates the empty document's textblock", () => {
    const view = tempEditor({ doc: doc(p()), plugins: [placeholder({ placeholder: "Write…" })] })
    const found = decorated(view)
    ist(found.length, 1)
    ist(found[0], view.dom.firstChild)
    ist(found[0]!.getAttribute("data-placeholder"), "Write…")
    ist(found[0]!.classList.contains("is-empty"))
  })

  it("removes the decoration when content is added", () => {
    const view = tempEditor({ doc: doc(p()), plugins: [placeholder({ placeholder: "Write…" })] })
    view.dispatchUnsafe(view.state.tr.insertTextUnsafe("x"))
    ist(decorated(view).length, 0)
    ist(!(view.dom.firstChild as HTMLElement).classList.contains("is-empty"))
    view.dispatchUnsafe(view.state.tr.deleteUnsafe(1, 2))
    ist(decorated(view).length, 1)
  })

  it("only shows on empty documents with the doc strategy", () => {
    const view = tempEditor({ doc: doc(p("a"), p("<a>")), plugins: [placeholder({ placeholder: "Write…" })] })
    ist(decorated(view).length, 0)
  })

  it("doesn't count documents with non-textblock content as empty", () => {
    const view = tempEditor({ doc: doc(blockquote(p())), plugins: [placeholder({ placeholder: "Write…" })] })
    ist(decorated(view).length, 0)
  })

  it("shows on the current empty textblock with the block strategy", () => {
    const view = tempEditor({
      doc: doc(p("a"), p("<a>"), p()),
      plugins: [placeholder({ placeholder: "Type here", strategy: "block" })]
    })
    let found = decorated(view)
    ist(found.length, 1)
    ist(found[0], view.dom.childNodes[1])
    // Moving the cursor moves the placeholder
    view.dispatchUnsafe(view.state.tr.setSelectionUnsafe(TextSelection.createUnsafe(view.state.doc, 6)))
    found = decorated(view)
    ist(found.length, 1)
    ist(found[0], view.dom.childNodes[2])
    // Not shown in non-empty blocks
    view.dispatchUnsafe(view.state.tr.setSelectionUnsafe(TextSelection.createUnsafe(view.state.doc, 1)))
    ist(decorated(view).length, 0)
  })

  it("supports nested textblocks with the block strategy", () => {
    const view = tempEditor({
      doc: doc(blockquote(p("<a>"))),
      plugins: [placeholder({ placeholder: "Quote", strategy: "block" })]
    })
    const found = decorated(view)
    ist(found.length, 1)
    ist(found[0]!.nodeName, "P")
  })

  it("computes the placeholder with a function and uses a custom class", () => {
    const view = tempEditor({
      doc: doc(p("a"), h1("<a>")),
      plugins: [
        placeholder({
          placeholder: (_state, node) => (node.type.name === "heading" ? "Heading" : "Text"),
          strategy: "block",
          className: "empty-node"
        })
      ]
    })
    const found = decorated(view)
    ist(found.length, 1)
    ist(found[0]!.getAttribute("data-placeholder"), "Heading")
    ist(found[0]!.classList.contains("empty-node"))
    ist(!found[0]!.classList.contains("is-empty"))
  })

  it("shows the text with the default CSS", () => {
    const remove = injectCSSUnsafe(document, placeholderCSS)
    try {
      const view = tempEditor({ doc: doc(p()), plugins: [placeholder({ placeholder: "Write…" })] })
      const style = getComputedStyle(view.dom.firstChild as HTMLElement, "::before")
      ist(style.content, '"Write…"')
    } finally {
      remove()
    }
  })
})
