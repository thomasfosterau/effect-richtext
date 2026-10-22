// Ported from prosemirror-transform/test/test-step.ts (MIT, Marijn Haverbeke and others)
import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { Fragment, Slice } from "effect-richtext/model"
import { doc, eq, p, schema } from "effect-richtext/test-builder"
import {
  AddMarkStep,
  RemoveMarkStep,
  ReplaceStep,
  Step,
  StepFromJSON,
  StepResult,
  Transform
} from "effect-richtext/transform"
import ist from "../utils/ist.ts"
import { getSome } from "../utils/option.ts"

const testDoc = doc(p("foobar"))

function mkStep(from: number, to: number, val: string | null): Step<any> {
  if (val == "+em") return new AddMarkStep(from, to, schema.markUnsafe("em"))
  else if (val == "-em") return new RemoveMarkStep(from, to, schema.markUnsafe("em"))
  else {
    return new ReplaceStep(from, to, val == null ? Slice.empty : new Slice(Fragment.from(schema.textUnsafe(val)), 0, 0))
  }
}

describe("Step", () => {
  describe("merge", () => {
    function yes(from1: number, to1: number, val1: string | null, from2: number, to2: number, val2: string | null) {
      return () => {
        const step1 = mkStep(from1, to1, val1),
          step2 = mkStep(from2, to2, val2)
        const merged = step1.merge(step2)
        ist(Option.isSome(merged))
        ist(getSome(merged).apply(testDoc).getUnsafe(), step2.apply(step1.apply(testDoc).getUnsafe()).getUnsafe(), eq)
      }
    }
    function no(from1: number, to1: number, val1: string | null, from2: number, to2: number, val2: string | null) {
      return () => {
        const step1 = mkStep(from1, to1, val1),
          step2 = mkStep(from2, to2, val2)
        ist(Option.isNone(step1.merge(step2)))
      }
    }

    it("merges typing changes", yes(2, 2, "a", 3, 3, "b"))

    it("merges inverse typing", yes(2, 2, "a", 2, 2, "b"))

    it("doesn't merge separated typing", no(2, 2, "a", 4, 4, "b"))

    it("doesn't merge inverted separated typing", no(3, 3, "a", 2, 2, "b"))

    it("merges adjacent backspaces", yes(3, 4, null, 2, 3, null))

    it("merges adjacent deletes", yes(2, 3, null, 2, 3, null))

    it("doesn't merge separate backspaces", no(1, 2, null, 2, 3, null))

    it("merges backspace and type", yes(2, 3, null, 2, 2, "x"))

    it("merges longer adjacent inserts", yes(2, 2, "quux", 6, 6, "baz"))

    it("merges inverted longer inserts", yes(2, 2, "quux", 2, 2, "baz"))

    it("merges longer deletes", yes(2, 5, null, 2, 4, null))

    it("merges inverted longer deletes", yes(4, 6, null, 2, 4, null))

    it("merges overwrites", yes(3, 4, "x", 4, 5, "y"))

    it("merges adding adjacent styles", yes(1, 2, "+em", 2, 4, "+em"))

    it("merges adding overlapping styles", yes(1, 3, "+em", 2, 4, "+em"))

    it("doesn't merge separate styles", no(1, 2, "+em", 3, 4, "+em"))

    it("merges removing adjacent styles", yes(1, 2, "-em", 2, 4, "-em"))

    it("merges removing overlapping styles", yes(1, 3, "-em", 2, 4, "-em"))

    it("doesn't merge removing separate styles", no(1, 2, "-em", 3, 4, "-em"))
  })

  describe("Effect API", () => {
    it.effect("applies steps as effects", () =>
      Effect.gen(function* () {
        const result = yield* mkStep(1, 1, "x").applyEffect(testDoc)
        ist(result, doc(p("xfoobar")), eq)
        const err = yield* Effect.flip(mkStep(1, 100, null).applyEffect(testDoc))
        assert.strictEqual(err._tag, "StepError")
      })
    )

    it("represents step results with options", () => {
      const ok = mkStep(1, 1, "x").apply(testDoc)
      ist(Option.isSome(ok.doc))
      ist(Option.isNone(ok.failed))
      const failed = new ReplaceStep(1, 3, new Slice(Fragment.from(p("x")), 0, 0)).apply(testDoc)
      ist(Option.isNone(failed.doc))
      ist(Option.isSome(failed.failed))
      ist.throws(() => failed.getUnsafe())
      ist(Option.isSome(StepResult.fail("nope").failed))
    })

    it.effect("fails Transform.step with a StepError", () =>
      Effect.gen(function* () {
        const tr = new Transform(testDoc)
        const err = yield* Effect.flip(tr.step(new ReplaceStep(1, 3, new Slice(Fragment.from(p("x")), 0, 0))))
        assert.strictEqual(err._tag, "StepError")
        ist(tr.steps.length, 0)
        const same = yield* tr.step(mkStep(1, 1, "y"))
        ist(same, tr)
        ist(tr.doc, doc(p("yfoobar")), eq)
      })
    )

    it.effect("decodes steps through the Effect Schema codec", () =>
      Effect.gen(function* () {
        const codec = StepFromJSON(schema)
        const step = mkStep(2, 4, "+em")
        const json = yield* Schema.encodeEffect(codec)(step)
        assert.deepStrictEqual(json, step.toJSON())
        const back = yield* Schema.decodeUnknownEffect(codec)(json)
        ist(back instanceof AddMarkStep)
        ist(back.apply(testDoc).getUnsafe(), step.apply(testDoc).getUnsafe(), eq)
        const bad = yield* Effect.flip(Schema.decodeUnknownEffect(codec)({ stepType: "nonsense" }))
        assert.match(bad.message, /No step type nonsense/)
        const err = yield* Effect.flip(Step.fromJSON(schema, { stepType: "replace", from: "x" }))
        assert.strictEqual(err._tag, "JSONError")
      })
    )

    it("refuses duplicate step JSON ids", () => {
      ist.throws(() => Step.jsonID("replace", ReplaceStep), /Duplicate use of step JSON ID/)
    })
  })
})
