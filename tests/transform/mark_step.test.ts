// Regression tests for the mark-step changes in prosemirror-transform 1.12.3 / 1.12.4 (MIT, Marijn Haverbeke and others)
import { describe, it } from "@effect/vitest"
import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import type { Node } from "@thomasfosterau/effect-richtext/model"
import { a, doc, eq, em, p, schema } from "@thomasfosterau/effect-richtext/test-builder"
import {
  AddMarkStep,
  Mapping,
  RemoveMarkStep,
  Step,
  StepMap,
  Transform
} from "@thomasfosterau/effect-richtext/transform"
import ist from "../utils/ist.ts"
import { getSome } from "../utils/option.ts"

// Undo every step of `tr`, last first, and return the resulting document.
function undoAll(tr: Transform<any>): Node<any> {
  return Arr.zip(tr.steps, tr.docs).reduceRight((d, [step, before]) => step.invert(before).apply(d).getUnsafe(), tr.doc)
}

describe("mark steps", () => {
  it("restores marks excluded by an added mark when inverted", () => {
    // Links exclude each other, so adding href=b replaces href=a.
    const before = doc(p("x", a("foo"), "y"))
    const tr = new Transform(before).addMark(1, 6, schema.markUnsafe("link", { href: "b" }))
    ist(tr.steps.length, 1)
    ist(undoAll(tr), before, eq)
  })

  it("only re-adds a removed mark where it was present when inverted", () => {
    const before = doc(p("a", em("b"), "c"))
    const step = new RemoveMarkStep(1, 4, schema.markUnsafe("em"))
    const after = step.apply(before).getUnsafe()
    ist(after, doc(p("abc")), eq)
    ist(step.invert(before).apply(after).getUnsafe(), before, eq)
  })

  it("groups the steps of a multi-part inverse into a step that round-trips through JSON", () => {
    const before = doc(p(a("foo"), "bar"))
    const step = new AddMarkStep(1, 7, schema.markUnsafe("link", { href: "b" }))
    const inverse = step.invert(before)
    const json = inverse.toJSON()
    ist(json.stepType, "markSet")
    const after = step.apply(before).getUnsafe()
    const decoded = Step.fromJSONUnsafe(schema, json)
    ist(decoded.apply(after).getUnsafe(), before, eq)
    ist(getSome(decoded.map(new Mapping([StepMap.offset(1)]))).toJSON().stepType, "markSet")
  })

  it("adds no step for content that already has the mark", () => {
    const tr = new Transform(doc(p(em("foo"), "bar"))).addMark(1, 7, schema.markUnsafe("em"))
    ist(tr.steps.length, 1)
    const [step] = tr.steps
    ist(step instanceof AddMarkStep && step.from, 4)
  })

  it("maps through deletions that only cover one end", () => {
    const step = new AddMarkStep(2, 6, schema.markUnsafe("em"))
    const mapped = getSome(step.map(new Mapping([new StepMap([1, 2, 0])])))
    ist(mapped instanceof AddMarkStep && `${mapped.from}-${mapped.to}`, "1-4")
    ist(Option.isNone(step.map(new Mapping([new StepMap([1, 6, 0])]))))
  })
})
