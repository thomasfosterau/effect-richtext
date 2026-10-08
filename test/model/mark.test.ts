// Ported from prosemirror-model/test/test-mark.ts (MIT, Marijn Haverbeke and others)
import { assert, describe, it } from "@effect/vitest"
import { Effect, Equal, Hash, Option, Schema } from "effect"
import { Content, DocSchema, Mark, type Node } from "effect-richtext/model"
import { a, doc, em, p, schema, tagsOf } from "effect-richtext/test-builder"
import ist from "../utils/ist.ts"

const em_ = schema.markUnsafe("em")
const strong = schema.markUnsafe("strong")
const link = (href: string, title?: string) => schema.markUnsafe("link", { href, title: title ?? null })
const code = schema.markUnsafe("code")

const customSchema = DocSchema.makeUnsafe({
    nodes: {
      doc: { content: Content.parse("paragraph+") },
      paragraph: { content: Content.parse("text*") },
      text: {}
    },
    marks: {
      remark: { attrs: { id: {} }, excludes: "", inclusive: false },
      user: { attrs: { id: {} }, excludes: "_" },
      strong: { excludes: "em-group" },
      em: { group: "em-group" }
    }
  }),
  custom = customSchema.marks
const remark1 = custom.remark.createUnsafe({ id: 1 }),
  remark2 = custom.remark.createUnsafe({ id: 2 }),
  user1 = custom.user.createUnsafe({ id: 1 }),
  user2 = custom.user.createUnsafe({ id: 2 }),
  customEm = custom.em.createUnsafe(),
  customStrong = custom.strong.createUnsafe()

