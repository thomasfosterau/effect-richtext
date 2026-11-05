/**
 * Internal helpers for mark steps: `pushMarkStep` and the `MarkSetStep`
 * that inverting a mark step can produce. Not part of the public API
 * (prosemirror-transform keeps both private too).
 *
 * Ported from prosemirror-transform 1.12.3 / 1.12.4 (MIT, Marijn Haverbeke and others).
 *
 * @internal
 */
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
  const last = target.length ? target[target.length - 1]! : null
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
  constructor(readonly steps: ReadonlyArray<AddMarkStep<Sc> | RemoveMarkStep<Sc>>) {
    super()
  }

  apply(doc: Node<Sc>): StepResult<Sc> {
    for (const step of this.steps) {
      const result = step.apply(doc)
      if (result.docOrNull === null) return result
      doc = result.docOrNull
    }
    return StepResult.ok(doc)
  }

  invert(doc: Node<Sc>): Step<Sc> {
    return new MarkSetStep(this.steps.map((s) => s.invert(doc) as AddMarkStep<Sc> | RemoveMarkStep<Sc>))
  }

  map(mapping: Mappable): Option.Option<Step<Sc>> {
    const result: Array<AddMarkStep<Sc> | RemoveMarkStep<Sc>> = []
    for (const step of this.steps) {
      const mapped = step.map(mapping)
      if (Option.isSome(mapped)) result.push(mapped.value as AddMarkStep<Sc> | RemoveMarkStep<Sc>)
    }
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
