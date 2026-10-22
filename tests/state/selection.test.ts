// Ported from prosemirror-state/test/test-selection.ts (MIT, Marijn Haverbeke and others)
import { assert, describe, it } from "@effect/vitest"
import { Effect, Option, Schema } from "effect"
import { AllSelection, NodeSelection, Selection, SelectionFromJSON, TextSelection } from "effect-richtext/state"
import { a, blockquote, br, doc, em, eq, hr, img, li, p, pre, schema, ul } from "effect-richtext/test-builder"
import ist from "../utils/ist.ts"
import { TestState } from "./state.ts"

describe("Selection", () => {
  it("should follow changes", () => {
    const state = new TestState({ doc: doc(p("hi")), schema })
    state.apply(state.tr.insertTextUnsafe("xy", 1))
    ist(state.selection.head, 3)
    ist(state.selection.anchor, 3)
    state.apply(state.tr.insertTextUnsafe("zq", 1))
    ist(state.selection.head, 5)
    ist(state.selection.anchor, 5)
    state.apply(state.tr.insertTextUnsafe("uv", 7))
    ist(state.selection.head, 5)
    ist(state.selection.anchor, 5)
  })

  it("should move after inserted content", () => {
    const state = new TestState({ doc: doc(p("hi")), schema })
    state.textSel(2, 3)
    state.apply(state.tr.insertTextUnsafe("o"))
    ist(state.selection.head, 3)
    ist(state.selection.anchor, 3)
  })

  it("moves after an inserted leaf node", () => {
    const state = new TestState({ doc: doc(p("foobar")), schema })
    state.textSel(4)
    state.apply(state.tr.replaceSelectionWith(schema.nodeUnsafe("horizontal_rule")))
    ist(state.doc, doc(p("foo"), hr(), p("bar")), eq)
    ist(state.selection.head, 7)
    state.textSel(10)
    state.apply(state.tr.replaceSelectionWith(schema.nodeUnsafe("horizontal_rule")))
    ist(state.doc, doc(p("foo"), hr(), p("bar"), hr()), eq)
    ist(state.selection.from, 11)
  })

  it("allows typing over a leaf node", () => {
    const state = new TestState({ doc: doc(p("a"), "<a>", hr(), p("b")), schema })
    state.nodeSel(3)
    state.apply(state.tr.replaceSelectionWith(schema.textUnsafe("x")))
    ist(state.doc, doc(p("a"), p("x"), p("b")), eq)
    ist(state.selection.head, 5)
    ist(state.selection.anchor, 5)
  })

  it("allows deleting a selected block", () => {
    const state = new TestState({ doc: doc(p("foo"), ul(li(p("bar")), li(p("baz")), li(p("quux")))), schema })
    state.nodeSel(0)
    state.deleteSelection()
    ist(state.doc, doc(ul(li(p("bar")), li(p("baz")), li(p("quux")))), eq)
    ist(state.selection.head, 3)
    state.nodeSel(2)
    state.deleteSelection()
    ist(state.doc, doc(ul(li(p("baz")), li(p("quux")))), eq)
    ist(state.selection.head, 3)
    state.nodeSel(9)
    state.deleteSelection()
    ist(state.doc, doc(ul(li(p("baz")))), eq)
    ist(state.selection.head, 6)
    state.nodeSel(0)
    state.deleteSelection()
    ist(state.doc, doc(p()), eq)
  })

  it("preserves the marks of a deleted selection", () => {
    const state = new TestState({ doc: doc(p("foo", em("<a>bar<b>"), "baz")) })
    state.deleteSelection()
    ist(Option.getOrThrow(state.state.storedMarks).length, 1)
  })

  it("doesn't preserve non-inclusive marks of a deleted selection", () => {
    const state = new TestState({ doc: doc(p("foo", a(em("<a>bar<b>")), "baz")) })
    state.deleteSelection()
    ist(Option.getOrThrow(state.state.storedMarks).length, 1)
  })

  it("doesn't preserve marks when deleting a selection at the end of a block", () => {
    const state = new TestState({ doc: doc(p("foo", em("bar<a>")), p("b<b>az")) })
    state.deleteSelection()
    ist(Option.isNone(state.state.storedMarks))
  })

  it("drops non-inclusive marks at the end of a deleted span when appropriate", () => {
    const state = new TestState({ doc: doc(p("foo", a("ba", em("<a>r<b>")), "baz")) })
    state.deleteSelection()
    ist(
      Option.getOrThrow(state.state.storedMarks)
        .map((x) => x.type.name)
        .join(),
      "em"
    )
  })

  it("keeps non-inclusive marks when still inside them", () => {
    const state = new TestState({ doc: doc(p("foo", a("b", em("<a>a<b>"), "r"), "baz")) })
    state.deleteSelection()
    ist(Option.getOrThrow(state.state.storedMarks).length, 2)
  })

  it("preserves marks when typing over marked text", () => {
    const state = new TestState({ doc: doc(p("foo ", em("<a>bar<b>"), " baz")) })
    state.apply(state.tr.insertTextUnsafe("quux"))
    ist(state.doc, doc(p("foo ", em("quux"), " baz")), eq)
    state.apply(state.tr.insertTextUnsafe("bar", 5, 9))
    ist(state.doc, doc(p("foo ", em("bar"), " baz")), eq)
  })

  it("allows deleting a leaf", () => {
    const state = new TestState({ doc: doc(p("a"), hr(), hr(), p("b")), schema })
    state.nodeSel(3)
    state.deleteSelection()
    ist(state.doc, doc(p("a"), hr(), p("b")), eq)
    ist(state.selection.from, 3)
    state.deleteSelection()
    ist(state.doc, doc(p("a"), p("b")), eq)
    ist(state.selection.head, 4)
  })

  it("properly handles deleting the selection", () => {
    const state = new TestState({ doc: doc(p("foo", img(), "bar"), blockquote(p("hi")), p("ay")), schema })
    state.nodeSel(4)
    state.apply(state.tr.deleteSelection())
    ist(state.doc, doc(p("foobar"), blockquote(p("hi")), p("ay")), eq)
    ist(state.selection.head, 4)
    state.nodeSel(9)
    state.apply(state.tr.deleteSelection())
    ist(state.doc, doc(p("foobar"), p("ay")), eq)
    ist(state.selection.from, 9)
    state.nodeSel(8)
    state.apply(state.tr.deleteSelection())
    ist(state.doc, doc(p("foobar")), eq)
    ist(state.selection.from, 7)
  })

  it("can replace inline selections", () => {
    const state = new TestState({ doc: doc(p("foo", img(), "bar", img(), "baz")), schema })
    state.nodeSel(4)
    state.apply(state.tr.replaceSelectionWith(schema.nodeUnsafe("hard_break")))
    ist(state.doc, doc(p("foo", br(), "bar", img(), "baz")), eq)
    ist(state.selection.head, 5)
    ist(state.selection.empty)
    state.nodeSel(8)
    state.apply(state.tr.insertTextUnsafe("abc"))
    ist(state.doc, doc(p("foo", br(), "barabcbaz")), eq)
    ist(state.selection.head, 11)
    ist(state.selection.empty)
    state.nodeSel(0)
    state.apply(state.tr.insertTextUnsafe("xyz"))
    ist(state.doc, doc(p("xyz")), eq)
  })

  it("can replace a block selection", () => {
    const state = new TestState({ doc: doc(p("abc"), hr(), hr(), blockquote(p("ow"))), schema })
    state.nodeSel(5)
    state.apply(state.tr.replaceSelectionWith(schema.nodeUnsafe("code_block")))
    ist(state.doc, doc(p("abc"), pre(), hr(), blockquote(p("ow"))), eq)
    ist(state.selection.from, 7)
    state.nodeSel(8)
    state.apply(state.tr.replaceSelectionWith(schema.nodeUnsafe("paragraph")))
    ist(state.doc, doc(p("abc"), pre(), hr(), p()), eq)
    ist(state.selection.from, 9)
  })

  it("puts the cursor after the inserted text when inserting a list item", () => {
    const state = new TestState({ doc: doc(p("<a>abc")) })
    const source = doc(ul(li(p("<a>def<b>"))))
    state.apply(state.tr.replaceSelection(source.sliceUnsafe(source.tag.a!, source.tag.b!, true)))
    ist(state.selection.from, 6)
  })
})

