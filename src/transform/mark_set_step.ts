/**
 * Internal helpers for mark steps: `pushMarkStep` and the `MarkSetStep`
 * that inverting a mark step can produce. Not part of the public API
 * (prosemirror-transform keeps both private too).
 *
 * Ported from prosemirror-transform 1.12.3 / 1.12.4 (MIT, Marijn Haverbeke and others).
 *
 * @internal
 */
import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import { type AnySchema, JSONError, type Mark, type Node } from "../model.ts"
import type { Mappable } from "./map.ts"
import type { AddMarkStep, RemoveMarkStep } from "./mark_step.ts"
import { Step, type StepJSON, StepResult } from "./step.ts"

/**
 * Append a mark step to `target`, extending the last step instead when
 * it is of the same class, carries an equal mark, and ends at `from`.
 *
 * @internal
 */
export function pushMarkStep<Sc extends AnySchema>(
  cls: typeof AddMarkStep | typeof RemoveMarkStep,
  from: number,
  to: number,
  mark: Mark<Sc>,
  target: Array<AddMarkStep<Sc> | RemoveMarkStep<Sc>>
): void {
  const last = target.at(-1)
  if (last && last instanceof cls && last.to === from && last.mark.eq(mark)) {
    target[target.length - 1] = new cls(last.from, to, mark)
  } else {
    target.push(new cls(from, to, mark))
  }
}

/**
 * A group of mark steps applied as one, produced when inverting a mark
 * step needs more than one step. Serialized as `"markSet"`.
 *
 * @internal
 */
export class MarkSetStep<Sc extends AnySchema = AnySchema> extends Step<Sc> {
  // Mark steps, or groups of them once inverted or mapped.
  constructor(readonly steps: ReadonlyArray<Step<Sc>>) {
    super()
  }

  apply(doc: Node<Sc>): StepResult<Sc> {
    // Stops at the first failing step and returns its failure.
    return this.steps.reduce(
      (result, step) => (result.docOrNull === null ? result : step.apply(result.docOrNull)),
      StepResult.ok(doc)
    )
  }

  invert(doc: Node<Sc>): Step<Sc> {
    return new MarkSetStep(this.steps.map((s) => s.invert(doc)))
  }

  map(mapping: Mappable): Option.Option<Step<Sc>> {
    const result = Arr.getSomes(this.steps.map((step) => step.map(mapping)))
    return result.length ? Option.some(new MarkSetStep(result)) : Option.none()
  }

  toJSON(): StepJSON {
    return { stepType: "markSet", steps: this.steps.map((s) => s.toJSON()) }
  }

  /** @internal */
  static override fromJSONUnsafe<Sc extends AnySchema>(schema: Sc, json: any): MarkSetStep<Sc> {
    if (
      !Array.isArray(json.steps) ||
      !json.steps.every((s: any) => s && (s.stepType === "addMark" || s.stepType === "removeMark"))
    ) {
      throw new JSONError({ message: "Invalid JSON for MarkSetStep" })
    }
    return new MarkSetStep(json.steps.map((s: any) => Step.fromJSONUnsafe(schema, s)))
  }
}

Step.jsonID("markSet", MarkSetStep)

/**
 * The single step in `steps`, or a `MarkSetStep` grouping them.
 *
 * @internal
 */
export const markStepGroup = <Sc extends AnySchema>(steps: ReadonlyArray<Step<Sc>>): Step<Sc> => {
  const [only] = steps
  return steps.length === 1 && only ? only : new MarkSetStep(steps)
}
