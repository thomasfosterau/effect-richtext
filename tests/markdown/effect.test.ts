import { assert, describe, it } from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import {
  defaultMarkdownParser,
  defaultMarkdownSerializer,
  MarkdownError,
  MarkdownParser,
  MarkdownSerializer,
  schema
} from "@thomasfosterau/effect-richtext/Markdown"
import { DocSchema } from "@thomasfosterau/effect-richtext/Model"
import * as TB from "@thomasfosterau/effect-richtext/TestBuilder"
import MarkdownIt from "markdown-it"
import ist from "../utils/ist.ts"
import { doc, em, h1, p } from "./build.ts"

describe("MarkdownParser (Effect API)", () => {
  it.effect("parses in an Effect", () =>
    Effect.gen(function* () {
      const parsed = yield* defaultMarkdownParser.parse("# Hi\n\n*there*")
      ist(parsed, doc(h1("Hi"), p(em("there"))), TB.eq)
      ist(parsed.type.schema, schema)
    })
  )

  it.effect("produces an empty document for empty input", () =>
    Effect.gen(function* () {
      ist(yield* defaultMarkdownParser.parse(""), doc(p()), TB.eq)
    })
  )

  it.effect("fails with a MarkdownError for unsupported tokens", () =>
    Effect.gen(function* () {
      const parser = new MarkdownParser(schema, new MarkdownIt("commonmark"), { paragraph: { block: "paragraph" } })
      const err = yield* Effect.flip(parser.parse("# heading"))
      assert.strictEqual(err._tag, "MarkdownError")
      assert.match(err.message, /heading_open/)
      ist.throws(
        () => parser.parseUnsafe("# heading"),
        (e) => e instanceof MarkdownError
      )
    })
  )

  it.effect("fails with a ModelError for invalid attributes", () =>
    Effect.gen(function* () {
      const parser = new MarkdownParser(schema, new MarkdownIt("commonmark"), {
        paragraph: { block: "paragraph" },
        link: { mark: "link", getAttrs: () => ({}) }
      })
      const err = yield* Effect.flip(parser.parse("[a](b)"))
      assert.strictEqual(err._tag, "AttributeError")
    })
  )

  it("rejects invalid parsing specs", () => {
    ist.throws(() => new MarkdownParser(schema, new MarkdownIt(), { paragraph: {} }), /Unrecognized parsing spec/)
  })

  it("works with other schemas", () => {
    const parser = new MarkdownParser(TB.schema, new MarkdownIt("commonmark"), defaultMarkdownParser.tokens as any)
    // The test-builder schema's lists have no `tight` attribute, so it is dropped.
    ist(parser.parseUnsafe("* a\n* b"), TB.doc(TB.ul(TB.li(TB.p("a")), TB.li(TB.p("b")))), TB.eq)
  })
})

describe("MarkdownSerializer", () => {
  const custom = DocSchema.makeUnsafe({
    nodes: {
      doc: { content: "block+" },
      paragraph: { content: "inline*", group: "block" },
      note: { content: "paragraph+", group: "block" },
      text: { group: "inline" }
    },
    marks: { underline: {} }
  })
  const note = custom.nodeUnsafe("note", null, [
    custom.nodeUnsafe("paragraph", null, [custom.textUnsafe("x", [custom.markUnsafe("underline")])])
  ])
  const d = custom.nodeUnsafe("doc", null, [note])

  it.effect("serializes in an Effect", () =>
    Effect.gen(function* () {
      ist(yield* defaultMarkdownSerializer.serialize(doc(h1("Hi"), p(em("there")))), "# Hi\n\n*there*")
    })
  )

  it.effect("fails with a MarkdownError for unknown nodes and marks in strict mode", () =>
    Effect.gen(function* () {
      const nodeErr = yield* Effect.flip(defaultMarkdownSerializer.serialize(d))
      assert.strictEqual(nodeErr._tag, "MarkdownError")
      assert.match(nodeErr.message, /note/)
      ist.throws(
        () => defaultMarkdownSerializer.serializeUnsafe(d),
        (e) => e instanceof MarkdownError && /note/.test(e.message)
      )
      const withNote = new MarkdownSerializer(
        { ...defaultMarkdownSerializer.nodes, note: (s, n) => s.renderContent(n) },
        defaultMarkdownSerializer.marks
      )
      const markErr = yield* Effect.flip(withNote.serialize(d))
      assert.match(markErr.message, /underline/)
      ist.throws(
        () => withNote.serializeUnsafe(d),
        (e) => e instanceof MarkdownError && /underline/.test(e.message)
      )
    })
  )

  const throwing = new MarkdownSerializer(
    {
      ...defaultMarkdownSerializer.nodes,
      paragraph: () => {
        throw new RangeError("boom")
      }
    },
    defaultMarkdownSerializer.marks
  )

  it.effect("dies on other errors thrown by a node serializer", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(throwing.serialize(doc(p("x"))))
      assert.isTrue(Exit.isFailure(exit) && Cause.hasDies(exit.cause))
    })
  )

  it("renders only the content of unknown elements in non-strict mode", () => {
    const lax = new MarkdownSerializer(defaultMarkdownSerializer.nodes, defaultMarkdownSerializer.marks, {
      strict: false
    })
    ist(lax.serializeUnsafe(d), "x")
  })

  it("supports tight lists", () => {
    const list = TB.doc(TB.ul(TB.li(TB.p("a")), TB.li(TB.p("b"))))
    ist(defaultMarkdownSerializer.serializeUnsafe(list), "* a\n\n* b")
    // The test-builder schema has no `tight` attribute, so the option applies.
    ist(defaultMarkdownSerializer.serializeUnsafe(list, { tightLists: true }), "* a\n* b")
  })
})