describe("TextSelection.between", () => {
  it("uses arguments when possible", () => {
    const d = doc(p("f<a>o<b>o"))
    const s = TextSelection.between(d.resolveUnsafe(d.tag.b!), d.resolveUnsafe(d.tag.a!))
    ist(s.anchor, d.tag.b)
    ist(s.head, d.tag.a)
  })

  it("will adjust when necessary", () => {
    const d = doc("<a>", p("foo"))
    const s = TextSelection.between(d.resolveUnsafe(d.tag.a!), d.resolveUnsafe(d.tag.a!))
    ist(s.anchor, 1)
  })

  it("uses bias when adjusting", () => {
    const d = doc(p("foo"), "<a>", p("bar")),
      pos = d.resolveUnsafe(d.tag.a!)
    const sUp = TextSelection.between(pos, pos, -1)
    ist(sUp.anchor, 4)
    const sDown = TextSelection.between(pos, pos, 1)
    ist(sDown.anchor, 6)
  })

  it("will fall back to a node selection", () => {
    const d = doc(hr, "<a>")
    const s = TextSelection.between(d.resolveUnsafe(d.tag.a!), d.resolveUnsafe(d.tag.a!))
    ist((s as NodeSelection).node, Option.getOrThrow(d.firstChild))
  })

  it("will collapse towards the other argument", () => {
    const d = doc("<a>", p("foo"), "<b>")
    let s = TextSelection.between(d.resolveUnsafe(d.tag.a!), d.resolveUnsafe(d.tag.b!))
    ist(s.anchor, 1)
    ist(s.head, 4)
    s = TextSelection.between(d.resolveUnsafe(d.tag.b!), d.resolveUnsafe(d.tag.a!))
    ist(s.anchor, 4)
    ist(s.head, 1)
  })
})

