/**
 * Mark steps.
 *
 * @since 0.1.0
 */
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import { type AnySchema, Fragment, JSONError, Mark, type Node, Slice } from "../model.ts"
import type { Mappable } from "./map.ts"
import { markStepGroup, pushMarkStep } from "./mark_set_step.ts"
import { Step, type StepJSON, StepResult } from "./step.ts"

function mapFragment<Sc extends AnySchema>(
  fragment: Fragment<Sc>,
  f: (child: Node<Sc>, parent: Node<Sc>, i: number) => Node<Sc>,
  parent: Node<Sc>
): Fragment<Sc> {
  const mapped: Array<Node<Sc>> = []
  for (let i = 0; i < fragment.childCount; i++) {
    let child = fragment.content[i]!
    if (child.content.size) child = child.copy(mapFragment(child.content, f, child) as any)
    if (child.isInline) child = f(child, parent, i)
    mapped.push(child)
  }
  return Fragment.fromArray(mapped)
}

// Replace `from`..`to` with its content after applying `f` to each
// inline node (with its parent; `parent` for the top level).
function replaceMarked<Sc extends AnySchema>(
  doc: Node<Sc>,
  from: number,
  to: number,
  parent: Node<Sc>,
  f: (node: Node<Sc>, parent: Node<Sc>) => Node<Sc>
): StepResult<Sc> {
  const oldSlice = doc.sliceUnsafe(from, to)
  const slice = new Slice(mapFragment(oldSlice.content, f, parent), oldSlice.openStart, oldSlice.openEnd)
  return StepResult.fromReplace(doc, from, to, slice)
}

// Build an inverse from the steps `visit` collects for each inline atom
// in `from`..`to` (given clamped to the range), grouped as one step.
function invertSteps<Sc extends AnySchema>(
  doc: Node<Sc>,
  from: number,
  to: number,
  visit: (node: Node<Sc>, from: number, to: number, steps: Array<AddMarkStep<Sc> | RemoveMarkStep<Sc>>) => void
): Step<Sc> {
  const steps: Array<AddMarkStep<Sc> | RemoveMarkStep<Sc>> = []
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.isInline && node.isAtom) visit(node, Math.max(from, pos), Math.min(to, pos + node.nodeSize), steps)
  })
  return markStepGroup(steps)
}

// Map a mark step's range by position alone (prosemirror-transform
// 1.12.3); none when it collapses.
const mapMarkRange = (mapping: Mappable, from: number, to: number): Option.Option<readonly [number, number]> => {
  const mappedFrom = mapping.map(from, 1),
    mappedTo = mapping.map(to, -1)
  return mappedFrom >= mappedTo ? Option.none() : Option.some([mappedFrom, mappedTo] as const)
}

/**
 * Add a mark to all inline content between two positions.
 *
 * @since 0.1.0
 * @category steps
 */
export class AddMarkStep<Sc extends AnySchema = AnySchema> extends Step<Sc> {
  /** Create a mark step. */
  constructor(
    /** The start of the marked range. */
    readonly from: number,
    /** The end of the marked range. */
    readonly to: number,
    /** The mark to add. */
    readonly mark: Mark<Sc>
  ) {
    super()
  }

  apply(doc: Node<Sc>): StepResult<Sc> {
    const $from = doc.resolveUnsafe(this.from)
    return replaceMarked(doc, this.from, this.to, $from.node($from.sharedDepth(this.to)), (node, parent) =>
      !node.isAtom || !parent.type.allowsMarkType(this.mark.type) ? node : node.mark(this.mark.addToSet(node.marks))
    )
  }

  invert(doc: Node<Sc>): Step<Sc> {
    // Restore exactly what was there: remove the mark, and put back any
    // marks it excluded (transform 1.12.3).
    return invertSteps(doc, this.from, this.to, (node, from, to, steps) => {
      const added = this.mark.addToSet(node.marks)
      if (Mark.sameSet(added, node.marks)) return
      pushMarkStep(RemoveMarkStep, from, to, this.mark, steps)
      node.marks.forEach((mark) => {
        if (!mark.isInSet(added)) pushMarkStep(AddMarkStep, from, to, mark, steps)
      })
    })
  }

