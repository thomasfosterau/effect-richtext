// Ported from prosemirror-transform/test/trans.ts (MIT, Marijn Haverbeke and others).
// Changes: imports only (ProseMirror packages -> effect-richtext/compat/*, ist ->
// ../../utils/ist.ts, mocha describe/it -> @effect/vitest; type-only imports
// marked as such), formatting, and the EMIT_JSON transform-dumping helper
// removed (a debugging aid for other implementations, never used here).
import type { Node } from "effect-richtext/compat/model"
import { eq } from "effect-richtext/compat/test-builder"
import { Mapping, Step, Transform } from "effect-richtext/compat/transform"
import ist from "../../utils/ist.ts"

function invert(transform: Transform) {
  const out = new Transform(transform.doc)
  for (let i = transform.steps.length - 1; i >= 0; i--) {
    out.step(transform.steps[i].invert(transform.docs[i]))
  }
  return out
}

function testMapping(mapping: Mapping, pos: number, newPos: number) {
  const mapped = mapping.map(pos, 1)
  ist(mapped, newPos)

  const remap = new Mapping(mapping.maps.map((m) => m.invert()))
  for (let i = mapping.maps.length - 1, mapFrom = mapping.maps.length; i >= 0; i--) {
    remap.appendMap(mapping.maps[i], --mapFrom)
  }
  ist(remap.map(pos, 1), pos)
}

function testStepJSON(tr: Transform) {
  const newTR = new Transform(tr.before)
  tr.steps.forEach((step) => newTR.step(Step.fromJSON(tr.doc.type.schema, step.toJSON())))
  ist(tr.doc, newTR.doc, eq)
}

export function testTransform(tr: Transform, expect: Node) {
  ist(tr.doc, expect, eq)
  ist(invert(tr).doc, tr.before, eq)

  testStepJSON(tr)

  for (const tag in (expect as any).tag) {
    testMapping(tr.mapping, (tr.before as any).tag[tag], (expect as any).tag[tag])
  }
}
