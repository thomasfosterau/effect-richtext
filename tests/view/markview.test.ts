// Ported from prosemirror-view/test/webtest-markview.ts (MIT, Marijn Haverbeke and others)
import { describe, it } from "@effect/vitest"
import { a, doc, p, strong } from "@thomasfosterau/effect-richtext/test-builder"
import type { ViewMutationRecord } from "@thomasfosterau/effect-richtext/view"
import ist from "../utils/ist.ts"
import { flush, tempEditor } from "./helpers.ts"

describe("markViews prop", () => {
  it("can replace a mark's representation", () => {
    const view = tempEditor({
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
    const view = tempEditor({
      doc: doc(p(strong("foo"))),
      markViews: {
        strong() {
          const dom = document.createElement("var")
          const contentDOM = document.createElement("span")
          dom.appendChild(contentDOM)
          return { dom, contentDOM }
        }
      }
    })
    const span = view.dom.querySelector("span")!
    view.dispatchUnsafe(view.state.tr.insertTextUnsafe("a", 2))
    ist(view.dom.querySelector("span"), span)
    ist(span.textContent, "faoo")
  })

  it("has its ignoreMutation method called", async () => {
    let mutation: ViewMutationRecord | undefined
    const view = tempEditor({
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
    const view = tempEditor({
      doc: doc(p(strong("foo"))),
      markViews: {
        strong() {
          const dom = document.createElement("var")
          return { dom, destroy: () => (destroyed = true) }
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

  // prosemirror-view 1.42.0
  it("lets a mark view update itself in place", () => {
    const updated: Array<string> = []
    const view = tempEditor({
      doc: doc(p(a("<a>foo<b>"))),
      markViews: {
        link(mark) {
          const dom = document.createElement("a")
          dom.setAttribute("href", mark.attrs.href)
          return {
            dom,
            update(next) {
              updated.push(next.attrs.href)
              dom.setAttribute("href", next.attrs.href)
              return true
            }
          }
        }
      }
    })
    const before = view.dom.querySelector("a")
    view.dispatchUnsafe(view.state.tr.addMark(1, 4, view.state.schema.markUnsafe("link", { href: "bar" })))
    ist(view.dom.querySelector("a"), before)
    ist(before?.getAttribute("href"), "bar")
    ist(updated.join(), "bar")
  })

  it("redraws a mark view whose update returns false", () => {
    const view = tempEditor({
      doc: doc(p(a("foo"))),
      markViews: { link: () => ({ dom: document.createElement("a"), update: () => false }) }
    })
    const before = view.dom.querySelector("a")
    view.dispatchUnsafe(view.state.tr.addMark(1, 4, view.state.schema.markUnsafe("link", { href: "bar" })))
    ist(view.dom.querySelector("a") != before)
  })
})
