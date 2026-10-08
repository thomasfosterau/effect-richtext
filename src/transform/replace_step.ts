/**
 * Replace steps.
 *
 * @since 0.1.0
 */
import * as Option from "effect/Option"
import { type AnySchema, JSONError, type Node, Slice } from "../model.ts"
import { type Mappable, StepMap } from "./map.ts"
import { Step, type StepJSON, StepResult } from "./step.ts"

/**
 * Replace a part of the document with a slice of new content.
 *
 * @since 0.1.0
 * @category steps
 */
export class ReplaceStep<Sc extends AnySchema = AnySchema> extends Step<Sc> {
  /**
   * The given `slice` should fit the 'gap' between `from` and `to`—the
   * depths must line up, and the surrounding nodes must be able to be
   * joined with the open sides of the slice. When `structure` is true,
   * the step will fail if the content between from and to is not just
   * a sequence of closing and then opening tokens (this is to guard
   * against rebased replace steps overwriting something they weren't
   * supposed to).
   */
  constructor(
    /** The start position of the replaced range. */
    readonly from: number,
    /** The end position of the replaced range. */
    readonly to: number,
    /** The slice to insert. */
    readonly slice: Slice<Sc>,
    /** @internal */
    readonly structure = false
  ) {
    super()
  }

  apply(doc: Node<Sc>): StepResult<Sc> {
    if (this.structure && contentBetween(doc, this.from, this.to)) {
      return StepResult.fail("Structure replace would overwrite content")
    }
    return StepResult.fromReplace(doc, this.from, this.to, this.slice)
  }

  override getMap(): StepMap {
    return new StepMap([this.from, this.to - this.from, this.slice.size])
  }

  invert(doc: Node<Sc>): Step<Sc> {
    return new ReplaceStep(this.from, this.from + this.slice.size, doc.sliceUnsafe(this.from, this.to))
  }

  map(mapping: Mappable): Option.Option<Step<Sc>> {
    const to = mapping.mapResult(this.to, -1)
    const from = this.from === this.to && ReplaceStep.MAP_BIAS < 0 ? to : mapping.mapResult(this.from, 1)
    if (from.deletedAcross && to.deletedAcross) return Option.none()
    return Option.some(new ReplaceStep(from.pos, Math.max(from.pos, to.pos), this.slice, this.structure))
  }

  override merge(other: Step<Sc>): Option.Option<Step<Sc>> {
    if (!(other instanceof ReplaceStep) || other.structure || this.structure) return Option.none()

    if (this.from + this.slice.size === other.from && !this.slice.openEnd && !other.slice.openStart) {
      const slice = this.slice.size + other.slice.size === 0
        ? Slice.empty
        : new Slice(this.slice.content.append(other.slice.content), this.slice.openStart, other.slice.openEnd)
      return Option.some(new ReplaceStep(this.from, this.to + (other.to - other.from), slice, this.structure))
    } else if (other.to === this.from && !this.slice.openStart && !other.slice.openEnd) {
      const slice = this.slice.size + other.slice.size === 0
        ? Slice.empty
        : new Slice(other.slice.content.append(this.slice.content), other.slice.openStart, this.slice.openEnd)
      return Option.some(new ReplaceStep(other.from, this.to, slice, this.structure))
    }
    return Option.none()
  }

  toJSON(): StepJSON {
    const json: Record<string, unknown> & { stepType: string } = { stepType: "replace", from: this.from, to: this.to }
    if (this.slice.size) json.slice = this.slice.toJSON()
    if (this.structure) json.structure = true
    return json
  }

  /** @internal */
  static override fromJSONUnsafe<Sc extends AnySchema>(schema: Sc, json: any): ReplaceStep<Sc> {
    if (typeof json.from !== "number" || typeof json.to !== "number") {
      throw new JSONError({ message: "Invalid input for ReplaceStep.fromJSON" })
    }
    return new ReplaceStep(json.from, json.to, Slice.fromJSONUnsafe(schema, json.slice), !!json.structure)
  }

  /**
   * By default, for backwards compatibility, an inserting step mapped
   * over an insertion at that same position fill move after the
   * inserted content. In a collaborative editing situation, that can
   * make redone insertions appear in unexpected places. You can set
   * this to -1 to make such mapping keep the step before the insertion
   * instead.
   */
  static MAP_BIAS: -1 | 1 = 1
}

Step.jsonID("replace", ReplaceStep)

/**
 * Replace a part of the document with a slice of content, but preserve
 * a range of the replaced content by moving it into the slice.
 *
 * @since 0.1.0
 * @category steps
 */
