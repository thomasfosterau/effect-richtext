// Ported from prosemirror-model/test/test-node.ts (MIT, Marijn Haverbeke and others)
import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Equal from "effect/Equal"
import * as Hash from "effect/Hash"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { Content, DocFromJSON, DocSchema, Fragment, type Node, NodeFromJSON } from "effect-richtext/model"
import {
  a,
  blockquote,
  br,
  code,
  doc,
  em,
  eq,
  hr,
  img,
  li,
  p,
  schema,
  strong,
  tagsOf,
  ul
} from "effect-richtext/test-builder"
import ist from "../utils/ist.ts"
import { getSome } from "../utils/option.ts"
import { jsonRoundTrip, showJson } from "../utils/json.ts"

const customSchema = DocSchema.makeUnsafe({
  nodes: {
    doc: { content: Content.parse("paragraph+") },
    paragraph: { content: Content.parse("(text|contact)*") },
    text: {
      toDebugString() {
        return "custom_text"
      }
    },
    contact: {
      inline: true,
      attrs: { name: {}, email: {} },
      leafText(node: Node) {
        return `${node.attrs.name} <${node.attrs.email}>`
      }
    },
    hard_break: {
      toDebugString() {
        return "custom_hard_break"
      }
    }
  }
})

describe("Node", () => {
  describe("toString", () => {
    it("nests", () => {
      ist(
        doc(ul(li(p("hey"), p()), li(p("foo")))).toString(),
        'doc(bullet_list(list_item(paragraph("hey"), paragraph), list_item(paragraph("foo"))))'
      )
    })

    it("shows inline children", () => {
      ist(doc(p("foo", img(), br(), "bar")).toString(), 'doc(paragraph("foo", image, hard_break, "bar"))')
    })

    it("shows marks", () => {
      ist(
        doc(p("foo", em("bar", strong("quux")), code("baz"))).toString(),
        'doc(paragraph("foo", em("bar"), em(strong("quux")), code("baz")))'
      )
    })
  })

  describe("cut", () => {
    function cut(doc: Node, cut: Node) {
      ist(doc.cut(tagsOf(doc).a || 0, tagsOf(doc).b), cut, eq)
    }

    it("extracts a full block", () => cut(doc(p("foo"), "<a>", p("bar"), "<b>", p("baz")), doc(p("bar"))))

    it("cuts text", () => cut(doc(p("0"), p("foo<a>bar<b>baz"), p("2")), doc(p("bar"))))

    it("cuts deeply", () =>
      cut(
        doc(blockquote(ul(li(p("a"), p("b<a>c")), li(p("d")), "<b>", li(p("e"))), p("3"))),
        doc(blockquote(ul(li(p("c")), li(p("d")))))
      ))

    it("works from the left", () => cut(doc(blockquote(p("foo<b>bar"))), doc(blockquote(p("foo")))))

    it("works to the right", () => cut(doc(blockquote(p("foo<a>bar"))), doc(blockquote(p("bar")))))

    it("preserves marks", () =>
      cut(
        doc(p("foo", em("ba<a>r", img(), strong("baz"), br()), "qu<b>ux", code("xyz"))),
        doc(p(em("r", img(), strong("baz"), br()), "qu"))
      ))
  })

  describe("between", () => {
    function between(doc: Node, ...nodes: Array<string>) {
      let i = 0
      doc.nodesBetween(tagsOf(doc).a!, tagsOf(doc).b!, (node, pos) => {
        if (i === nodes.length) {
          assert.fail("More nodes iterated than listed (" + node.type.name + ")")
        }
        const compare = node.isTextNode() ? node.text : node.type.name
        if (compare !== nodes[i++]) {
          assert.fail("Expected " + showJson(nodes[i - 1]) + ", got " + showJson(compare))
        }
        if (!node.isText && Option.getOrNull(doc.nodeAt(pos)) !== node) {
          assert.fail("Pos " + pos + " does not point at node " + node + " " + doc.nodeAt(pos))
        }
      })
    }

    it("iterates over text", () => between(doc(p("foo<a>bar<b>baz")), "paragraph", "foobarbaz"))

    it("descends multiple levels", () =>
      between(
        doc(blockquote(ul(li(p("f<a>oo")), p("b"), "<b>"), p("c"))),
        "blockquote",
        "bullet_list",
        "list_item",
        "paragraph",
        "foo",
        "paragraph",
        "b"
      ))

    it("iterates over inline nodes", () =>
      between(
        doc(p(em("x"), "f<a>oo", em("bar", img(), strong("baz"), br()), "quux", code("xy<b>z"))),
        "paragraph",
        "foo",
        "bar",
        "image",
        "baz",
        "hard_break",
        "quux",
        "xyz"
      ))
  })

  describe("textBetween", () => {
    it("works when passing a custom function as leafText", () => {
      const d = doc(p("foo", img(), br()))
      ist(
        d.textBetween(0, d.content.size, "", (node) => {
          if (node.type.name === "image") return "<image>"
          if (node.type.name === "hard_break") return "<break>"
          return ""
        }),
        "foo<image><break>"
      )
    })

    it("works with leafText", () => {
      const d = customSchema.nodes.doc.createCheckedUnsafe({}, [
        customSchema.nodes.paragraph.createCheckedUnsafe({}, [
          customSchema.textUnsafe("Hello "),
          customSchema.nodes.contact.createCheckedUnsafe({ name: "Alice", email: "alice@example.com" })
        ])
      ])
      ist(d.textBetween(0, d.content.size), "Hello Alice <alice@example.com>")
    })

    it("should ignore leafText when passing a custom leafText", () => {
      const d = customSchema.nodes.doc.createCheckedUnsafe({}, [
        customSchema.nodes.paragraph.createCheckedUnsafe({}, [
          customSchema.textUnsafe("Hello "),
          customSchema.nodes.contact.createCheckedUnsafe({ name: "Alice", email: "alice@example.com" })
        ])
      ])
      ist(d.textBetween(0, d.content.size, "", "<anonymous>"), "Hello <anonymous>")
    })

    it("adds block separator around empty paragraphs", () => {
      ist(doc(p("one"), p(), p("two")).textBetween(0, 12, "\n"), "one\n\ntwo")
    })

    it("adds block separator around leaf nodes", () => {
      ist(doc(p("one"), hr(), hr(), p("two")).textBetween(0, 12, "\n", "---"), "one\n---\n---\ntwo")
    })

    it("doesn't add block separator around non-rendered leaf nodes", () => {
      ist(doc(p("one"), hr(), hr(), p("two")).textBetween(0, 12, "\n"), "one\ntwo")
    })
  })

  describe("textContent", () => {
    it("works on a whole doc", () => {
      ist(doc(p("foo")).textContent, "foo")
    })

    it("works on a text node", () => {
      ist(schema.textUnsafe("foo").textContent, "foo")
    })

    it("works on a nested element", () => {
      ist(doc(ul(li(p("hi")), li(p(em("a"), "b")))).textContent, "hiab")
    })
  })

  describe("check", () => {
    it("notices invalid content", () => {
      ist.throws(() => doc(li("x")).checkUnsafe(), /Invalid content for node doc/)
    })

    it("notices marks in wrong places", () => {
      ist.throws(
        () => doc(schema.nodes.paragraph.createUnsafe(null, [], [schema.marks.em.createUnsafe()])).checkUnsafe(),
        /Invalid content for node doc/
      )
    })

    it("notices incorrect sets of marks", () => {
      ist.throws(
        () => schema.textUnsafe("a", [schema.marks.em.createUnsafe(), schema.marks.em.createUnsafe()]).checkUnsafe(),
        /Invalid collection of marks/
      )
    })

    it("notices wrong attribute types", () => {
      // The test schema describes `src` with `Schema.String` rather than a
      // `validate: "string"` spec, so the message differs from ProseMirror's.
      ist.throws(
        () => schema.nodes.image.createUnsafe({ src: true as any }).checkUnsafe(),
        /Invalid value for attribute src on node of type image: true/
      )
    })

    it("notices wrong attribute types with validate strings", () => {
      const s = DocSchema.makeUnsafe({
        nodes: {
          doc: { content: Content.parse("image*") },
          image: { attrs: { src: { validate: "string" } } },
          text: {}
        }
      })
      ist.throws(
        () => s.nodes.image.createUnsafe({ src: true }).checkUnsafe(),
        /Expected value of type string for attribute src on type image, got boolean/
      )
    })

    it.effect("fails with tagged errors", () =>
      Effect.gen(function* () {
        const content = yield* Effect.flip(doc(li("x")).check())
        assert.strictEqual(content._tag, "ContentError")
        assert.match(content.message, /Invalid content for node doc/)

        const markErr = yield* Effect.flip(
          schema.textUnsafe("a", [schema.marks.em.createUnsafe(), schema.marks.em.createUnsafe()]).check()
        )
        assert.strictEqual(markErr._tag, "ContentError")
        assert.match(markErr.message, /Invalid collection of marks/)

        const image = yield* schema.nodes.image.create({ src: true as any })
        const attrErr = yield* Effect.flip(image.check())
        assert.strictEqual(attrErr._tag, "AttributeError")

        yield* doc(p("ok", img())).check()
      })
    )

    it("checks attribute schemas", () => {
      const s = DocSchema.makeUnsafe({
        nodes: {
          doc: { content: Content.oneOrMore("heading") },
          heading: {
            content: Content.zeroOrMore("text"),
            attrs: {
              level: { schema: Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 1, maximum: 6 }))), default: 1 }
            }
          },
          text: {}
        }
      })
      s.nodes.heading.createUnsafe({ level: 6 }).checkUnsafe()
      ist.throws(() => s.nodes.heading.createUnsafe({ level: 7 }).checkUnsafe(), /Invalid value for attribute level/)
      ist.throws(() => s.nodes.heading.createUnsafe({ level: 1.5 }).checkUnsafe(), /Invalid value for attribute level/)
    })
  })

  describe("from", () => {
    function from(arg: Node | Array<Node> | Fragment | null, expect: Node) {
      ist(expect.copy(Fragment.from(arg)), expect, eq)
    }

    it("wraps a single node", () => from(schema.nodeUnsafe("paragraph"), doc(p())))

    it("wraps an array", () => from([schema.nodeUnsafe("hard_break"), schema.textUnsafe("foo")], p(br, "foo")))

    it("preserves a fragment", () => from(doc(p("foo")).content, doc(p("foo"))))

    it("accepts null", () => from(null, p()))

    it("joins adjacent text", () => from([schema.textUnsafe("a"), schema.textUnsafe("b")], p("ab")))
  })

  describe("toJSON", () => {
    function roundTrip(doc: Node) {
      ist(schema.nodeFromJSONUnsafe(doc.toJSON()), doc, eq)
    }

    it("can serialize a simple node", () => roundTrip(doc(p("foo"))))

    it("can serialize marks", () => roundTrip(doc(p("foo", em("bar", strong("baz")), " ", a("x")))))

    it("can serialize inline leaf nodes", () => roundTrip(doc(p("foo", em(img(), "bar")))))

    it("can serialize block leaf nodes", () => roundTrip(doc(p("a"), hr(), p("b"), p())))

    it("can serialize nested nodes", () =>
      roundTrip(doc(blockquote(ul(li(p("a"), p("b")), li(p(img()))), p("c")), p("d"))))
  })

  describe("toString", () => {
    it("should have the default toString method [text]", () => ist(schema.textUnsafe("hello").toString(), '"hello"'))
    it("should have the default toString method [br]", () => ist(br().toString(), "hard_break"))

    it("should be able to redefine it from NodeSpec by specifying toDebugString method", () =>
      ist(customSchema.textUnsafe("hello").toString(), "custom_text"))

    it("should be respected by Fragment", () =>
      ist(
        String(
          Fragment.fromArray([
            customSchema.textUnsafe("hello"),
            customSchema.nodes.hard_break.createCheckedUnsafe(),
            customSchema.textUnsafe("world")
          ])
        ),
        "<custom_text, custom_hard_break, custom_text>"
      ))
  })

  describe("leafText", () => {
    it("should custom the textContent of a leaf node", () => {
      const contact = customSchema.nodes.contact.createCheckedUnsafe({ name: "Bob", email: "bob@example.com" })
      const paragraph = customSchema.nodes.paragraph.createCheckedUnsafe({}, [
        customSchema.textUnsafe("Hello "),
        contact
      ])

      ist(contact.textContent, "Bob <bob@example.com>")
      ist(paragraph.textContent, "Hello Bob <bob@example.com>")
    })
  })

  // ---------------------------------------------------------------------------
  // effect-richtext specific
  // ---------------------------------------------------------------------------

  describe("Equal", () => {
    it("compares nodes structurally", () => {
      assert.isTrue(Equal.equals(doc(p("foo", em("bar"))), doc(p("foo", em("bar")))))
      assert.isFalse(Equal.equals(doc(p("foo", em("bar"))), doc(p("foo", strong("bar")))))
      assert.isFalse(Equal.equals(doc(p("foo")), doc(p("fop"))))
      assert.isFalse(Equal.equals(doc(p("foo")), doc(blockquote(p("foo")))))
      assert.isTrue(Equal.equals(img(), img()))
      assert.isFalse(Equal.equals(img(), img({ src: "other.png" })))
      assert.isTrue(Equal.equals(schema.textUnsafe("x"), schema.textUnsafe("x")))
      assert.strictEqual(Hash.hash(doc(p("foo", em("bar")), hr())), Hash.hash(doc(p("foo", em("bar")), hr())))
    })

    it("compares fragments structurally", () => {
      assert.isTrue(Equal.equals(doc(p("a"), p("b")).content, doc(p("a"), p("b")).content))
      assert.isFalse(Equal.equals(doc(p("a"), p("b")).content, doc(p("a")).content))
      assert.isTrue(Equal.equals(Fragment.empty, p().content))
      assert.strictEqual(Hash.hash(doc(p("a")).content), Hash.hash(doc(p("a")).content))
    })
  })

  describe("Option accessors", () => {
    it("returns Options for absent children", () => {
      const d = doc(p("a"), hr())
      assert.isTrue(Option.isSome(d.firstChild))
      assert.strictEqual(getSome(d.lastChild).type.name, "horizontal_rule")
      assert.isTrue(Option.isNone(hr().firstChild))
      assert.isTrue(Option.isNone(d.maybeChild(2)))
      assert.isTrue(Option.isNone(d.nodeAt(100)))
      assert.isTrue(Option.isNone(d.childAfter(d.content.size).node))
      assert.isTrue(Option.isNone(d.childBefore(0).node))
    })

    it.effect("fails with a PositionError for out-of-range children", () =>
      Effect.gen(function* () {
        const d = doc(p("a"))
        assert.strictEqual((yield* d.child(0)).type.name, "paragraph")
        const err = yield* Effect.flip(d.child(1))
        assert.strictEqual(err._tag, "PositionError")
        ist.throws(() => d.childUnsafe(1), /out of range/)
      })
    )
  })

  describe("create", () => {
    it.effect("fails with an AttributeError for missing required attributes", () =>
      Effect.gen(function* () {
        const err = yield* Effect.flip(customSchema.nodes.contact.create({ name: "x" } as any))
        assert.strictEqual(err._tag, "AttributeError")
        assert.match(err.message, /No value supplied for attribute email/)
      })
    )

    it.effect("createChecked fails with a ContentError for invalid content", () =>
      Effect.gen(function* () {
        const err = yield* Effect.flip(schema.nodes.doc.createChecked(null, [schema.textUnsafe("x") as any]))
        assert.strictEqual(err._tag, "ContentError")
        ist.throws(() => schema.nodeUnsafe("doc", null, [schema.textUnsafe("x") as any]), /Invalid content/)
      })
    )

    it.effect("createAndFill fills required content", () =>
      Effect.gen(function* () {
        const filled = yield* schema.nodes.doc.createAndFill()
        ist(filled, doc(p()), eq)
        const err = yield* Effect.flip(schema.nodes.paragraph.createAndFill(null, [p() as any]))
        assert.strictEqual(err._tag, "ContentError")
      })
    )

    it.effect("rejects empty text nodes", () =>
      Effect.gen(function* () {
        const err = yield* Effect.flip(schema.text(""))
        assert.strictEqual(err._tag, "ContentError")
        assert.match(err.message, /Empty text nodes are not allowed/)
      })
    )
  })

  describe("JSON", () => {
    it.effect("nodeFromJSON fails with tagged errors", () =>
      Effect.gen(function* () {
        const notObject = yield* Effect.flip(schema.nodeFromJSON(null))
        assert.strictEqual(notObject._tag, "JSONError")
        const unknown = yield* Effect.flip(schema.nodeFromJSON({ type: "nope" }))
        assert.strictEqual(unknown._tag, "JSONError")
        const emptyText = yield* Effect.flip(schema.nodeFromJSON({ type: "text", text: "" }))
        assert.strictEqual(emptyText._tag, "JSONError")
        const badAttr = yield* Effect.flip(schema.nodeFromJSON({ type: "image", attrs: { src: 1 } }))
        assert.strictEqual(badAttr._tag, "JSONError")
        const missingAttr = yield* Effect.flip(schema.nodeFromJSON({ type: "image" }))
        assert.strictEqual(missingAttr._tag, "AttributeError")
        ist.throws(() => schema.nodeFromJSONUnsafe({ type: "nope" }), /Unknown node type/)
      })
    )

    it.effect("NodeFromJSON decodes and encodes nodes", () =>
      Effect.gen(function* () {
        const codec = NodeFromJSON(schema)
        const d = doc(p("foo", em("bar"), img({ alt: "x" })), blockquote(p("q")))
        const json = yield* Schema.encodeEffect(codec)(d)
        assert.deepStrictEqual(json, d.toJSON())
        const back = yield* Schema.decodeUnknownEffect(codec)(jsonRoundTrip(json))
        ist(back, d, eq)
        const para = yield* Schema.decodeUnknownEffect(codec)({
          type: "paragraph",
          content: [{ type: "text", text: "x" }]
        })
        ist(para, p("x"), eq)
        yield* Effect.flip(Schema.decodeUnknownEffect(codec)({ type: 1 }))
        yield* Effect.flip(Schema.decodeUnknownEffect(codec)({ type: "image", attrs: { src: 1 } }))
        yield* Effect.flip(Schema.decodeUnknownEffect(codec)({ type: "doc", content: [{ type: "list_item" }] }))
      })
    )

    it.effect("DocFromJSON only accepts top-level nodes", () =>
      Effect.gen(function* () {
        const codec = DocFromJSON(schema)
        const d = doc(p("foo"))
        const back = yield* Schema.decodeUnknownEffect(codec)(d.toJSON())
        ist(back, d, eq)
        const err = yield* Effect.flip(Schema.decodeUnknownEffect(codec)(p("foo").toJSON()))
        assert.match(err.message, /Expected a doc node, got paragraph/)
      })
    )
  })
})