describe("Mark", () => {
  describe("sameSet", () => {
    it("returns true for two empty sets", () => ist(Mark.sameSet([], [])))

    it("returns true for simple identical sets", () => ist(Mark.sameSet([em_, strong], [em_, strong])))

    it("returns false for different sets", () => ist(!Mark.sameSet([em_, strong], [em_, code])))

    it("returns false when set size differs", () => ist(!Mark.sameSet([em_, strong], [em_, strong, code])))

    it("recognizes identical links in set", () =>
      ist(Mark.sameSet([link("http://foo"), code], [link("http://foo"), code])))

    it("recognizes different links in set", () =>
      ist(!Mark.sameSet([link("http://foo"), code], [link("http://bar"), code])))
  })

  describe("eq", () => {
    it("considers identical links to be the same", () => ist(link("http://foo").eq(link("http://foo"))))

    it("considers different links to differ", () => ist(!link("http://foo").eq(link("http://bar"))))

    it("considers links with different titles to differ", () =>
      ist(!link("http://foo", "A").eq(link("http://foo", "B"))))
  })

  describe("addToSet", () => {
    it("can add to the empty set", () => ist(em_.addToSet([]), [em_], Mark.sameSet))

    it("is a no-op when the added thing is in set", () => ist(em_.addToSet([em_]), [em_], Mark.sameSet))

    it("adds marks with lower rank before others", () => ist(em_.addToSet([strong]), [em_, strong], Mark.sameSet))

    it("adds marks with higher rank after others", () => ist(strong.addToSet([em_]), [em_, strong], Mark.sameSet))

    it("replaces different marks with new attributes", () =>
      ist(
        link("http://bar").addToSet([link("http://foo"), em_]),
        [link("http://bar"), em_],
        Mark.sameSet
      ))

    it("does nothing when adding an existing link", () =>
      ist(
        link("http://foo").addToSet([em_, link("http://foo")]),
        [em_, link("http://foo")],
        Mark.sameSet
      ))

    it("puts code marks at the end", () =>
      ist(
        code.addToSet([em_, strong, link("http://foo")]),
        [em_, strong, link("http://foo"), code],
        Mark.sameSet
      ))

    it("puts marks with middle rank in the middle", () =>
      ist(strong.addToSet([em_, code]), [em_, strong, code], Mark.sameSet))

    it("allows nonexclusive instances of marks with the same type", () =>
      ist(remark2.addToSet([remark1]), [remark1, remark2], Mark.sameSet))

    it("doesn't duplicate identical instances of nonexclusive marks", () =>
      ist(remark1.addToSet([remark1]), [remark1], Mark.sameSet))

    it("clears all others when adding a globally-excluding mark", () =>
      ist(user1.addToSet([remark1, customEm]), [user1], Mark.sameSet))

    it("does not allow adding another mark to a globally-excluding mark", () =>
      ist(customEm.addToSet([user1]), [user1], Mark.sameSet))

    it("does overwrite a globally-excluding mark when adding another instance", () =>
      ist(user2.addToSet([user1]), [user2], Mark.sameSet))

    it("doesn't add anything when another mark excludes the added mark", () =>
      ist(customEm.addToSet([remark1, customStrong]), [remark1, customStrong], Mark.sameSet))

    it("remove excluded marks when adding a mark", () =>
      ist(customStrong.addToSet([remark1, customEm]), [remark1, customStrong], Mark.sameSet))
  })

  describe("removeFromSet", () => {
    it("is a no-op for the empty set", () => ist(Mark.sameSet(em_.removeFromSet([]), [])))

    it("can remove the last mark from a set", () => ist(Mark.sameSet(em_.removeFromSet([em_]), [])))

    it("is a no-op when the mark isn't in the set", () => ist(Mark.sameSet(strong.removeFromSet([em_]), [em_])))

    it("can remove a mark with attributes", () =>
      ist(Mark.sameSet(link("http://foo").removeFromSet([link("http://foo")]), [])))

    it("doesn't remove a mark when its attrs differ", () =>
      ist(Mark.sameSet(link("http://foo", "title").removeFromSet([link("http://foo")]), [link("http://foo")])))
  })

  describe("ResolvedPos.marks", () => {
    function isAt(doc: Node, mark: Mark, result: boolean) {
      ist(mark.isInSet(doc.resolveUnsafe(tagsOf(doc).a!).marks()), result)
    }

    it("recognizes a mark exists inside marked text", () => isAt(doc(p(em("fo<a>o"))), em_, true))

    it("recognizes a mark doesn't exist in non-marked text", () => isAt(doc(p(em("fo<a>o"))), strong, false))

    it("considers a mark active after the mark", () => isAt(doc(p(em("hi"), "<a> there")), em_, true))

    it("considers a mark inactive before the mark", () => isAt(doc(p("one <a>", em("two"))), em_, false))

    it("considers a mark active at the start of the textblock", () => isAt(doc(p(em("<a>one"))), em_, true))

    it("notices that attributes differ", () => isAt(doc(p(a("li<a>nk"))), link("http://baz"), false))

    const customDoc = customSchema.nodeUnsafe("doc", null, [
      customSchema.nodeUnsafe("paragraph", null, [ // pos 1
        customSchema.textUnsafe("one", [remark1, customStrong]),
        customSchema.textUnsafe("two")
      ]),
      customSchema.nodeUnsafe("paragraph", null, [ // pos 9
        customSchema.textUnsafe("one"),
        customSchema.textUnsafe("two", [remark1]),
        customSchema.textUnsafe("three", [remark1])
      ]), // pos 22
      customSchema.nodeUnsafe("paragraph", null, [
        customSchema.textUnsafe("one", [remark2]),
        customSchema.textUnsafe("two", [remark1])
      ])
    ])

    it("omits non-inclusive marks at end of mark", () =>
      ist(Mark.sameSet(customDoc.resolveUnsafe(4).marks(), [customStrong])))

    it("includes non-inclusive marks inside a text node", () =>
      ist(Mark.sameSet(customDoc.resolveUnsafe(3).marks(), [remark1, customStrong])))

    it("omits non-inclusive marks at the end of a line", () =>
      ist(Mark.sameSet(customDoc.resolveUnsafe(20).marks(), [])))

    it("includes non-inclusive marks between two marked nodes", () =>
      ist(Mark.sameSet(customDoc.resolveUnsafe(15).marks(), [remark1])))

    it("excludes non-inclusive marks at a point where mark attrs change", () =>
      ist(Mark.sameSet(customDoc.resolveUnsafe(25).marks(), [])))
  })

  // ---------------------------------------------------------------------------
  // effect-richtext specific
  // ---------------------------------------------------------------------------

  describe("Equal", () => {
    it("compares marks structurally", () => {
      assert.isTrue(Equal.equals(link("http://foo"), link("http://foo")))
      assert.isFalse(Equal.equals(link("http://foo"), link("http://bar")))
      assert.isFalse(Equal.equals(em_, strong))
      assert.isTrue(Equal.equals(remark1, custom.remark.createUnsafe({ id: 1 })))
      assert.isFalse(Equal.equals(remark1, remark2))
      assert.strictEqual(Hash.hash(link("http://foo", "t")), Hash.hash(link("http://foo", "t")))
    })
  })

  describe("isInSet (MarkType)", () => {
    it("returns an Option", () => {
      assert.isTrue(Option.isSome(schema.marks.em.isInSet([strong, em_])))
      assert.isTrue(Option.isNone(schema.marks.code.isInSet([strong, em_])))
    })
  })

  describe("create", () => {
    it.effect("fails with an AttributeError for missing required attributes", () =>
      Effect.gen(function*() {
        const err = yield* Effect.flip(custom.remark.create())
        assert.strictEqual(err._tag, "AttributeError")
        assert.match(err.message, /No value supplied for attribute id/)
        ist.throws(() => custom.remark.createUnsafe(), /No value supplied for attribute id/)
      }))

    it.effect("fails for unknown mark types", () =>
      Effect.gen(function*() {
        const err = yield* Effect.flip(schema.mark("nope" as "em"))
        assert.strictEqual(err._tag, "AttributeError")
      }))
  })

  describe("JSON", () => {
    it("round-trips marks", () => {
      for (const mark of [em_, link("http://foo"), link("http://foo", "title")]) {
        ist(schema.markFromJSONUnsafe(mark.toJSON()), mark, (a, b) => a.eq(b))
      }
    })

    it.effect("validates attributes with their schemas", () =>
      Effect.gen(function*() {
        const err = yield* Effect.flip(schema.markFromJSON({ type: "link", attrs: { href: 5 } }))
        assert.strictEqual(err._tag, "JSONError")
        const unknown = yield* Effect.flip(schema.markFromJSON({ type: "nope" }))
        assert.strictEqual(unknown._tag, "JSONError")
      }))

    it("encodes attributes with their schemas", () => {
      const s = DocSchema.makeUnsafe({
        nodes: { doc: { content: Content.zeroOrMore("text") }, text: {} },
        marks: { at: { attrs: { when: Schema.DateFromMillis } } }
      })
      const date = new Date(0)
      const mark = s.marks.at.createUnsafe({ when: date })
      const json = mark.toJSON()
      assert.deepStrictEqual(json, { type: "at", attrs: { when: 0 } })
      const back = s.markFromJSONUnsafe(json)
      assert.instanceOf(back.attrs.when, Date)
      assert.strictEqual((back.attrs.when as Date).getTime(), 0)
    })
  })
})
