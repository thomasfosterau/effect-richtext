/**
 * The `Transform` class: a mutable, chainable builder of document
 * changes.
 *
 * @since 0.1.0
 */
import type * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { attempt } from "../internal/attempt.ts"
import {
  type AnySchema,
  type AttributeError,
  type Attrs,
  type ContentMatch,
  Fragment,
  Mark,
  type MarkType,
  type Node,
  type NodeAttrsInput,
  type NodeNames,
  type NodeRange,
  type NodeType,
  type PositionError,
  Slice
} from "../model.ts"
import { AttrStep, DocAttrStep } from "./attr_step.ts"
import { isTransformOrModelError, type StepError, TransformError } from "./errors.ts"
import { Mapping } from "./map.ts"
import { addMark, clearIncompatible, removeMark } from "./mark.ts"
import { AddNodeMarkStep, RemoveNodeMarkStep } from "./mark_step.ts"
import { deleteRange, replaceRange, replaceRangeWith, replaceStepOrNull } from "./replace.ts"
import { applyStep, type Step, type StepResult } from "./step.ts"
import { join, lift, type NodeTypeWithAttrs, setBlockType, setNodeMarkup, split, wrap } from "./structure.ts"

/**
 * Content accepted by `replaceWith` and `insert`.
 *
 * @since 0.1.0
 * @category models
 */
export type ContentInput<Sc extends AnySchema = AnySchema> = Fragment<Sc> | Node<Sc> | ReadonlyArray<Node<Sc>>

/**
 * Errors that can occur when replacing content: invalid positions or a
 * step that can't be applied.
 *
 * @since 0.1.0
 * @category errors
 */
export type ReplaceFailure = StepError | PositionError

/**
 * Errors that can occur in structural transforms (`lift`, `wrap`,
 * `split`, `setBlockType`, …).
 *
 * @since 0.1.0
 * @category errors
 */
export type StructureFailure = TransformError | StepError | PositionError | AttributeError

/**
 * Abstraction to build up and track an array of steps representing a
 * document transformation.
 *
 * Transforms are mutable builders: most transforming methods apply a
 * change immediately and return the transform itself, so that they can
 * be chained. Every method that can fail comes in two flavours:
 *
 * - `x(...)` returns an `Effect` that performs the change when run and
 *   succeeds with the transform (or fails with a tagged error, leaving
 *   any steps added before the failure in place).
 * - `xUnsafe(...)` performs the change immediately, returning the
 *   transform, and throws the tagged error on failure.
 *
 * Methods that cannot fail for valid positions (`addMark`,
 * `removeMark`) are plain chainable methods.
 *
 * @since 0.1.0
 * @category models
 */
export class Transform<Sc extends AnySchema = AnySchema> {
  /** The steps in this transform. */
  readonly steps: Array<Step<Sc>> = []
  /** The documents before each of the steps. */
  readonly docs: Array<Node<Sc>> = []
  /** A mapping with the maps for each of the steps in this transform. */
  readonly mapping: Mapping = new Mapping()

  /** @internal */
  protected currentDoc: Node<Sc>

  /** Create a transform that starts with the given document. */
  constructor(doc: Node<Sc>) {
    this.currentDoc = doc
  }

  /** The current document (the result of applying the steps in the transform). */
  get doc(): Node<Sc> {
    return this.currentDoc
  }

  /** The starting document. */
  get before(): Node<Sc> {
    return this.docs.length ? this.docs[0]! : this.currentDoc
  }

  /**
   * Apply a new step in this transform, saving the result. Fails with
   * a `StepError` when the step can't be applied.
   */
  step(step: Step<Sc>): Effect.Effect<this, StepError> {
    return attempt(() => this.stepUnsafe(step), isTransformOrModelError as (u: unknown) => u is StepError)
  }

  /** Like `step`, but throws a `StepError` when the step fails. */
  stepUnsafe(step: Step<Sc>): this {
    const result = this.maybeStep(step)
    if (result.failedOrNull !== null) result.getUnsafe()
    return this
  }

  /**
   * Try to apply a step in this transformation, ignoring it if it
   * fails. Returns the step result.
   */
  maybeStep(step: Step<Sc>): StepResult<Sc> {
    const result = applyStep(step, this.currentDoc)
    if (result.failedOrNull === null) this.addStep(step, result.docOrNull!)
    return result
  }

  /** True when the document has been changed (when there are any steps). */
  get docChanged(): boolean {
    return this.steps.length > 0
  }

