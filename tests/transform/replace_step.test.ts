// Ported from prosemirror-transform/test/test-replace_step.ts (MIT, Marijn Haverbeke and others)
import { describe, it } from "@effect/vitest"
import { Fragment, type Node, Slice } from "@thomasfosterau/effect-richtext/model"
import { blockquote, doc, eq, li, p, schema, ul } from "@thomasfosterau/effect-richtext/test-builder"
import { ReplaceAroundStep, Transform } from "@thomasfosterau/effect-richtext/transform"
import ist from "../utils/ist.ts"
import { getSome } from "../utils/option.ts"

function test(
  doc: Node<any>,
  change: (tr: Transform<any>) => void,
  otherChange: (tr: Transform<any>) => void,
  expected: Node<any>
) {
  const trA = new Transform(doc),
    trB = new Transform(doc)
  change(trA)
  otherChange(trB)
  const result = new Transform(trB.doc).stepUnsafe(getSome(trA.steps[0]!.map(trB.mapping))).doc
  ist(result, expected, eq)
}

describe("ReplaceAroundStep.map", () => {
  it("doesn't break wrap steps on insertions", () =>
    test(
      doc(p("a")),
      (tr) => tr.wrapUnsafe(getSome(tr.doc.resolveUnsafe(1).blockRange()), [{ type: schema.nodes.blockquote }]),
      (tr) => tr.insertUnsafe(0, p("b")),
      doc(p("b"), blockquote(p("a")))
    ))

  it("doesn't overwrite content inserted at start of unwrap step", () =>
    test(
      doc(blockquote(p("a"))),
      (tr) => tr.liftUnsafe(getSome(tr.doc.resolveUnsafe(2).blockRange()), 0),
      (tr) => tr.insertUnsafe(2, schema.textUnsafe("x")),
      doc(p("xa"))
    ))
})

describe("ReplaceAroundStep.apply", () => {
  // prosemirror-model 1.25.5: content constraints are not checked inside open
  // nodes when the gap is inserted, since those nodes are joined later.
  it("inserts the gap into an open node whose content is completed by the join", () => {
    const before = doc(ul(li(p("r"))), ul(li(p("x"))))
    const slice = new Slice(Fragment.from(ul(li())), 2, 0)
    const result = new ReplaceAroundStep(5, 14, 7, 14, slice, 0, true).apply(before).getUnsafe()
    ist(result, doc(ul(li(p("r"), ul(li(p("x")))))), eq)
  })
})
