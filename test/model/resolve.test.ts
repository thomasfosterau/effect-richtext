// Ported from prosemirror-model/test/test-resolve.ts (MIT, Marijn Haverbeke and others)
import { assert, describe, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import { blockquote, doc, em, p } from "effect-richtext/test-builder"
import ist from "../utils/ist.ts"

const testDoc = doc(p("ab"), blockquote(p(em("cd"), "ef")))
const _doc = { node: testDoc, start: 0, end: 12 }
const _p1 = { node: testDoc.childUnsafe(0), start: 1, end: 3 }
const _blk = { node: testDoc.childUnsafe(1), start: 5, end: 11 }
const _p2 = { node: _blk.node.childUnsafe(0), start: 6, end: 10 }

describe("Node", () => {
  describe("resolve", () => {
    it("should reflect the document structure", () => {
      const expected: { [pos: number]: Array<any> } = {
        0: [_doc, 0, null, _p1.node],
        1: [_doc, _p1, 0, null, "ab"],
        2: [_doc, _p1, 1, "a", "b"],
        3: [_doc, _p1, 2, "ab", null],
        4: [_doc, 4, _p1.node, _blk.node],
        5: [_doc, _blk, 0, null, _p2.node],
        6: [_doc, _blk, _p2, 0, null, "cd"],
        7: [_doc, _blk, _p2, 1, "c", "d"],
        8: [_doc, _blk, _p2, 2, "cd", "ef"],
        9: [_doc, _blk, _p2, 3, "e", "f"],
        10: [_doc, _blk, _p2, 4, "ef", null],
        11: [_doc, _blk, 6, _p2.node, null],
        12: [_doc, 12, _blk.node, null]
      }

      for (let pos = 0; pos <= testDoc.content.size; pos++) {
        const $pos = testDoc.resolveUnsafe(pos), exp = expected[pos]!
        ist($pos.depth, exp.length - 4)
        for (let i = 0; i < exp.length - 3; i++) {
          ist($pos.node(i).eq(exp[i].node))
          ist($pos.start(i), exp[i].start)
          ist($pos.end(i), exp[i].end)
          if (i) {
            ist($pos.beforeUnsafe(i), exp[i].start - 1)
            ist($pos.afterUnsafe(i), exp[i].end + 1)
          }
        }
        ist($pos.parentOffset, exp[exp.length - 3])
        const before = Option.getOrNull($pos.nodeBefore), eBefore = exp[exp.length - 2]
        ist(typeof eBefore == "string" ? before!.textContent : before, eBefore)
        const after = Option.getOrNull($pos.nodeAfter), eAfter = exp[exp.length - 1]
        ist(typeof eAfter == "string" ? after!.textContent : after, eAfter)
      }
    })

    it("has a working posAtIndex method", () => {
      const d = doc(blockquote(p("one"), blockquote(p("two ", em("three")), p("four"))))
      const pThree = d.resolveUnsafe(12) // Start of em("three")
      ist(pThree.posAtIndex(0), 8)
      ist(pThree.posAtIndex(1), 12)
      ist(pThree.posAtIndex(2), 17)
      ist(pThree.posAtIndex(0, 2), 7)
      ist(pThree.posAtIndex(1, 2), 18)
      ist(pThree.posAtIndex(2, 2), 24)
      ist(pThree.posAtIndex(0, 1), 1)
      ist(pThree.posAtIndex(1, 1), 6)
      ist(pThree.posAtIndex(2, 1), 25)
      ist(pThree.posAtIndex(0, 0), 0)
      ist(pThree.posAtIndex(1, 0), 26)
    })

    // -------------------------------------------------------------------------
    // effect-richtext specific
    // -------------------------------------------------------------------------

    it.effect("fails with a PositionError for out-of-range positions", () =>
      Effect.gen(function*() {
        for (const pos of [-1, 13, 100]) {
          const err = yield* Effect.flip(testDoc.resolve(pos))
          assert.strictEqual(err._tag, "PositionError")
          assert.match(err.message, /out of range/)
          ist.throws(() => testDoc.resolveUnsafe(pos), /out of range/)
        }
        const $pos = yield* testDoc.resolve(12)
        assert.strictEqual($pos.pos, 12)
      }))

    it.effect("before/after fail at depth 0", () =>
      Effect.gen(function*() {
        const $pos = testDoc.resolveUnsafe(2)
        assert.strictEqual(yield* $pos.before(1), 0)
        assert.strictEqual(yield* $pos.after(1), 4)
        const before = yield* Effect.flip($pos.before(0))
        assert.strictEqual(before._tag, "PositionError")
        const after = yield* Effect.flip($pos.after(0))
        assert.strictEqual(after._tag, "PositionError")
        ist.throws(() => $pos.beforeUnsafe(0), /no position before the top-level node/)
        ist.throws(() => $pos.afterUnsafe(0), /no position after the top-level node/)
      }))

    it("returns Option for nodeBefore/nodeAfter at the edges", () => {
      assert.isTrue(Option.isNone(testDoc.resolveUnsafe(0).nodeBefore))
      assert.isTrue(Option.isNone(testDoc.resolveUnsafe(12).nodeAfter))
      assert.isTrue(Option.isSome(testDoc.resolveUnsafe(0).nodeAfter))
    })

    it("computes block ranges", () => {
      const range = Option.getOrThrow(testDoc.resolveUnsafe(7).blockRange(testDoc.resolveUnsafe(9)))
      assert.strictEqual(range.depth, 1)
      assert.strictEqual(range.start, 5)
      assert.strictEqual(range.end, 11)
      assert.strictEqual(range.startIndex, 0)
      assert.strictEqual(range.endIndex, 1)
      const top = Option.getOrThrow(testDoc.resolveUnsafe(2).blockRange(testDoc.resolveUnsafe(7)))
      assert.strictEqual(top.depth, 0)
      assert.strictEqual(top.start, 0)
      assert.strictEqual(top.end, 12)
      assert.isTrue(Option.isNone(testDoc.resolveUnsafe(2).blockRange(testDoc.resolveUnsafe(7), () => false)))
    })
  })
})
