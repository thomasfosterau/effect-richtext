import { afterEach, describe, it } from "@effect/vitest"
import { Fragment, Slice } from "@thomasfosterau/effect-richtext/compat/model"
import { schema } from "@thomasfosterau/effect-richtext/compat/test-builder"
import { ReplaceStep, StepMap } from "@thomasfosterau/effect-richtext/compat/transform"
import { ReplaceStep as CoreReplaceStep } from "@thomasfosterau/effect-richtext/Transform"
import ist from "../../utils/ist.ts"
import { instanceOf, present } from "../../utils/present.ts"

const insertX = () => new ReplaceStep(2, 2, new Slice(Fragment.from(schema.text("x")), 0, 0))
const insertionAt2 = new StepMap([2, 0, 1])
const mapOver = (step: ReplaceStep) => instanceOf(ReplaceStep, present(step.map(insertionAt2)))

describe("ReplaceStep.MAP_BIAS", () => {
  afterEach(() => {
    ReplaceStep.MAP_BIAS = 1
  })

  it("defaults to moving an insertion after one at the same position", () => {
    ist(ReplaceStep.MAP_BIAS, 1)
    ist(mapOver(insertX()).from, 3)
  })

  it("keeps the insertion before when set to -1", () => {
    ReplaceStep.MAP_BIAS = -1
    ist(CoreReplaceStep.MAP_BIAS, -1)
    const mapped = mapOver(insertX())
    ist(mapped.from, 2)
    ist(mapped.to, 2)
  })

  it("only affects inserting steps", () => {
    ReplaceStep.MAP_BIAS = -1
    ist(mapOver(new ReplaceStep(2, 4, Slice.empty)).from, 3)
  })
})
