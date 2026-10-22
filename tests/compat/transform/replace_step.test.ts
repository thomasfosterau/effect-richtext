// Ported from prosemirror-transform/test/test-replace_step.ts (MIT, Marijn Haverbeke and others).
// Changes: imports only (ProseMirror packages -> effect-richtext/compat/*, ist ->
// ../../utils/ist.ts, mocha describe/it -> @effect/vitest; type-only imports
// marked as such) and dprint formatting.
import { describe, it } from "@effect/vitest"
import type { Node } from "effect-richtext/compat/model"
import { blockquote, doc, eq, p, schema } from "effect-richtext/compat/test-builder"
import { Transform } from "effect-richtext/compat/transform"
import ist from "../../utils/ist.ts"

describe("ReplaceAroundStep.map", () => {
  function test(doc: Node, change: (tr: Transform) => void, otherChange: (tr: Transform) => void, expected: Node) {
    const trA = new Transform(doc),
      trB = new Transform(doc)
    change(trA)
    otherChange(trB)
    const result = new Transform(trB.doc).step(trA.steps[0].map(trB.mapping)!).doc
    ist(result, expected, eq)
  }

  it("doesn't break wrap steps on insertions", () =>
    test(
      doc(p("a")),
      (tr) => tr.wrap(tr.doc.resolve(1).blockRange()!, [{ type: schema.nodes.blockquote }]),
      (tr) => tr.insert(0, p("b")),
      doc(p("b"), blockquote(p("a")))
    ))

  it("doesn't overwrite content inserted at start of unwrap step", () =>
    test(
      doc(blockquote(p("a"))),
      (tr) => tr.lift(tr.doc.resolve(2).blockRange()!, 0),
      (tr) => tr.insert(2, schema.text("x")),
      doc(p("xa"))
    ))
})
