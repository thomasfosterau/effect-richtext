/**
 * A `prosemirror-transform`-compatible facade over
 * `effect-richtext/transform`.
 *
 * `Step` can be subclassed exactly like ProseMirror's: a subclass of
 * the facade `Step` is adapted into a core step (see `toCore`), so
 * custom steps work in core transforms, transactions and the history.
 * `StepMap` and `MapResult` are the core classes, whose API already
 * matches ProseMirror's.
 *
 * Ported API surface from prosemirror-transform (MIT, Marijn Haverbeke and others).
 *
 * @since 0.1.0
 */
import * as Option from "effect/Option"
import type * as M from "../model.ts"
import { isModelError } from "../model.ts"
import * as T from "../transform.ts"
import { type Mappable, MapResult, StepMap } from "../transform.ts"
import {
  adopt,
  BASE,
  callBase,
  CORE,
  guard,
  link,
  registerWrapper,
  TransformError,
  unwrap,
  unwrapArray,
  wrap
} from "./internal/core.ts"
import {
  type Attrs,
  type ContentMatch,
  type Fragment,
  type Mark,
  type MarkType,
  type Node,
  type NodeRange,
  type NodeType,
  type Schema,
  Slice
} from "./model.ts"

export {
  /**
   * @since 0.1.0
   */
  type Mappable,
  /**
   * @since 0.1.0
   */
  MapResult,
  /**
   * @since 0.1.0
   */
  StepMap,
  /**
   * @since 0.1.0
   */
  TransformError
}

const nullable = <A>(o: Option.Option<A>): any => wrap(Option.getOrNull(o))

// -----------------------------------------------------------------------------
// Mapping
// -----------------------------------------------------------------------------

/**
 * A mapping represents a pipeline of zero or more step maps.
 *
 * @since 0.1.0
 * @category models
 */
export class Mapping implements Mappable {
  /** @internal */
  declare readonly [CORE]: T.Mapping

  /** Create a new mapping with the given position maps. */
  constructor(maps?: ReadonlyArray<StepMap>, mirror?: Array<number>, from?: number, to?: number) {
    link(this, new T.Mapping(maps, mirror, from, to))
  }

  /** The step maps in this mapping. */
  get maps(): ReadonlyArray<StepMap> {
    return this[CORE].maps
  }

  /** @internal */
  get mirror(): Array<number> | undefined {
    return this[CORE].mirror
  }

  set mirror(value: Array<number> | undefined) {
    this[CORE].mirror = value
  }

  /** The starting position in the `maps` array, used when `map` or `mapResult` is called. */
  get from(): number {
    return this[CORE].from
  }

  set from(value: number) {
    this[CORE].from = value
  }

  /** The end position in the `maps` array. */
  get to(): number {
    return this[CORE].to
  }

  set to(value: number) {
    this[CORE].to = value
  }

  /** Create a mapping that maps only through a part of this one. */
  slice(from = 0, to: number = this.maps.length): Mapping {
    return wrap(this[CORE].slice(from, to))
  }

  /** Add a step map to the end of this mapping. */
  appendMap(map: StepMap, mirrors?: number): void {
    this[CORE].appendMap(map, mirrors)
  }

  /** Add all the step maps in a given mapping to this one (preserving mirroring information). */
  appendMapping(mapping: Mapping): void {
    this[CORE].appendMapping(mapping[CORE])
  }

  /** Finds the offset of the step map that mirrors the map at the given offset, in this mapping. */
  getMirror(n: number): number | undefined {
    return this[CORE].getMirrorOrUndefined(n)
  }

  /** @internal */
  setMirror(n: number, m: number): void {
    this[CORE].setMirror(n, m)
  }

  /** Append the inverse of the given mapping to this one. */
  appendMappingInverted(mapping: Mapping): void {
    this[CORE].appendMappingInverted(mapping[CORE])
  }

  /** Create an inverted version of this mapping. */
  invert(): Mapping {
    return wrap(this[CORE].invert())
  }

  /** Map a position through this mapping. */
  map(pos: number, assoc = 1): number {
    return this[CORE].map(pos, assoc)
  }