export class ReplaceAroundStep<Sc extends AnySchema = AnySchema> extends Step<Sc> {
  /**
   * Create a replace-around step with the given range and gap.
   * `insert` should be the point in the slice into which the content of
   * the gap should be moved. `structure` has the same meaning as it has
   * in the `ReplaceStep` class.
   */
  constructor(
    /** The start position of the replaced range. */
    readonly from: number,
    /** The end position of the replaced range. */
    readonly to: number,
    /** The start of preserved range. */
    readonly gapFrom: number,
    /** The end of preserved range. */
    readonly gapTo: number,
    /** The slice to insert. */
    readonly slice: Slice<Sc>,
    /** The position in the slice where the preserved range should be inserted. */
    readonly insert: number,
    /** @internal */
    readonly structure = false
  ) {
    super()
  }

  apply(doc: Node<Sc>): StepResult<Sc> {
    if (
      this.structure && (contentBetween(doc, this.from, this.gapFrom) ||
        contentBetween(doc, this.gapTo, this.to))
    ) {
      return StepResult.fail("Structure gap-replace would overwrite content")
    }

    const gap = doc.sliceUnsafe(this.gapFrom, this.gapTo)
    if (gap.openStart || gap.openEnd) return StepResult.fail("Gap is not a flat range")
    const inserted = this.slice.insertAt(this.insert, gap.content)
    if (!inserted) return StepResult.fail("Content does not fit in gap")
    return StepResult.fromReplace(doc, this.from, this.to, inserted)
  }

  override getMap(): StepMap {
    return new StepMap([
      this.from,
      this.gapFrom - this.from,
      this.insert,
      this.gapTo,
      this.to - this.gapTo,
      this.slice.size - this.insert
    ])
  }

  invert(doc: Node<Sc>): Step<Sc> {
    const gap = this.gapTo - this.gapFrom
    return new ReplaceAroundStep(
      this.from,
      this.from + this.slice.size + gap,
      this.from + this.insert,
      this.from + this.insert + gap,
      doc.sliceUnsafe(this.from, this.to).removeBetween(this.gapFrom - this.from, this.gapTo - this.from),
      this.gapFrom - this.from,
      this.structure
    )
  }

  map(mapping: Mappable): Option.Option<Step<Sc>> {
    const from = mapping.mapResult(this.from, 1), to = mapping.mapResult(this.to, -1)
    const gapFrom = this.from === this.gapFrom ? from.pos : mapping.map(this.gapFrom, -1)
    const gapTo = this.to === this.gapTo ? to.pos : mapping.map(this.gapTo, 1)
    if ((from.deletedAcross && to.deletedAcross) || gapFrom < from.pos || gapTo > to.pos) return Option.none()
    return Option.some(
      new ReplaceAroundStep(from.pos, to.pos, gapFrom, gapTo, this.slice, this.insert, this.structure)
    )
  }

  toJSON(): StepJSON {
    const json: Record<string, unknown> & { stepType: string } = {
      stepType: "replaceAround",
      from: this.from,
      to: this.to,
      gapFrom: this.gapFrom,
      gapTo: this.gapTo,
      insert: this.insert
    }
    if (this.slice.size) json.slice = this.slice.toJSON()
    if (this.structure) json.structure = true
    return json
  }

  /** @internal */
  static override fromJSONUnsafe<Sc extends AnySchema>(schema: Sc, json: any): ReplaceAroundStep<Sc> {
    if (
      typeof json.from !== "number" || typeof json.to !== "number" ||
      typeof json.gapFrom !== "number" || typeof json.gapTo !== "number" || typeof json.insert !== "number"
    ) {
      throw new JSONError({ message: "Invalid input for ReplaceAroundStep.fromJSON" })
    }
    return new ReplaceAroundStep(
      json.from,
      json.to,
      json.gapFrom,
      json.gapTo,
      Slice.fromJSONUnsafe(schema, json.slice),
      json.insert,
      !!json.structure
    )
  }
}

Step.jsonID("replaceAround", ReplaceAroundStep)

function contentBetween(doc: Node<any>, from: number, to: number): boolean {
  const $from = doc.resolveUnsafe(from)
  let dist = to - from, depth = $from.depth
  while (dist > 0 && depth > 0 && $from.indexAfter(depth) === $from.node(depth).childCount) {
    depth--
    dist--
  }
  if (dist > 0) {
    let next: Node<any> | undefined = $from.node(depth).content.content[$from.indexAfter(depth)]
    while (dist > 0) {
      if (!next || next.isLeaf) return true
      next = next.content.content[0]
      dist--
    }
  }
  return false
}
