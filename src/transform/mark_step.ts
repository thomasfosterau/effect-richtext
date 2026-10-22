/**
 * Mark steps.
 *
 * @since 0.1.0
 */
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import { type AnySchema, Fragment, JSONError, type Mark, type Node, Slice } from "../model.ts"
import type { Mappable } from "./map.ts"
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
    const oldSlice = doc.sliceUnsafe(this.from, this.to),
      $from = doc.resolveUnsafe(this.from)
    const parent = $from.node($from.sharedDepth(this.to))
    const slice = new Slice(
      mapFragment(
        oldSlice.content,
        (node, parent) => {
          if (!node.isAtom || !parent.type.allowsMarkType(this.mark.type)) return node
          return node.mark(this.mark.addToSet(node.marks))
        },
        parent
      ),
      oldSlice.openStart,
      oldSlice.openEnd
    )
    return StepResult.fromReplace(doc, this.from, this.to, slice)
  }

  invert(): Step<Sc> {
    return new RemoveMarkStep(this.from, this.to, this.mark)
  }

  map(mapping: Mappable): Option.Option<Step<Sc>> {
    const from = mapping.mapResult(this.from, 1),
      to = mapping.mapResult(this.to, -1)
    if ((from.deleted && to.deleted) || from.pos >= to.pos) return Option.none()
    return Option.some(new AddMarkStep(from.pos, to.pos, this.mark))
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
    const oldSlice = doc.sliceUnsafe(this.from, this.to)
    const slice = new Slice(
      mapFragment(oldSlice.content, (node) => node.mark(this.mark.removeFromSet(node.marks)), doc),
      oldSlice.openStart,
      oldSlice.openEnd
    )
    return StepResult.fromReplace(doc, this.from, this.to, slice)
  }

  invert(): Step<Sc> {
    return new AddMarkStep(this.from, this.to, this.mark)
  }

  map(mapping: Mappable): Option.Option<Step<Sc>> {
    const from = mapping.mapResult(this.from, 1),
      to = mapping.mapResult(this.to, -1)
    if ((from.deleted && to.deleted) || from.pos >= to.pos) return Option.none()
    return Option.some(new RemoveMarkStep(from.pos, to.pos, this.mark))
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