  /** Map a position through this mapping, returning a mapping result. */
  mapResult(pos: number, assoc = 1): MapResult {
    return this[CORE].mapResult(pos, assoc)
  }
}

registerWrapper(T.Mapping, (core) => adopt(Mapping.prototype, core))

// -----------------------------------------------------------------------------
// Steps
// -----------------------------------------------------------------------------

/**
 * The result of applying a step.
 *
 * @since 0.1.0
 * @category models
 */
export class StepResult {
  /** @internal */
  constructor(
    /** The transformed document, if successful. */
    readonly doc: Node | null,
    /** The failure message, if unsuccessful. */
    readonly failed: string | null
  ) {}

  /** Create a successful step result. */
  static ok(doc: Node): StepResult {
    return new StepResult(doc, null)
  }

  /** Create a failed step result. */
  static fail(message: string): StepResult {
    return new StepResult(null, message)
  }

  /** Call `Node.replace` with the given arguments. Create a successful result if it succeeds, and a failed one if it throws a `ReplaceError`. */
  static fromReplace(doc: Node, from: number, to: number, slice: Slice): StepResult {
    return fromCoreResult(T.StepResult.fromReplace(doc[CORE], from, to, slice[CORE]))
  }
}

const fromCoreResult = (result: T.StepResult): StepResult => new StepResult(wrap(result.docOrNull), result.failedOrNull)

const toCoreResult = (result: StepResult): T.StepResult => new T.StepResult(unwrap(result.doc), result.failed)

/**
 * A step object represents an atomic change. Subclass it to define
 * custom steps: subclasses are adapted into core steps automatically.
 *
 * @since 0.1.0
 * @category models
 */
export abstract class Step {
  /** @internal */
  declare readonly [CORE]: T.Step

  constructor() {
    if (!(this instanceof CoreStep)) link(this, new AdaptedStep(this))
  }

  /** Applies this step to the given document, returning a result object. */
  abstract apply(doc: Node): StepResult

  /** Get the step map that represents the changes made by this step. */
  getMap(): StepMap {
    return StepMap.empty
  }

  /** Create an inverted version of this step. */
  abstract invert(doc: Node): Step

  /** Map this step through a mappable thing, returning either a version of that step with its positions adjusted, or `null` if the step was entirely deleted by the mapping. */
  abstract map(mapping: Mappable): Step | null

  /** Try to merge this step with another one, to be applied directly after it. */
  merge(_other: Step): Step | null {
    return null
  }

  /** Create a JSON-serializeable representation of this step. */
  abstract toJSON(): any

  /** Deserialize a step from its JSON representation. */
  static fromJSON(schema: Schema, json: any): Step {
    return wrap(guard(() => T.Step.fromJSONUnsafe(schema[CORE], json)))
  }

  /** To be able to serialize steps to JSON, each step needs a string ID to attach to its JSON representation. */
  static jsonID(id: string, stepClass: { fromJSON(schema: any, json: any): Step }): any {
    try {
      T.Step.jsonID(id, {
        fromJSONUnsafe: (schema, json) => stepClass.fromJSON(wrap(schema), json)[CORE]
      })
    } catch (e) {
      throw new RangeError((e as Error).message)
    }
    ;(stepClass as any).prototype.jsonID = id
    return stepClass
  }
}

/** A core step implemented by a user-defined facade step. @internal */
class AdaptedStep extends T.Step {
  constructor(readonly facade: Step) {
    super()
  }

  apply(doc: M.Node): T.StepResult {
    return toCoreResult(this.facade.apply(wrap(doc)))
  }

  override getMap(): StepMap {
    return this.facade.getMap()
  }

  invert(doc: M.Node): T.Step {
    return this.facade.invert(wrap(doc))[CORE]
  }

  map(mapping: Mappable): Option.Option<T.Step> {
    return Option.fromNullishOr(unwrap(this.facade.map(wrap(mapping))))
  }

  override merge(other: T.Step): Option.Option<T.Step> {
    return Option.fromNullishOr(unwrap(this.facade.merge(wrap(other))))
  }

  toJSON(): T.StepJSON {
    return this.facade.toJSON()
  }
}

