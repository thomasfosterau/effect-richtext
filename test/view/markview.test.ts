// Ported from prosemirror-view/test/webtest-markview.ts (MIT, Marijn Haverbeke and others)
import { assert, describe, it } from "@effect/vitest"
import { doc, p, strong } from "effect-richtext/test-builder"
import type { ViewMutationRecord } from "effect-richtext/view"
import ist from "../utils/ist.ts"
import { flush, tempEditor } from "./helpers.ts"

describe("markViews prop", () => {
  it("can replace a mark's representation", () => {
    let view = tempEditor({
      doc: doc(p("foo", strong("bar"))),
      markViews: {
        strong() {
          return { dom: document.createElement("var") }
        }
      }
    })
    ist(view.dom.querySelector("var"))
  })

  it("can provide a contentDOM property", () => {
    let view = tempEditor({
      doc: doc(p(strong("foo"))),
      markViews: {
        strong() {
          let dom = document.createElement("var")
          let contentDOM = document.createElement("span")
          dom.appendChild(contentDOM)
          return { dom, contentDOM }
        }
      }
    })
    let span = view.dom.querySelector("span")!
    view.dispatchUnsafe(view.state.tr.insertTextUnsafe("a", 2))
    ist(view.dom.querySelector("span"), span)
    ist(span.textContent, "faoo")
  })

  it("has its ignoreMutation method called", async () => {
    let mutation: ViewMutationRecord | undefined
    let view = tempEditor({
      doc: doc(p("foo", strong("bar"))),
      markViews: {
        strong() {
          return {
            dom: document.createElement("var"),
            ignoreMutation: (m) => {
              mutation = m
              return true
            }
          }
        }
      }
    })
    ist(!mutation)
    view.dom.querySelector("var")!.classList.add("foo")
    flush(view)
    ist(mutation)
    ist((mutation!.target as HTMLElement).tagName, "VAR")
  })

  it("has its destroy method called", () => {
    let destroyed = false
    let view = tempEditor({
      doc: doc(p(strong("foo"))),
      markViews: {
        strong() {
          let dom = document.createElement("var")
          return { dom, destroy: () => destroyed = true }
        }
      }
    })
    ist(view.dom.textContent, "foo")
    ist(!destroyed)
    view.dispatchUnsafe(view.state.tr.deleteUnsafe(1, 2))
    ist(view.dom.textContent, "oo")
    ist(!destroyed)
    view.dispatchUnsafe(view.state.tr.deleteUnsafe(1, 3))
    ist(view.dom.textContent, "")
    ist(destroyed)
  })
})
