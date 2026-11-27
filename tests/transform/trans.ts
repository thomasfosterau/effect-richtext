// Ported from prosemirror-transform/test/trans.ts (MIT, Marijn Haverbeke and others)
import * as Rec from "effect/Record"
import * as Arr from "effect/Array"
import * as Schema from "effect/Schema"
import type { Node } from "@thomasfosterau/effect-richtext/Model"
import { eq } from "@thomasfosterau/effect-richtext/TestBuilder"
import { Mapping, Step, StepFromJSON, Transform } from "@thomasfosterau/effect-richtext/Transform"
import ist from "../utils/ist.ts"
import { tagsOf } from "../utils/tags.ts"
import { jsonRoundTrip } from "../utils/json.ts"

function invert(transform: Transform<any>): Transform<any> {
  const out = new Transform(transform.doc)
  Arr.reverse(transform.steps.map((step, i) => step.invert(transform.docs[i]))).forEach((step) => out.stepUnsafe(step))
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

function testStepJSON(tr: Transform<any>) {
  const schema = tr.doc.type.schema
  const newTR = new Transform(tr.before)
  tr.steps.forEach((step) => newTR.stepUnsafe(Step.fromJSONUnsafe(schema, step.toJSON())))
  ist(tr.doc, newTR.doc, eq)

  // Also round-trip through the Effect Schema codec.
  const codec = StepFromJSON(schema)
  const viaCodec = new Transform(tr.before)
  tr.steps.forEach((step) => {
    const json = Schema.encodeSync(codec)(step)
    viaCodec.stepUnsafe(Schema.decodeUnknownSync(codec)(jsonRoundTrip(json)))
  })
  ist(tr.doc, viaCodec.doc, eq)
}

export function testTransform(tr: Transform<any>, expect: Node<any>) {
  ist(tr.doc, expect, eq)
  ist(invert(tr).doc, tr.before, eq)

  testStepJSON(tr)

  const expectTags = tagsOf(expect),
    beforeTags = tagsOf(tr.before)
  Rec.keys(expectTags).forEach((tag) => testMapping(tr.mapping, beforeTags[tag], expectTags[tag]))
}