/** Base class of the facades for the core's built-in steps. @internal */
abstract class CoreStep extends Step {
  apply(doc: Node): StepResult {
    const core = this[CORE]
    try {
      return fromCoreResult(callBase(core, "apply", [doc[CORE]]))
    } catch (e) {
      if (isModelError(e)) return new StepResult(null, e.message)
      throw e
    }
  }

  override getMap(): StepMap {
    return callBase(this[CORE], "getMap")
  }

  invert(doc: Node): Step {
    return wrap(guard(() => callBase(this[CORE], "invert", [doc[CORE]])))
  }

  map(mapping: Mappable): Step | null {
    return nullable(callBase(this[CORE], "map", [unwrap(mapping)]))
  }

  override merge(other: Step): Step | null {
    return nullable(callBase(this[CORE], "merge", [other[CORE]]))
  }

  toJSON(): any {
    return callBase(this[CORE], "toJSON")
  }
}

const adaptedClasses = new Map<object, any>()

/**
 * The core class used for instances of a subclass of a built-in step
 * facade: a subclass of the core step class whose methods call the
 * facade's overrides, when it has them. @internal
 */
const adaptedStepClass = (CoreClass: any, FacadeClass: any): any => {
  let found = adaptedClasses.get(CoreClass)
  if (!found) {
    const base = FacadeClass.prototype
    found = class extends CoreClass {
      declare facade: Step
      apply(doc: M.Node) {
        return this.facade.apply === base.apply ? super.apply(doc) : toCoreResult(this.facade.apply(wrap(doc)))
      }
      getMap() {
        return this.facade.getMap === base.getMap ? super.getMap() : this.facade.getMap()
      }
      invert(doc: M.Node) {
        return this.facade.invert === base.invert ? super.invert(doc) : this.facade.invert(wrap(doc))[CORE]
      }
      map(mapping: Mappable) {
        return this.facade.map === base.map
          ? super.map(mapping)
          : Option.fromNullishOr(unwrap(this.facade.map(wrap(mapping))))
      }
      merge(other: T.Step) {
        return this.facade.merge === base.merge
          ? super.merge(other)
          : Option.fromNullishOr(unwrap(this.facade.merge(wrap(other))))
      }
      toJSON() {
        return this.facade.toJSON === base.toJSON ? super.toJSON() : this.facade.toJSON()
      }
    }
    found.prototype[BASE] = CoreClass.prototype
    adaptedClasses.set(CoreClass, found)
  }
  return found
}

/** Create the core step for a built-in step facade (or a subclass of one). @internal */
const coreStep = <C extends T.Step>(
  facade: Step,
  target: unknown,
  FacadeClass: abstract new(...args: Array<any>) => Step,
  CoreClass: new(...args: Array<any>) => C,
  args: Array<unknown>
): C => {
  if (target === FacadeClass) return new CoreClass(...args)
  const core = new (adaptedStepClass(CoreClass, FacadeClass))(...args)
  core.facade = facade
  return core
}

/**
 * Replace a part of the document with a slice of new content.
 *
 * @since 0.1.0
 * @category models
 */
export class ReplaceStep extends CoreStep {
  /** @internal */
  declare readonly [CORE]: T.ReplaceStep

  /** The given `slice` should fit the 'gap' between `from` and `to`. */
  constructor(from: number, to: number, slice: Slice, structure = false) {
    super()
    link(this, coreStep(this, new.target, ReplaceStep, T.ReplaceStep, [from, to, slice[CORE], structure]))
  }

  /** The start position of the replaced range. */
  get from(): number {
    return this[CORE].from
  }

  /** The end position of the replaced range. */
  get to(): number {
    return this[CORE].to
  }

  /** The slice to insert. */
  get slice(): Slice {
    return wrap(this[CORE].slice)
  }

  /** @internal */
  get structure(): boolean {
    return this[CORE].structure
  }

  /** @internal */
  static override fromJSON(schema: Schema, json: any): ReplaceStep {
    return wrap(guard(() => T.Step.fromJSONUnsafe(schema[CORE], { ...json, stepType: "replace" })))
  }
}