  map(mapping: Mappable): Option.Option<Step<Sc>> {
    return Option.map(mapMarkRange(mapping, this.from, this.to), ([from, to]) => new AddMarkStep(from, to, this.mark))
  }

  override merge(other: Step<Sc>): Option.Option<Step<Sc>> {
    if (other instanceof AddMarkStep && other.mark.eq(this.mark) && this.from <= other.to && this.to >= other.from) {
      return Option.some(new AddMarkStep(Math.min(this.from, other.from), Math.max(this.to, other.to), this.mark))
    }
    return Option.none()
  }

  toJSON(): StepJSON {
    return { stepType: "addMark", mark: this.mark.toJSON(), from: this.from, to: this.to }
  }

  /** @internal */
  static override fromJSONUnsafe<Sc extends AnySchema>(schema: Sc, json: any): AddMarkStep<Sc> {
    if (!Predicate.isNumber(json.from) || !Predicate.isNumber(json.to)) {
      throw new JSONError({ message: "Invalid input for AddMarkStep.fromJSON" })
    }
    return new AddMarkStep(json.from, json.to, schema.markFromJSONUnsafe(json.mark) as Mark<Sc>)
  }
}

Step.jsonID("addMark", AddMarkStep)

/**
 * Remove a mark from all inline content between two positions.
 *
 * @since 0.1.0
 * @category steps
 */
export class RemoveMarkStep<Sc extends AnySchema = AnySchema> extends Step<Sc> {
  /** Create a mark-removing step. */
  constructor(
    /** The start of the unmarked range. */
    readonly from: number,
    /** The end of the unmarked range. */
    readonly to: number,
    /** The mark to remove. */
    readonly mark: Mark<Sc>
  ) {
    super()
  }

  apply(doc: Node<Sc>): StepResult<Sc> {
    return replaceMarked(doc, this.from, this.to, doc, (node) => node.mark(this.mark.removeFromSet(node.marks)))
  }

  invert(doc: Node<Sc>): Step<Sc> {
    // Only re-add the mark where it was actually present (transform 1.12.3).
    return invertSteps(doc, this.from, this.to, (node, from, to, steps) => {
      if (this.mark.isInSet(node.marks)) pushMarkStep(AddMarkStep, from, to, this.mark, steps)
    })
  }

  map(mapping: Mappable): Option.Option<Step<Sc>> {
    return Option.map(
      mapMarkRange(mapping, this.from, this.to),
      ([from, to]) => new RemoveMarkStep(from, to, this.mark)
    )
  }

  override merge(other: Step<Sc>): Option.Option<Step<Sc>> {
    if (other instanceof RemoveMarkStep && other.mark.eq(this.mark) && this.from <= other.to && this.to >= other.from) {
      return Option.some(new RemoveMarkStep(Math.min(this.from, other.from), Math.max(this.to, other.to), this.mark))
    }
    return Option.none()
  }

  toJSON(): StepJSON {
    return { stepType: "removeMark", mark: this.mark.toJSON(), from: this.from, to: this.to }
  }

  /** @internal */
  static override fromJSONUnsafe<Sc extends AnySchema>(schema: Sc, json: any): RemoveMarkStep<Sc> {
    if (!Predicate.isNumber(json.from) || !Predicate.isNumber(json.to)) {
      throw new JSONError({ message: "Invalid input for RemoveMarkStep.fromJSON" })
    }
    return new RemoveMarkStep(json.from, json.to, schema.markFromJSONUnsafe(json.mark) as Mark<Sc>)
  }
}

Step.jsonID("removeMark", RemoveMarkStep)

/**
 * Add a mark to a specific node.
 *
 * @since 0.1.0
 * @category steps
 */
export class AddNodeMarkStep<Sc extends AnySchema = AnySchema> extends Step<Sc> {
  /** Create a node mark step. */
  constructor(
    /** The position of the target node. */
    readonly pos: number,
    /** The mark to add. */
    readonly mark: Mark<Sc>
  ) {
    super()
  }

