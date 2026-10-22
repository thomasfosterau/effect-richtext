import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import * as Html from "effect-richtext/html"
import { DOMSerializer, Fragment } from "effect-richtext/model"
import { blockquote, doc, em, eq, img, p, schema, strong } from "effect-richtext/test-builder"
import { Window } from "happy-dom"
import ist from "../utils/ist.ts"

const window = new Window()
const otherDocument = window.document as unknown as Document

describe("toHTML", () => {
  it("serializes the content of a top node", () => {
    ist(
      Html.toHTML(doc(p("hello ", em("world")), blockquote(p("x")))),
      "<p>hello <em>world</em></p><blockquote><p>x</p></blockquote>"
    )
  })

  it("serializes fragments", () => {
    ist(Html.toHTML(Fragment.fromArray([p("a"), p(strong("b"))])), "<p>a</p><p><strong>b</strong></p>")
    ist(Html.toHTML(Fragment.empty), "")
  })

  it("serializes non-top nodes including their wrapper", () => {
    ist(Html.toHTML(p("a")), "<p>a</p>")
    ist(Html.toHTML(img({ src: "x.png" })), '<img src="x.png">')
  })

  it("accepts an explicit document", () => {
    ist(Html.toHTML(doc(p("a")), { document: otherDocument }), "<p>a</p>")
  })

  it("accepts a custom serializer", () => {
    const serializer = new DOMSerializer(
      { ...DOMSerializer.nodesFromSchema(schema), paragraph: () => ["div", { class: "para" }, 0] },
      DOMSerializer.marksFromSchema(schema)
    )
    ist(Html.toHTML(doc(p("a")), { serializer }), '<div class="para">a</div>')
  })
})

describe("fromHTML", () => {
  it.effect("parses HTML into a document", () =>
    Effect.gen(function* () {
      const parsed = yield* Html.fromHTML(schema, "<p>hello <em>world</em></p><blockquote><p>x</p></blockquote>")
      ist(parsed, doc(p("hello ", em("world")), blockquote(p("x"))), eq)
    })
  )

  it("has a synchronous variant", () => {
    ist(Html.fromHTMLUnsafe(schema, "<p>a<strong>b</strong></p>"), doc(p("a", strong("b"))), eq)
  })

  it("round-trips through toHTML", () => {
    const d = doc(p("one ", em("two")), p(img({ src: "i.png" })))
    ist(Html.fromHTMLUnsafe(schema, Html.toHTML(d)), d, eq)
  })

  it("accepts an explicit document", () => {
    ist(Html.fromHTMLUnsafe(schema, "<p>a</p>", { document: otherDocument }), doc(p("a")), eq)
  })

  it("accepts an HTML string parser", () => {
    const htmlParser = new window.DOMParser() as unknown as Html.HTMLStringParser
    ist(Html.fromHTMLUnsafe(schema, "<p>b</p>", { htmlParser }), doc(p("b")), eq)
  })

  it("passes parse options through", () => {
    ist(Html.fromHTMLUnsafe(schema, "<p>a   b</p>"), doc(p("a b")), eq)
    ist(Html.fromHTMLUnsafe(schema, "<p>a   b</p>", { preserveWhitespace: true }), doc(p("a   b")), eq)
  })

  it.effect("parses slices", () =>
    Effect.gen(function* () {
      const slice = yield* Html.sliceFromHTML(schema, "<p>foo</p><p>bar</p>")
      ist(slice.openStart, 1)
      ist(slice.openEnd, 1)
      ist(slice.content.childCount, 2)
      ist(Html.sliceFromHTMLUnsafe(schema, "foo").content.childCount, 1)
    })
  )
})

describe("HtmlEnvironment", () => {
  it.effect("provides the global document", () =>
    Effect.gen(function* () {
      const html = yield* Html.serialize(doc(p("a")))
      ist(html, "<p>a</p>")
      const parsed = yield* Html.parse(schema, html)
      ist(parsed, doc(p("a")), eq)
      const slice = yield* Html.parseSlice(schema, "<em>x</em>")
      ist(slice.content.childCount, 1)
    }).pipe(Effect.provide(Html.HtmlEnvironment.layerGlobal))
  )

  it.effect("can provide a specific document", () =>
    Effect.gen(function* () {
      const env = yield* Html.HtmlEnvironment
      assert.strictEqual(env.document, otherDocument)
      ist(yield* Html.serialize(doc(p("a"))), "<p>a</p>")
      ist(yield* Html.parse(schema, "<p>a</p>"), doc(p("a")), eq)
    }).pipe(Effect.provide(Html.HtmlEnvironment.layer(otherDocument)))
  )
})