/**
 * Replace a part of the document with a slice of content, but preserve
 * a range of the replaced content by moving it into the slice.
 *
 * @since 0.1.0
 * @category models
 */
export class ReplaceAroundStep extends CoreStep {
  /** @internal */
  declare readonly [CORE]: T.ReplaceAroundStep

  /** Create a replace-around step with the given range and gap. */
  constructor(
    from: number,
    to: number,
    gapFrom: number,
    gapTo: number,
    slice: Slice,
    insert: number,
    structure = false
  ) {
    super()
    link(
      this,
      coreStep(this, new.target, ReplaceAroundStep, T.ReplaceAroundStep, [
        from,
        to,
        gapFrom,
        gapTo,
        slice[CORE],
        insert,
        structure
      ])
    )
  }

  /** The start position of the replaced range. */
  get from(): number {
    return this[CORE].from
  }

  /** The end position of the replaced range. */
  get to(): number {
    return this[CORE].to
  }

  /** The start of preserved range. */
  get gapFrom(): number {
    return this[CORE].gapFrom
  }

  /** The end of preserved range. */
  get gapTo(): number {
    return this[CORE].gapTo
  }

  /** The slice to insert. */
  get slice(): Slice {
    return wrap(this[CORE].slice)
  }

  /** The position in the slice where the preserved range should be inserted. */
  get insert(): number {
    return this[CORE].insert
  }

  /** @internal */
  get structure(): boolean {
    return this[CORE].structure
  }

  /** @internal */
  static override fromJSON(schema: Schema, json: any): ReplaceAroundStep {
    return wrap(guard(() => T.Step.fromJSONUnsafe(schema[CORE], { ...json, stepType: "replaceAround" })))
  }
}

/**
 * Add a mark to all inline content between two positions.
 *
 * @since 0.1.0
 * @category models
 */
export class AddMarkStep extends CoreStep {
  /** @internal */
  declare readonly [CORE]: T.AddMarkStep

  /** Create a mark step. */
  constructor(from: number, to: number, mark: Mark) {
    super()
    link(this, coreStep(this, new.target, AddMarkStep, T.AddMarkStep, [from, to, mark[CORE]]))
  }

  /** The start of the marked range. */
  get from(): number {
    return this[CORE].from
  }

  /** The end of the marked range. */
  get to(): number {
    return this[CORE].to
  }

  /** The mark to add. */
  get mark(): Mark {
    return wrap(this[CORE].mark)
  }

  /** @internal */
  static override fromJSON(schema: Schema, json: any): AddMarkStep {
    return wrap(guard(() => T.Step.fromJSONUnsafe(schema[CORE], { ...json, stepType: "addMark" })))
  }
}

/**
 * Remove a mark from all inline content between two positions.
 *
 * @since 0.1.0
 * @category models
 */
export class RemoveMarkStep extends CoreStep {
  /** @internal */
  declare readonly [CORE]: T.RemoveMarkStep

  /** Create a mark-removing step. */
  constructor(from: number, to: number, mark: Mark) {
    super()
    link(this, coreStep(this, new.target, RemoveMarkStep, T.RemoveMarkStep, [from, to, mark[CORE]]))
  }

  /** The start of the unmarked range. */
  get from(): number {
    return this[CORE].from
  }

  /** The end of the unmarked range. */
  get to(): number {
    return this[CORE].to
  }

  /** The mark to remove. */
  get mark(): Mark {
    return wrap(this[CORE].mark)
  }

  /** @internal */
  static override fromJSON(schema: Schema, json: any): RemoveMarkStep {
    return wrap(guard(() => T.Step.fromJSONUnsafe(schema[CORE], { ...json, stepType: "removeMark" })))
  }
}

/**
 * Add a mark to a specific node.
 *
 * @since 0.1.0
 * @category models
 */
export class AddNodeMarkStep extends CoreStep {
  /** @internal */
  declare readonly [CORE]: T.AddNodeMarkStep

  /** Create a node mark step. */
  constructor(pos: number, mark: Mark) {
    super()
    link(this, coreStep(this, new.target, AddNodeMarkStep, T.AddNodeMarkStep, [pos, mark[CORE]]))
  }