  apply(doc: Node<Sc>): StepResult<Sc> {
    const node = doc.nodeAtOrNull(this.pos)
    if (!node) return StepResult.fail("No node at mark step's position")
    const updated = node.type.createUnsafe(node.attrs as any, null, this.mark.addToSet(node.marks))
    return StepResult.fromReplace(
      doc,
      this.pos,
      this.pos + 1,
      new Slice(Fragment.from(updated as Node<Sc>), 0, node.isLeaf ? 0 : 1)
    )
  }

  invert(doc: Node<Sc>): Step<Sc> {
    const node = doc.nodeAtOrNull(this.pos)
    if (node) {
      const newSet = this.mark.addToSet(node.marks)
      if (newSet.length === node.marks.length) {
        for (let i = 0; i < node.marks.length; i++) {
          if (!node.marks[i]!.isInSet(newSet)) return new AddNodeMarkStep(this.pos, node.marks[i]!)
        }
        return new AddNodeMarkStep(this.pos, this.mark)
      }
    }
    return new RemoveNodeMarkStep(this.pos, this.mark)
  }

  map(mapping: Mappable): Option.Option<Step<Sc>> {
    const pos = mapping.mapResult(this.pos, 1)
    return pos.deletedAfter ? Option.none() : Option.some(new AddNodeMarkStep(pos.pos, this.mark))
  }

  toJSON(): StepJSON {
    return { stepType: "addNodeMark", pos: this.pos, mark: this.mark.toJSON() }
  }

  /** @internal */
  static override fromJSONUnsafe<Sc extends AnySchema>(schema: Sc, json: any): AddNodeMarkStep<Sc> {
    if (!Predicate.isNumber(json.pos)) throw new JSONError({ message: "Invalid input for AddNodeMarkStep.fromJSON" })
    return new AddNodeMarkStep(json.pos, schema.markFromJSONUnsafe(json.mark) as Mark<Sc>)
  }
}

Step.jsonID("addNodeMark", AddNodeMarkStep)

/**
 * Remove a mark from a specific node.
 *
 * @since 0.1.0
 * @category steps
 */
export class RemoveNodeMarkStep<Sc extends AnySchema = AnySchema> extends Step<Sc> {
  /** Create a mark-removing step. */
  constructor(
    /** The position of the target node. */
    readonly pos: number,
    /** The mark to remove. */
    readonly mark: Mark<Sc>
  ) {
    super()
  }

  apply(doc: Node<Sc>): StepResult<Sc> {
    const node = doc.nodeAtOrNull(this.pos)
    if (!node) return StepResult.fail("No node at mark step's position")
    const updated = node.type.createUnsafe(node.attrs as any, null, this.mark.removeFromSet(node.marks))
    return StepResult.fromReplace(
      doc,
      this.pos,
      this.pos + 1,
      new Slice(Fragment.from(updated as Node<Sc>), 0, node.isLeaf ? 0 : 1)
    )
  }

  invert(doc: Node<Sc>): Step<Sc> {
    const node = doc.nodeAtOrNull(this.pos)
    if (!node || !this.mark.isInSet(node.marks)) return this
    return new AddNodeMarkStep(this.pos, this.mark)
  }

  map(mapping: Mappable): Option.Option<Step<Sc>> {
    const pos = mapping.mapResult(this.pos, 1)
    return pos.deletedAfter ? Option.none() : Option.some(new RemoveNodeMarkStep(pos.pos, this.mark))
  }

  toJSON(): StepJSON {
    return { stepType: "removeNodeMark", pos: this.pos, mark: this.mark.toJSON() }
  }

  /** @internal */
  static override fromJSONUnsafe<Sc extends AnySchema>(schema: Sc, json: any): RemoveNodeMarkStep<Sc> {
    if (!Predicate.isNumber(json.pos)) {
      throw new JSONError({ message: "Invalid input for RemoveNodeMarkStep.fromJSON" })
    }
    return new RemoveNodeMarkStep(json.pos, schema.markFromJSONUnsafe(json.mark) as Mark<Sc>)
  }
}

Step.jsonID("removeNodeMark", RemoveNodeMarkStep)