  /**
   * Return a single range, in post-transform document positions, that
   * covers all content changed by this transform. Returns `None` if no
   * replacements are made. Note that this will ignore changes that
   * add/remove marks without replacing the underlying content.
   */
  changedRange(): Option.Option<{ readonly from: number; readonly to: number }> {
    let from = 1e9, to = -1e9
    for (let i = 0; i < this.mapping.maps.length; i++) {
      const map = this.mapping.maps[i]!
      if (i) {
        from = map.map(from, 1)
        to = map.map(to, -1)
      }
      map.forEach((_f, _t, fromB, toB) => {
        from = Math.min(from, fromB)
        to = Math.max(to, toB)
      })
    }
    return from === 1e9 ? Option.none() : Option.some({ from, to })
  }

  /** @internal */
  addStep(step: Step<Sc>, doc: Node<Sc>): void {
    this.docs.push(this.currentDoc)
    this.steps.push(step)
    this.mapping.appendMap(step.getMap())
    this.currentDoc = doc
  }

  /** @internal */
  protected effect<E>(f: () => unknown): Effect.Effect<this, E> {
    return attempt(() => {
      f()
      return this
    }, isTransformOrModelError as (u: unknown) => u is E)
  }

  // ---------------------------------------------------------------------------
  // Replacing
  // ---------------------------------------------------------------------------

  /** Replace the part of the document between `from` and `to` with the given `slice`. */
  replace(from: number, to = from, slice: Slice<Sc> = Slice.empty): Effect.Effect<this, ReplaceFailure> {
    return this.effect(() => this.replaceUnsafe(from, to, slice))
  }

  /** Like `replace`, but throws on failure. */
  replaceUnsafe(from: number, to = from, slice: Slice<Sc> = Slice.empty): this {
    const step = replaceStepOrNull(this.currentDoc, from, to, slice)
    if (step) this.stepUnsafe(step)
    return this
  }

  /**
   * Replace the given range with the given content, which may be a
   * fragment, node, or array of nodes.
   */
  replaceWith(from: number, to: number, content: ContentInput<Sc>): Effect.Effect<this, ReplaceFailure> {
    return this.effect(() => this.replaceWithUnsafe(from, to, content))
  }

  /** Like `replaceWith`, but throws on failure. */
  replaceWithUnsafe(from: number, to: number, content: ContentInput<Sc>): this {
    return this.replaceUnsafe(from, to, new Slice(Fragment.from(content as Fragment<Sc>), 0, 0))
  }

  /** Delete the content between the given positions. */
  delete(from: number, to: number): Effect.Effect<this, ReplaceFailure> {
    return this.effect(() => this.deleteUnsafe(from, to))
  }

  /** Like `delete`, but throws on failure. */
  deleteUnsafe(from: number, to: number): this {
    return this.replaceUnsafe(from, to, Slice.empty)
  }

  /** Insert the given content at the given position. */
  insert(pos: number, content: ContentInput<Sc>): Effect.Effect<this, ReplaceFailure> {
    return this.effect(() => this.insertUnsafe(pos, content))
  }

  /** Like `insert`, but throws on failure. */
  insertUnsafe(pos: number, content: ContentInput<Sc>): this {
    return this.replaceWithUnsafe(pos, pos, content)
  }

  /**
   * Replace a range of the document with a given slice, using `from`,
   * `to`, and the slice's `openStart` property as hints, rather than
   * fixed start and end points. This method may grow the replaced area
   * or close open nodes in the slice in order to get a fit that is
   * more in line with WYSIWYG expectations, by dropping fully covered
   * parent nodes of the replaced region when they are marked
   * non-defining as context, or including an open parent node from the
   * slice that _is_ marked as defining its content.
   *
   * This is the method, for example, to handle paste. The similar
   * `replace` method is a more primitive tool which will _not_ move the
   * start and end of its given range, and is useful in situations where
   * you need more precise control over what happens.
   */
  replaceRange(from: number, to: number, slice: Slice<Sc>): Effect.Effect<this, ReplaceFailure> {
    return this.effect(() => this.replaceRangeUnsafe(from, to, slice))
  }

  /** Like `replaceRange`, but throws on failure. */
  replaceRangeUnsafe(from: number, to: number, slice: Slice<Sc>): this {
    replaceRange(this, from, to, slice)
    return this
  }

  /**
   * Replace the given range with a node, but use `from` and `to` as
   * hints, rather than precise positions. When from and to are the same
   * and are at the start or end of a parent node in which the given
   * node doesn't fit, this method may _move_ them out towards a parent
   * that does allow the given node to be placed. When the given range
   * completely covers a parent node, this method may completely replace
   * that parent node.
   */
  replaceRangeWith(from: number, to: number, node: Node<Sc>): Effect.Effect<this, ReplaceFailure> {
    return this.effect(() => this.replaceRangeWithUnsafe(from, to, node))
  }

  /** Like `replaceRangeWith`, but throws on failure. */
  replaceRangeWithUnsafe(from: number, to: number, node: Node<Sc>): this {
    replaceRangeWith(this, from, to, node)
    return this
  }