  /** The position of the target node. */
  get pos(): number {
    return this[CORE].pos
  }

  /** The mark to add. */
  get mark(): Mark {
    return wrap(this[CORE].mark)
  }

  /** @internal */
  static override fromJSON(schema: Schema, json: any): AddNodeMarkStep {
    return wrap(guard(() => T.Step.fromJSONUnsafe(schema[CORE], { ...json, stepType: "addNodeMark" })))
  }
}

/**
 * Remove a mark from a specific node.
 *
 * @since 0.1.0
 * @category models
 */
export class RemoveNodeMarkStep extends CoreStep {
  /** @internal */
  declare readonly [CORE]: T.RemoveNodeMarkStep

  /** Create a mark-removing step. */
  constructor(pos: number, mark: Mark) {
    super()
    link(this, coreStep(this, new.target, RemoveNodeMarkStep, T.RemoveNodeMarkStep, [pos, mark[CORE]]))
  }

  /** The position of the target node. */
  get pos(): number {
    return this[CORE].pos
  }

  /** The mark to remove. */
  get mark(): Mark {
    return wrap(this[CORE].mark)
  }

  /** @internal */
  static override fromJSON(schema: Schema, json: any): RemoveNodeMarkStep {
    return wrap(guard(() => T.Step.fromJSONUnsafe(schema[CORE], { ...json, stepType: "removeNodeMark" })))
  }
}

/**
 * Update an attribute in a specific node.
 *
 * @since 0.1.0
 * @category models
 */
export class AttrStep extends CoreStep {
  /** @internal */
  declare readonly [CORE]: T.AttrStep

  /** Construct an attribute step. */
  constructor(pos: number, attr: string, value: any) {
    super()
    link(this, coreStep(this, new.target, AttrStep, T.AttrStep, [pos, attr, value]))
  }

  /** The position of the target node. */
  get pos(): number {
    return this[CORE].pos
  }

  /** The attribute to set. */
  get attr(): string {
    return this[CORE].attr
  }

  /** The attribute's new value. */
  get value(): any {
    return this[CORE].value
  }

  /** @internal */
  static override fromJSON(schema: Schema, json: any): AttrStep {
    return wrap(guard(() => T.Step.fromJSONUnsafe(schema[CORE], { ...json, stepType: "attr" })))
  }
}

/**
 * Update an attribute in the doc node.
 *
 * @since 0.1.0
 * @category models
 */
export class DocAttrStep extends CoreStep {
  /** @internal */
  declare readonly [CORE]: T.DocAttrStep

  /** Construct an attribute step. */
  constructor(attr: string, value: any) {
    super()
    link(this, coreStep(this, new.target, DocAttrStep, T.DocAttrStep, [attr, value]))
  }

  /** The attribute to set. */
  get attr(): string {
    return this[CORE].attr
  }

  /** The attribute's new value. */
  get value(): any {
    return this[CORE].value
  }

  /** @internal */
  static override fromJSON(schema: Schema, json: any): DocAttrStep {
    return wrap(guard(() => T.Step.fromJSONUnsafe(schema[CORE], { ...json, stepType: "docAttr" })))
  }
}

registerWrapper(T.ReplaceStep, (core) => adopt(ReplaceStep.prototype, core))
registerWrapper(T.ReplaceAroundStep, (core) => adopt(ReplaceAroundStep.prototype, core))
registerWrapper(T.AddMarkStep, (core) => adopt(AddMarkStep.prototype, core))
registerWrapper(T.RemoveMarkStep, (core) => adopt(RemoveMarkStep.prototype, core))
registerWrapper(T.AddNodeMarkStep, (core) => adopt(AddNodeMarkStep.prototype, core))
registerWrapper(T.RemoveNodeMarkStep, (core) => adopt(RemoveNodeMarkStep.prototype, core))
registerWrapper(T.AttrStep, (core) => adopt(AttrStep.prototype, core))
registerWrapper(T.DocAttrStep, (core) => adopt(DocAttrStep.prototype, core))
registerWrapper(T.StepResult, fromCoreResult)

// -----------------------------------------------------------------------------
// Structure helpers
// -----------------------------------------------------------------------------