describe("Selection (Effect API)", () => {
  it("finds selections with options", () => {
    const d = doc(p("foo"), hr(), p("bar"))
    ist(Option.getOrThrow(Selection.findFrom(d.resolveUnsafe(0), 1)).from, 1)
    ist(Option.isNone(Selection.findFrom(d.resolveUnsafe(0), -1)))
    ist(Option.isSome(Selection.findFrom(d.resolveUnsafe(5), 1, false)))
    ist(Selection.atEnd(d).from, 10)
    const allHr = doc(hr())
    ist(Option.isNone(Selection.findFrom(allHr.resolveUnsafe(0), 1, true)))
    ist(Selection.near(allHr.resolveUnsafe(0)) instanceof NodeSelection)
    ist(Option.isSome(TextSelection.createUnsafe(d, 2).$cursor))
    ist(Option.isNone(TextSelection.createUnsafe(d, 2, 3).$cursor))
  })

  it.effect("creates selections as effects", () =>
    Effect.gen(function* () {
      const d = doc(p("foo"), hr())
      const sel = yield* TextSelection.create(d, 1, 3)
      ist(sel.from, 1)
      ist(sel.to, 3)
      const posErr = yield* Effect.flip(TextSelection.create(d, 100))
      assert.strictEqual(posErr._tag, "PositionError")
      const nodeSel = yield* NodeSelection.create(d, 5)
      ist(nodeSel.node.type.name, "horizontal_rule")
      ist(!nodeSel.visible)
      const selErr = yield* Effect.flip(NodeSelection.create(d, 6))
      assert.strictEqual(selErr._tag, "SelectionError")
    })
  )

  it.effect("round-trips selections through JSON", () =>
    Effect.gen(function* () {
      const d = doc(p("foo"), hr())
      const codec = SelectionFromJSON(d)
      for (const sel of [TextSelection.createUnsafe(d, 1, 3), NodeSelection.createUnsafe(d, 5), new AllSelection(d)]) {
        const json = yield* Schema.encodeEffect(codec)(sel)
        assert.deepStrictEqual(json, sel.toJSON())
        const back = yield* Schema.decodeUnknownEffect(codec)(JSON.parse(JSON.stringify(json)))
        ist(back.eq(sel))
        const viaFromJSON = yield* Selection.fromJSON(d, json)
        ist(viaFromJSON.eq(sel))
      }
      const bad = yield* Effect.flip(Schema.decodeUnknownEffect(codec)({ type: "bogus" }))
      assert.match(bad.message, /No selection type bogus/)
      const err = yield* Effect.flip(Selection.fromJSON(d, { type: "text", anchor: 1 }))
      assert.strictEqual(err._tag, "JSONError")
    })
  )

  it("maps bookmarks", () => {
    const state = new TestState({ doc: doc(p("f<a>oo")) })
    const bookmark = state.selection.getBookmark()
    const tr = state.tr.insertTextUnsafe("xx", 1)
    const resolved = bookmark.map(tr.mapping).resolve(tr.doc)
    ist(resolved.from, 4)
    const nodeState = new TestState({ doc: doc(p("a"), "<a>", hr()) })
    const nodeBookmark = nodeState.selection.getBookmark()
    const tr2 = nodeState.tr.insertTextUnsafe("b", 2)
    const resolvedNode = nodeBookmark.map(tr2.mapping).resolve(tr2.doc)
    ist(resolvedNode instanceof NodeSelection)
    ist(resolvedNode.from, 4)
  })
})