  /**
   * Delete the given range, expanding it to cover fully covered parent
   * nodes until a valid replace is found.
   */
  deleteRange(from: number, to: number): Effect.Effect<this, ReplaceFailure> {
    return this.effect(() => this.deleteRangeUnsafe(from, to))
  }

  /** Like `deleteRange`, but throws on failure. */
  deleteRangeUnsafe(from: number, to: number): this {
    deleteRange(this, from, to)
    return this
  }

  // ---------------------------------------------------------------------------
  // Structure
  // ---------------------------------------------------------------------------

  /**
   * Split the content in the given range off from its parent, if there
   * is sibling content before or after it, and move it up the tree to
   * the depth specified by `target`. You'll probably want to use
   * `liftTarget` to compute `target`, to make sure the lift is valid.
   */
  lift(range: NodeRange<Sc>, target: number): Effect.Effect<this, StructureFailure> {
    return this.effect(() => this.liftUnsafe(range, target))
  }

  /** Like `lift`, but throws on failure. */
  liftUnsafe(range: NodeRange<Sc>, target: number): this {
    lift(this, range, target)
    return this
  }

  /**
   * Join the blocks around the given position. If depth is 2, their
   * last and first siblings are also joined, and so on.
   */
  join(pos: number, depth = 1): Effect.Effect<this, StructureFailure> {
    return this.effect(() => this.joinUnsafe(pos, depth))
  }

  /** Like `join`, but throws on failure. */
  joinUnsafe(pos: number, depth = 1): this {
    join(this, pos, depth)
    return this
  }

  /**
   * Wrap the given range in the given set of wrappers. The wrappers are
   * assumed to be valid in this position, and should probably be
   * computed with `findWrapping`.
   */
  wrap(range: NodeRange<Sc>, wrappers: ReadonlyArray<NodeTypeWithAttrs<Sc>>): Effect.Effect<this, StructureFailure> {
    return this.effect(() => this.wrapUnsafe(range, wrappers))
  }

  /** Like `wrap`, but throws on failure. */
  wrapUnsafe(range: NodeRange<Sc>, wrappers: ReadonlyArray<NodeTypeWithAttrs<Sc>>): this {
    wrap(this, range, wrappers as ReadonlyArray<any>)
    return this
  }

  /**
   * Set the type of all textblocks (partly) between `from` and `to` to
   * the given node type with the given attributes. `to` defaults to
   * `from`.
   */
  setBlockType<N extends NodeNames<Sc>>(
    from: number,
    to: number | undefined,
    type: NodeType<Sc, N>,
    attrs?: NodeAttrsInput<Sc, N> | null | ((oldNode: Node<Sc>) => NodeAttrsInput<Sc, N>)
  ): Effect.Effect<this, StructureFailure> {
    return this.effect(() => this.setBlockTypeUnsafe(from, to, type, attrs))
  }

  /** Like `setBlockType`, but throws on failure. */
  setBlockTypeUnsafe<N extends NodeNames<Sc>>(
    from: number,
    to: number | undefined,
    type: NodeType<Sc, N>,
    attrs?: NodeAttrsInput<Sc, N> | null | ((oldNode: Node<Sc>) => NodeAttrsInput<Sc, N>)
  ): this {
    setBlockType(this, from, to ?? from, type, attrs as Attrs | null | undefined | ((n: Node<any>) => Attrs))
    return this
  }

  /**
   * Change the type, attributes, and/or marks of the node at `pos`.
   * When `type` isn't given, the existing node type is preserved.
   */
  setNodeMarkup<N extends NodeNames<Sc>>(
    pos: number,
    type?: NodeType<Sc, N> | null,
    attrs?: NodeAttrsInput<Sc, N> | null,
    marks?: ReadonlyArray<Mark<Sc>>
  ): Effect.Effect<this, StructureFailure> {
    return this.effect(() => this.setNodeMarkupUnsafe(pos, type, attrs, marks))
  }

  /** Like `setNodeMarkup`, but throws on failure. */
  setNodeMarkupUnsafe<N extends NodeNames<Sc>>(
    pos: number,
    type?: NodeType<Sc, N> | null,
    attrs?: NodeAttrsInput<Sc, N> | null,
    marks?: ReadonlyArray<Mark<Sc>>
  ): this {
    setNodeMarkup(this, pos, type, attrs as Attrs | null | undefined, marks)
    return this
  }

  /**
   * Set a single attribute on a given node to a new value. The `pos`
   * addresses the document content. Use `setDocAttribute` to set
   * attributes on the document itself.
   */
  setNodeAttribute(pos: number, attr: string, value: unknown): Effect.Effect<this, StepError> {
    return this.effect(() => this.setNodeAttributeUnsafe(pos, attr, value))
  }