/**
 * A node type with attributes, as used by `findWrapping` and
 * `Transform.wrap`.
 *
 * @since 0.1.0
 * @category models
 */
export interface NodeTypeWithAttrs {
  type: NodeType
  attrs?: Attrs | null
}

const wrappersToCore = (wrappers: ReadonlyArray<NodeTypeWithAttrs | null | undefined> | undefined): any =>
  wrappers && wrappers.map((w) => w && { type: w.type[CORE], attrs: w.attrs ?? null })

/**
 * Try to find a target depth to which the content in the given range
 * can be lifted.
 *
 * @since 0.1.0
 * @category structure
 */
export const liftTarget = (range: NodeRange): number | null => Option.getOrNull(T.liftTarget(range[CORE]))

/**
 * Try to find a valid way to wrap the content in the given range in a
 * node of the given type.
 *
 * @since 0.1.0
 * @category structure
 */
export const findWrapping = (
  range: NodeRange,
  nodeType: NodeType,
  attrs: Attrs | null = null,
  innerRange: NodeRange = range
): Array<{ type: NodeType; attrs: Attrs | null }> | null => {
  const found = Option.getOrNull(T.findWrapping(range[CORE], nodeType[CORE], attrs, innerRange[CORE]))
  return found && found.map((w) => ({ type: wrap(w.type), attrs: w.attrs ?? null }))
}

/**
 * Check whether splitting at the given position is allowed.
 *
 * @since 0.1.0
 * @category structure
 */
export const canSplit = (
  doc: Node,
  pos: number,
  depth = 1,
  typesAfter?: ReadonlyArray<NodeTypeWithAttrs | null | undefined>
): boolean => guard(() => T.canSplit(doc[CORE], pos, depth, wrappersToCore(typesAfter)))

/**
 * Test whether the blocks before and after a given position can be
 * joined.
 *
 * @since 0.1.0
 * @category structure
 */
export const canJoin = (doc: Node, pos: number): boolean => guard(() => T.canJoin(doc[CORE], pos))

/**
 * Find an ancestor of the given position that can be joined to the
 * block before (or after if `dir` is positive).
 *
 * @since 0.1.0
 * @category structure
 */
export const joinPoint = (doc: Node, pos: number, dir = -1): number | null =>
  guard(() => Option.getOrNull(T.joinPoint(doc[CORE], pos, dir)))

/**
 * Try to find a point where a node of the given type can be inserted
 * near `pos`, by searching up the node hierarchy when `pos` itself
 * isn't a valid place but is at the start or end of a node.
 *
 * @since 0.1.0
 * @category structure
 */
export const insertPoint = (doc: Node, pos: number, nodeType: NodeType): number | null =>
  guard(() => Option.getOrNull(T.insertPoint(doc[CORE], pos, nodeType[CORE])))

/**
 * Finds a position at or around the given position where the given
 * slice can be inserted.
 *
 * @since 0.1.0
 * @category structure
 */
export const dropPoint = (doc: Node, pos: number, slice: Slice): number | null =>
  guard(() => Option.getOrNull(T.dropPoint(doc[CORE], pos, slice[CORE])))

/**
 * 'Fit' a slice into a given position in the document, producing a
 * step that inserts it. Will return null if there's no meaningful way
 * to insert the slice here, or inserting it would be a no-op.
 *
 * @since 0.1.0
 * @category structure
 */
export const replaceStep = (doc: Node, from: number, to = from, slice: Slice = Slice.empty): Step | null =>
  guard(() => nullable(T.replaceStep(doc[CORE], from, to, slice[CORE])))

// -----------------------------------------------------------------------------
// Transform
// -----------------------------------------------------------------------------

const contentInput = (content: Fragment | Node | ReadonlyArray<Node>): any =>
  Array.isArray(content) ? content.map(unwrap) : unwrap(content)

/**
 * Abstraction to build up and track an array of steps representing a
 * document transformation.
 *
 * @since 0.1.0
 * @category models
 */
export class Transform {
  /** @internal */
  declare readonly [CORE]: T.Transform

  /** Create a transform that starts with the given document. */
  constructor(doc: Node) {
    link(this, new T.Transform(doc[CORE]))
  }

