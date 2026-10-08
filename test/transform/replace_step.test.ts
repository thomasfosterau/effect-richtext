// Ported from prosemirror-transform/test/test-replace_step.ts (MIT, Marijn Haverbeke and others)
import { describe, it } from "@effect/vitest"
import { Option } from "effect"
import type { Node } from "effect-richtext/model"
import { blockquote, doc, eq, p, schema } from "effect-richtext/test-builder"
import { Transform } from "effect-richtext/transform"
import ist from "../utils/ist.ts"

describe("ReplaceAroundStep.map", () => {
  function test(
    doc: Node<any>,
    change: (tr: Transform<any>) => void,
    otherChange: (tr: Transform<any>) => void,
    expected: Node<any>
  ) {
    const trA = new Transform(doc), trB = new Transform(doc)
    change(trA)
    otherChange(trB)
    const result = new Transform(trB.doc).stepUnsafe(Option.getOrThrow(trA.steps[0]!.map(trB.mapping))).doc
    ist(result, expected, eq)
  }

  it("doesn't break wrap steps on insertions", () =>
    test(
      doc(p("a")),
      (tr) =>
        tr.wrapUnsafe(Option.getOrThrow(tr.doc.resolveUnsafe(1).blockRange()), [{ type: schema.nodes.blockquote }]),
      (tr) => tr.insertUnsafe(0, p("b")),
      doc(p("b"), blockquote(p("a")))
    ))

  it("doesn't overwrite content inserted at start of unwrap step", () =>
    test(
      doc(blockquote(p("a"))),
      (tr) => tr.liftUnsafe(Option.getOrThrow(tr.doc.resolveUnsafe(2).blockRange()), 0),
      (tr) => tr.insertUnsafe(2, schema.textUnsafe("x")),
      doc(p("xa"))
    ))
})
