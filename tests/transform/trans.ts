// Ported from prosemirror-transform/test/trans.ts (MIT, Marijn Haverbeke and others)
import { Schema } from "effect"
import type { Node } from "effect-richtext/model"
import { eq } from "effect-richtext/test-builder"
import { Mapping, Step, StepFromJSON, Transform } from "effect-richtext/transform"
import ist from "../utils/ist.ts"

function invert(transform: Transform<any>): Transform<any> {
  const out = new Transform(transform.doc)
  for (let i = transform.steps.length - 1; i >= 0; i--) {
    out.stepUnsafe(transform.steps[i]!.invert(transform.docs[i]!))
  }
  return out
}

function testMapping(mapping: Mapping, pos: number, newPos: number) {
  const mapped = mapping.map(pos, 1)
  ist(mapped, newPos)

  const remap = new Mapping(mapping.maps.map((m) => m.invert()))
  for (let i = mapping.maps.length - 1, mapFrom = mapping.maps.length; i >= 0; i--) {
    remap.appendMap(mapping.maps[i]!, --mapFrom)
  }
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
    viaCodec.stepUnsafe(Schema.decodeUnknownSync(codec)(JSON.parse(JSON.stringify(json))))
  })
  ist(tr.doc, viaCodec.doc, eq)
}

export function testTransform(tr: Transform<any>, expect: Node<any>) {
  ist(tr.doc, expect, eq)
  ist(invert(tr).doc, tr.before, eq)

  testStepJSON(tr)

  const expectTags = (expect as any).tag,
    beforeTags = (tr.before as any).tag
  for (const tag in expectTags) testMapping(tr.mapping, beforeTags[tag], expectTags[tag])
}