  /** The steps in this transform. */
  get steps(): Array<Step> {
    return this[CORE].steps.map(wrap)
  }

  /** The documents before each of the steps. */
  get docs(): Array<Node> {
    return this[CORE].docs.map(wrap)
  }

  /** A mapping with the maps for each of the steps in this transform. */
  get mapping(): Mapping {
    return wrap(this[CORE].mapping)
  }

  /** The current document (the result of applying the steps in the transform). */
  get doc(): Node {
    return wrap(this[CORE].doc)
  }

  /** The starting document. */
  get before(): Node {
    return wrap(this[CORE].before)
  }

  /** Apply a new step in this transform, saving the result. Throws an error when the step fails. */
  step(step: Step): this {
    guard(() => this[CORE].stepUnsafe(step[CORE]))
    return this
  }

  /** Try to apply a step in this transformation, ignoring it if it fails. Returns the step result. */
  maybeStep(step: Step): StepResult {
    return fromCoreResult(guard(() => this[CORE].maybeStep(step[CORE])))
  }

  /** True when the document has been changed (when there are any steps). */
  get docChanged(): boolean {
    return this[CORE].docChanged
  }

  /** Return a single range, in post-transform document positions, that covers all content changed by this transform. */
  changedRange(): { from: number; to: number } | null {
    return Option.getOrNull(this[CORE].changedRange()) as { from: number; to: number } | null
  }

  /** @internal */
  addStep(step: Step, doc: Node): void {
    this[CORE].addStep(step[CORE], doc[CORE])
  }

  /** Replace the part of the document between `from` and `to` with the given `slice`. */
  replace(from: number, to = from, slice: Slice = Slice.empty): this {
    guard(() => this[CORE].replaceUnsafe(from, to, slice[CORE]))
    return this
  }

  /** Replace the given range with the given content, which may be a fragment, node, or array of nodes. */
  replaceWith(from: number, to: number, content: Fragment | Node | ReadonlyArray<Node>): this {
    guard(() => this[CORE].replaceWithUnsafe(from, to, contentInput(content)))
    return this
  }

  /** Delete the content between the given positions. */
  delete(from: number, to: number): this {
    guard(() => this[CORE].deleteUnsafe(from, to))
    return this
  }

  /** Insert the given content at the given position. */
  insert(pos: number, content: Fragment | Node | ReadonlyArray<Node>): this {
    guard(() => this[CORE].insertUnsafe(pos, contentInput(content)))
    return this
  }

  /** Replace a range of the document with a given slice, using `from`, `to`, and the slice's `openStart` property as hints, rather than fixed start and end points. */
  replaceRange(from: number, to: number, slice: Slice): this {
    guard(() => this[CORE].replaceRangeUnsafe(from, to, slice[CORE]))
    return this
  }

  /** Replace the given range with a node, but use `from` and `to` as hints, rather than precise positions. */
  replaceRangeWith(from: number, to: number, node: Node): this {
    guard(() => this[CORE].replaceRangeWithUnsafe(from, to, node[CORE]))
    return this
  }

  /** Delete the given range, expanding it to cover fully covered parent nodes until a valid replace is found. */
  deleteRange(from: number, to: number): this {
    guard(() => this[CORE].deleteRangeUnsafe(from, to))
    return this
  }

  /** Split the content in the given range off from its parent, if there is sibling content before or after it, and move it up the tree to the depth specified by `target`. */
  lift(range: NodeRange, target: number): this {
    guard(() => this[CORE].liftUnsafe(range[CORE], target))
    return this
  }

  /** Join the blocks around the given position. */
  join(pos: number, depth = 1): this {
    guard(() => this[CORE].joinUnsafe(pos, depth))
    return this
  }

  /** Wrap the given range in the given set of wrappers. */
  wrap(range: NodeRange, wrappers: ReadonlyArray<NodeTypeWithAttrs>): this {
    guard(() => this[CORE].wrapUnsafe(range[CORE], wrappersToCore(wrappers)))
    return this
  }