  /** Like `setNodeAttribute`, but throws on failure. */
  setNodeAttributeUnsafe(pos: number, attr: string, value: unknown): this {
    return this.stepUnsafe(new AttrStep(pos, attr, value))
  }

  /** Set a single attribute on the document to a new value. */
  setDocAttribute(attr: string, value: unknown): Effect.Effect<this, StepError> {
    return this.effect(() => this.setDocAttributeUnsafe(attr, value))
  }

  /** Like `setDocAttribute`, but throws on failure. */
  setDocAttributeUnsafe(attr: string, value: unknown): this {
    return this.stepUnsafe(new DocAttrStep(attr, value))
  }

  /** Add a mark to the node at position `pos`. */
  addNodeMark(pos: number, mark: Mark<Sc>): Effect.Effect<this, StepError> {
    return this.effect(() => this.addNodeMarkUnsafe(pos, mark))
  }

  /** Like `addNodeMark`, but throws on failure. */
  addNodeMarkUnsafe(pos: number, mark: Mark<Sc>): this {
    return this.stepUnsafe(new AddNodeMarkStep(pos, mark))
  }

  /**
   * Remove a mark (or all marks of the given type) from the node at
   * position `pos`. Fails with a `TransformError` when there is no node
   * at that position.
   */
  removeNodeMark(pos: number, mark: Mark<Sc> | MarkType<Sc>): Effect.Effect<this, TransformError | StepError> {
    return this.effect(() => this.removeNodeMarkUnsafe(pos, mark))
  }

  /** Like `removeNodeMark`, but throws on failure. */
  removeNodeMarkUnsafe(pos: number, mark: Mark<Sc> | MarkType<Sc>): this {
    const node = this.currentDoc.nodeAtOrNull(pos)
    if (!node) throw new TransformError({ message: "No node at position " + pos })
    if (mark instanceof Mark) {
      if (mark.isInSet(node.marks)) this.stepUnsafe(new RemoveNodeMarkStep(pos, mark))
    } else {
      let set = node.marks, found: Mark<Sc> | undefined
      const steps: Array<Step<Sc>> = []
      while ((found = mark.findInSet(set))) {
        steps.push(new RemoveNodeMarkStep(pos, found))
        set = found.removeFromSet(set)
      }
      for (let i = steps.length - 1; i >= 0; i--) this.stepUnsafe(steps[i]!)
    }
    return this
  }

  /**
   * Split the node at the given position, and optionally, if `depth` is
   * greater than one, any number of nodes above that. By default, the
   * parts split off will inherit the node type of the original node.
   * This can be changed by passing an array of types and attributes to
   * use after the split (with the outermost nodes coming first).
   */
  split(
    pos: number,
    depth = 1,
    typesAfter?: ReadonlyArray<NodeTypeWithAttrs<Sc> | null | undefined>
  ): Effect.Effect<this, StructureFailure> {
    return this.effect(() => this.splitUnsafe(pos, depth, typesAfter))
  }

  /** Like `split`, but throws on failure. */
  splitUnsafe(pos: number, depth = 1, typesAfter?: ReadonlyArray<NodeTypeWithAttrs<Sc> | null | undefined>): this {
    split(this, pos, depth, typesAfter as ReadonlyArray<any> | undefined)
    return this
  }

  // ---------------------------------------------------------------------------
  // Marks
  // ---------------------------------------------------------------------------

  /** Add the given mark to the inline content between `from` and `to`. */
  addMark(from: number, to: number, mark: Mark<Sc>): this {
    addMark(this, from, to, mark)
    return this
  }

  /**
   * Remove marks from inline nodes between `from` and `to`. When `mark`
   * is a single mark, remove precisely that mark. When it is a mark
   * type, remove all marks of that type. When it is null, remove all
   * marks of any type.
   */
  removeMark(from: number, to: number, mark?: Mark<Sc> | MarkType<Sc> | null): this {
    removeMark(this, from, to, mark)
    return this
  }

  /**
   * Removes all marks and nodes from the content of the node at `pos`
   * that don't match the given new parent node type. Accepts an
   * optional starting content match as third argument.
   */
  clearIncompatible(
    pos: number,
    parentType: NodeType<Sc, any>,
    match?: ContentMatch
  ): Effect.Effect<this, TransformError | StepError | PositionError> {
    return this.effect(() => this.clearIncompatibleUnsafe(pos, parentType, match))
  }

  /** Like `clearIncompatible`, but throws on failure. */
  clearIncompatibleUnsafe(pos: number, parentType: NodeType<Sc, any>, match?: ContentMatch): this {
    if (!this.currentDoc.nodeAtOrNull(pos)) throw new TransformError({ message: "No node at position " + pos })
    clearIncompatible(this, pos, parentType, match)
    return this
  }
}
