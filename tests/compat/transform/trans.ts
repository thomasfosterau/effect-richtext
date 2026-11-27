// Ported from prosemirror-transform/test/trans.ts (MIT, Marijn Haverbeke and others).
// Changes: imports only (ProseMirror packages -> @thomasfosterau/effect-richtext/compat/*, ist ->
// ../../utils/ist.ts, mocha describe/it -> @effect/vitest; type-only imports
// marked as such), formatting, and the EMIT_JSON transform-dumping helper
// removed (a debugging aid for other implementations, never used here).
import * as Rec from "effect/Record"
import * as Arr from "effect/Array"
import type { Node } from "@thomasfosterau/effect-richtext/compat/model"
import { eq } from "@thomasfosterau/effect-richtext/compat/test-builder"
import { Mapping, Step, Transform } from "@thomasfosterau/effect-richtext/compat/transform"
import ist from "../../utils/ist.ts"
import { tagsOf } from "../../utils/tags.ts"

function invert(transform: Transform) {
  const out = new Transform(transform.doc)
  Arr.reverse(transform.steps.map((step, i) => step.invert(transform.docs[i]))).forEach((step) => out.step(step))
  return out
}

function testMapping(mapping: Mapping, pos: number, newPos: number) {
  const mapped = mapping.map(pos, 1)
  ist(mapped, newPos)

  const remap = new Mapping(mapping.maps.map((m) => m.invert()))
  // Each map mirrors its inverse, which sits at the same index.
  Arr.reverse(mapping.maps.map((map, i) => [map, i] as const)).forEach(([map, i]) => remap.appendMap(map, i))
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

  Rec.keys(tagsOf(expect)).forEach((tag) => testMapping(tr.mapping, tagsOf(tr.before)[tag], tagsOf(expect)[tag]))
}
