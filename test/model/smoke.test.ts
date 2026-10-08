import { assert, describe, it } from "@effect/vitest"
import { Effect, Equal, Option, Schema } from "effect"
import { Content, DocSchema, NodeFromJSON, Slice } from "effect-richtext/model"
import { doc, p, schema, strong } from "effect-richtext/test-builder"

describe("model smoke", () => {
  it("builds documents with tags", () => {
    const d = doc(p("hello <a>world"))
    assert.strictEqual(d.tag.a, 7)
    assert.strictEqual(d.textContent, "hello world")
  })

  it.effect("resolves positions", () =>
    Effect.gen(function*() {
      const d = doc(p("ab"), p(strong("cd")))
      const $pos = yield* d.resolve(5)
      assert.strictEqual($pos.depth, 1)
      assert.strictEqual($pos.parent.textContent, "cd")
      const err = yield* Effect.flip(d.resolve(100))
      assert.strictEqual(err._tag, "PositionError")
    }))

  it.effect("replaces", () =>
    Effect.gen(function*() {
      const d = doc(p("on<a>e"), p("t<b>wo"))
      const r = yield* d.replace(d.tag.a, d.tag.b, Slice.empty)
      assert.isTrue(Equal.equals(r, doc(p("onwo"))))
    }))

  it.effect("round-trips JSON through an Effect Schema", () =>
    Effect.gen(function*() {
      const d = doc(p("x", strong("y")))
      const codec = NodeFromJSON(schema)
      const json = yield* Schema.encodeEffect(codec)(d)
      const back = yield* Schema.decodeUnknownEffect(codec)(json)
      assert.isTrue(back.eq(d))
      const bad = yield* Effect.flip(
        Schema.decodeUnknownEffect(codec)({ type: "doc", content: [{ type: "text", text: "x" }] })
      )
      assert.match(bad.message, /Invalid content/)
    }))

  it.effect("validates attrs with Effect schemas", () =>
    Effect.gen(function*() {
      const s = yield* DocSchema.make({
        nodes: {
          doc: { content: Content.oneOrMore("heading") },
          heading: {
            content: Content.zeroOrMore("text"),
            attrs: { level: { schema: Schema.Literals([1, 2]), default: 1 } }
          },
          text: {}
        }
      })
      const h = yield* s.nodes.heading.create({ level: 2 })
      assert.strictEqual(h.attrs.level, 2)
      const bad = yield* s.nodes.heading.create({ level: 3 as any })
      const err = yield* Effect.flip(bad.check())
      assert.strictEqual(err._tag, "AttributeError")
      assert.isTrue(Option.isSome(s.nodes.doc.contentMatch.defaultType))
    }))

  it.effect("reports schema definition errors", () =>
    Effect.gen(function*() {
      const err = yield* Effect.flip(DocSchema.make({ nodes: { doc: { content: Content.ref("nope") }, text: {} } }))
      assert.strictEqual(err._tag, "SchemaDefinitionError")
    }))
})