  /** Set the type of all textblocks (partly) between `from` and `to` to the given node type with the given attributes. */
  setBlockType(
    from: number,
    to: number = from,
    type: NodeType,
    attrs: Attrs | null | ((oldNode: Node) => Attrs) = null
  ): this {
    const coreAttrs = typeof attrs === "function" ? (node: M.Node) => attrs(wrap(node)) : attrs
    guard(() => this[CORE].setBlockTypeUnsafe(from, to, type[CORE], coreAttrs as any))
    return this
  }

  /** Change the type, attributes, and/or marks of the node at `pos`. */
  setNodeMarkup(pos: number, type?: NodeType | null, attrs: Attrs | null = null, marks?: ReadonlyArray<Mark>): this {
    guard(() => this[CORE].setNodeMarkupUnsafe(pos, type && type[CORE], attrs, marks && unwrapArray(marks)))
    return this
  }

  /** Set a single attribute on a given node to a new value. */
  setNodeAttribute(pos: number, attr: string, value: any): this {
    guard(() => this[CORE].setNodeAttributeUnsafe(pos, attr, value))
    return this
  }

  /** Set a single attribute on the document to a new value. */
  setDocAttribute(attr: string, value: any): this {
    guard(() => this[CORE].setDocAttributeUnsafe(attr, value))
    return this
  }

  /** Add a mark to the node at position `pos`. */
  addNodeMark(pos: number, mark: Mark): this {
    guard(() => this[CORE].addNodeMarkUnsafe(pos, mark[CORE]))
    return this
  }

  /** Remove a mark (or all marks of the given type) from the node at position `pos`. */
  removeNodeMark(pos: number, mark: Mark | MarkType): this {
    guard(() => this[CORE].removeNodeMarkUnsafe(pos, mark[CORE]))
    return this
  }

  /** Split the node at the given position, and optionally, if `depth` is greater than one, any number of nodes above that. */
  split(pos: number, depth = 1, typesAfter?: ReadonlyArray<NodeTypeWithAttrs | null | undefined>): this {
    guard(() => this[CORE].splitUnsafe(pos, depth, wrappersToCore(typesAfter)))
    return this
  }

  /** Add the given mark to the inline content between `from` and `to`. */
  addMark(from: number, to: number, mark: Mark): this {
    guard(() => this[CORE].addMark(from, to, mark[CORE]))
    return this
  }

  /** Remove marks from inline nodes between `from` and `to`. */
  removeMark(from: number, to: number, mark?: Mark | MarkType | null): this {
    guard(() => this[CORE].removeMark(from, to, mark && mark[CORE]))
    return this
  }

  /** Removes all marks and nodes from the content of the node at `pos` that don't match the given new parent node type. */
  clearIncompatible(pos: number, parentType: NodeType, match?: ContentMatch): this {
    guard(() => this[CORE].clearIncompatibleUnsafe(pos, parentType[CORE], match && match[CORE]))
    return this
  }
}

registerWrapper(T.Transform, (core) => adopt(Transform.prototype, core))

// -----------------------------------------------------------------------------
// toCore / fromCore
// -----------------------------------------------------------------------------

/**
 * Get the core (Effect API) object behind a facade. For a user-defined
 * `Step` subclass, this is a core step that delegates to it.
 *
 * @since 0.1.0
 * @category conversions
 */
export function toCore(step: ReplaceStep): T.ReplaceStep
export function toCore(step: ReplaceAroundStep): T.ReplaceAroundStep
export function toCore(step: Step): T.Step
export function toCore(mapping: Mapping): T.Mapping
export function toCore(tr: Transform): T.Transform
export function toCore(value: unknown): unknown {
  return unwrap(value)
}

/**
 * Get the facade for a core (Effect API) object.
 *
 * @since 0.1.0
 * @category conversions
 */
export function fromCore(step: T.ReplaceStep<any>): ReplaceStep
export function fromCore(step: T.ReplaceAroundStep<any>): ReplaceAroundStep
export function fromCore(step: T.Step<any>): Step
export function fromCore(mapping: T.Mapping): Mapping
export function fromCore(result: T.StepResult<any>): StepResult
export function fromCore(tr: T.Transform<any>): Transform
export function fromCore(value: unknown): unknown {
  return wrap(value)
}
