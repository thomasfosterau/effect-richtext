/**
 * A `prosemirror-model`-compatible facade over `effect-richtext/model`.
 *
 * The classes exported here have the API of their ProseMirror
 * counterparts (nullable results instead of `Option`, exceptions
 * instead of `Effect` failures, string content expressions,
 * `OrderedMap` specs, `new Schema(spec)`), and delegate all work to
 * the core objects they wrap. Wrapping is identity-preserving: the same
 * core object always yields the same facade. Use `toCore` / `fromCore`
 * to move between this API and the Effect API.
 *
 * Ported API surface from prosemirror-model (MIT, Marijn Haverbeke and others).
 *
 * @since 0.1.0
 */
import * as Option from "effect/Option"
import * as M from "../model.ts"
import {
  adopt,
  CORE,
  guard,
  link,
  registerWrapper,
  ReplaceError,
  setEmptyCoreArray,
  unwrap,
  unwrapArray,
  wrap,
  wrapArray
} from "./internal/core.ts"
import { OrderedMap } from "./orderedmap.ts"

export {
  /**
   * @since 0.1.0
   */
  OrderedMap,
  /**
   * @since 0.1.0
   */
  ReplaceError
}

/**
 * An object holding the attributes of a node or mark.
 *
 * @since 0.1.0
 * @category models
 */
export type Attrs = { readonly [attr: string]: any }

/**
 * A DOM output spec (see `prosemirror-model`).
 *
 * @since 0.1.0
 * @category models
 */
export type DOMOutputSpec = M.DOMOutputSpec

const ORIGINAL: unique symbol = Symbol.for("effect-richtext/compat/original") as never

// -----------------------------------------------------------------------------
// Conversions
// -----------------------------------------------------------------------------

/** @internal */
export const fragmentInput = (content: unknown): any => {
  if (content == null) return content
  if (Array.isArray(content)) return unwrapArray(content)
  return unwrap(content)
}

const marksInput = (marks: ReadonlyArray<Mark> | null | undefined): any => marks == null ? marks : unwrapArray(marks)

const nullable = <A>(o: Option.Option<A>): any => wrap(Option.getOrNull(o))

// -----------------------------------------------------------------------------
// Node
// -----------------------------------------------------------------------------

/**
 * This class represents a node in the tree that makes up a ProseMirror
 * document.
 *
 * @since 0.1.0
 * @category models
 */
export class Node {
  /** @internal */
  declare readonly [CORE]: M.Node

  /** @internal */
  constructor(type: NodeType, attrs: Attrs, content?: Fragment | null, marks: ReadonlyArray<Mark> = Mark.none) {
    link(this, new M.Node(type[CORE], attrs, content ? content[CORE] : null, unwrapArray(marks)))
  }

  /** The type of node that this is. */
  get type(): NodeType {
    return wrap(this[CORE].type)
  }

  /** An object mapping attribute names to values. */
  get attrs(): Attrs {
    return this[CORE].attrs
  }

  /** A container holding the node's children. */
  get content(): Fragment {
    return wrap(this[CORE].content)
  }

  /** The marks (things like whether it is emphasized or part of a link) applied to this node. */
  get marks(): ReadonlyArray<Mark> {
    return wrapArray(this[CORE].marks)
  }

  /** For text nodes, this contains the node's text content. */
  get text(): string | undefined {
    return undefined
  }

  /** The array of this node's child nodes. */
  get children(): ReadonlyArray<Node> {
    return wrapArray(this[CORE].content.content)
  }

  /** The size of this node, as defined by the integer-based indexing scheme. */
  get nodeSize(): number {
    return this[CORE].nodeSize
  }

  /** The number of children that the node has. */
  get childCount(): number {
    return this[CORE].childCount
  }

  /** Get the child node at the given index. Raises an error when the index is out of range. */
  child(index: number): Node {
    return wrap(guard(() => this[CORE].childUnsafe(index)))
  }

  /** Get the child node at the given index, if it exists. */
  maybeChild(index: number): Node | null {
    return wrap(this[CORE].content.content[index] ?? null)
  }

  /** Call `f` for every child node. */
  forEach(f: (node: Node, offset: number, index: number) => void): void {
    this[CORE].forEach((node, offset, index) => f(wrap(node), offset, index))
  }

  /** Invoke a callback for all descendant nodes recursively overlapping the given two positions. */
  nodesBetween(
    from: number,
    to: number,
    f: (node: Node, pos: number, parent: Node | null, index: number) => boolean | void,
    startPos = 0
  ): void {
    this[CORE].nodesBetween(from, to, visitor(f), startPos)
  }

  /** Call the given callback for every descendant node. */
  descendants(f: (node: Node, pos: number, parent: Node | null, index: number) => boolean | void): void {
    this[CORE].descendants(visitor(f))
  }

  /** Concatenates all the text nodes found in this fragment and its children. */
  get textContent(): string {
    return this[CORE].textContent
  }

  /** Get all text between positions `from` and `to`. */
  textBetween(
    from: number,
    to: number,
    blockSeparator?: string | null,
    leafText?: null | string | ((leafNode: Node) => string)
  ): string {
    return this[CORE].textBetween(from, to, blockSeparator, leafTextInput(leafText))
  }

  /** Returns this node's first child, or `null` if there are no children. */
  get firstChild(): Node | null {
    return nullable(this[CORE].firstChild)
  }

  /** Returns this node's last child, or `null` if there are no children. */
  get lastChild(): Node | null {
    return nullable(this[CORE].lastChild)
  }

  /** Test whether two nodes represent the same piece of document. */
  eq(other: Node): boolean {
    return this === other || this[CORE].eq(other[CORE])
  }

  /** Compare the markup (type, attributes, and marks) of this node to those of another. */
  sameMarkup(other: Node): boolean {
    return this[CORE].sameMarkup(other[CORE])
  }

  /** Check whether this node's markup correspond to the given type, attributes, and marks. */
  hasMarkup(type: NodeType, attrs?: Attrs | null, marks?: ReadonlyArray<Mark>): boolean {
    return this[CORE].hasMarkup(type[CORE], attrs, marksInput(marks))
  }

  /** Create a new node with the same markup as this node, containing the given content. */
  copy(content: Fragment | null = null): Node {
    return wrap(this[CORE].copy(content && content[CORE]))
  }

  /** Create a copy of this node, with the given set of marks instead of the node's own marks. */
  mark(marks: ReadonlyArray<Mark>): Node {
    return wrap(this[CORE].mark(unwrapArray(marks)))
  }

  /** Create a copy of this node with only the content between the given positions. */
  cut(from: number, to?: number): Node {
    return wrap(this[CORE].cut(from, to))
  }

  /** Cut out the part of the document between the given positions, and return it as a `Slice` object. */
  slice(from: number, to: number = this.content.size, includeParents = false): Slice {
    return wrap(guard(() => this[CORE].sliceUnsafe(from, to, includeParents)))
  }

  /** Replace the part of the document between the given positions with the given slice. */
  replace(from: number, to: number, slice: Slice): Node {
    return wrap(guard(() => this[CORE].replaceUnsafe(from, to, slice[CORE])))
  }

  /** Find the node directly after the given position. */
  nodeAt(pos: number): Node | null {
    return wrap(this[CORE].nodeAtOrNull(pos))
  }

  /** Find the (direct) child node after the given offset, if any. */
  childAfter(pos: number): { node: Node | null; index: number; offset: number } {
    const { index, node, offset } = guard(() => this[CORE].childAfter(pos))
    return { node: nullable(node), index, offset }
  }

  /** Find the (direct) child node before the given offset, if any. */
  childBefore(pos: number): { node: Node | null; index: number; offset: number } {
    const { index, node, offset } = guard(() => this[CORE].childBefore(pos))
    return { node: nullable(node), index, offset }
  }

  /** Resolve the given position in the document. */
  resolve(pos: number): ResolvedPos {
    return wrap(guard(() => this[CORE].resolveUnsafe(pos)))
  }

  /** @internal */
  resolveNoCache(pos: number): ResolvedPos {
    return wrap(guard(() => this[CORE].resolveNoCache(pos)))
  }

  /** Test whether a given mark or mark type occurs in this document between the two given positions. */
  rangeHasMark(from: number, to: number, type: Mark | MarkType): boolean {
    return this[CORE].rangeHasMark(from, to, type[CORE])
  }

  /** True when this is a block (non-inline node). */
  get isBlock(): boolean {
    return this[CORE].isBlock
  }

  /** True when this is a textblock node, a block node with inline content. */
  get isTextblock(): boolean {
    return this[CORE].isTextblock
  }

  /** True when this node allows inline content. */
  get inlineContent(): boolean {
    return this[CORE].inlineContent
  }

  /** True when this is an inline node. */
  get isInline(): boolean {
    return this[CORE].isInline
  }

  /** True when this is a text node. */
  get isText(): boolean {
    return this[CORE].isText
  }

  /** True when this is a leaf node. */
  get isLeaf(): boolean {
    return this[CORE].isLeaf
  }

  /** True when this is an atom. */
  get isAtom(): boolean {
    return this[CORE].isAtom
  }

  /** Return a string representation of this node for debugging purposes. */
  toString(): string {
    return this[CORE].toString()
  }

  /** Get the content match in this node at the given index. */
  contentMatchAt(index: number): ContentMatch {
    return wrap(guard(() => this[CORE].contentMatchAtUnsafe(index)))
  }

  /**
   * Test whether replacing the range between `from` and `to` (by child
   * index) with the given replacement fragment would leave the node's
   * content valid.
   */
  canReplace(from: number, to: number, replacement: Fragment = Fragment.empty, start = 0, end?: number): boolean {
    return guard(() => this[CORE].canReplace(from, to, replacement[CORE], start, end))
  }

  /** Test whether replacing the range `from` to `to` (by index) with a node of the given type would be valid. */
  canReplaceWith(from: number, to: number, type: NodeType, marks?: ReadonlyArray<Mark>): boolean {
    return guard(() => this[CORE].canReplaceWith(from, to, type[CORE], marksInput(marks)))
  }

  /** Test whether the given node's content could be appended to this node. */
  canAppend(other: Node): boolean {
    return guard(() => this[CORE].canAppend(other[CORE]))
  }

  /** Check whether this node and its descendants conform to the schema, and raise an exception when they do not. */
  check(): void {
    guard(() => this[CORE].checkUnsafe())
  }

  /** Return a JSON-serializeable representation of this node. */
  toJSON(): any {
    return this[CORE].toJSON()
  }

  /** Deserialize a node from its JSON representation. */
  static fromJSON(schema: Schema, json: any): Node {
    return wrap(guard(() => schema[CORE].nodeFromJSONUnsafe(json)))
  }
}

/** @internal */
export class TextNode extends Node {
  /** @internal */
  declare readonly [CORE]: M.TextNode

  override get text(): string {
    return this[CORE].text
  }

  /** @internal */
  withText(text: string): TextNode {
    return wrap(this[CORE].withText(text))
  }
}

const visitor = (f: (node: Node, pos: number, parent: Node | null, index: number) => boolean | void) =>
(
  node: M.Node,
  pos: number,
  parent: Option.Option<M.Node>,
  index: number
) => f(wrap(node), pos, nullable(parent), index)

const leafTextInput = (leafText: null | undefined | string | ((leafNode: Node) => string)) =>
  typeof leafText === "function" ? (node: M.Node) => leafText(wrap(node)) : leafText

registerWrapper(M.Node, (core) => adopt(Node.prototype, core))
registerWrapper(M.TextNode, (core) => adopt(TextNode.prototype, core))

// -----------------------------------------------------------------------------
// Fragment
// -----------------------------------------------------------------------------

/**
 * A fragment represents a node's collection of child nodes.
 *
 * @since 0.1.0
 * @category models
 */
export class Fragment {
  /** @internal */
  declare readonly [CORE]: M.Fragment

  /** @internal */
  constructor(content: ReadonlyArray<Node>, size?: number) {
    link(this, new M.Fragment(unwrapArray(content), size))
  }

  /** The child nodes in this fragment. */
  get content(): ReadonlyArray<Node> {
    return wrapArray(this[CORE].content)
  }

  /** The size of the fragment, which is the total of the size of its content nodes. */
  get size(): number {
    return this[CORE].size
  }

  /** Invoke a callback for all descendant nodes between the given two positions. */
  nodesBetween(
    from: number,
    to: number,
    f: (node: Node, start: number, parent: Node | null, index: number) => boolean | void,
    nodeStart = 0,
    parent?: Node
  ): void {
    this[CORE].nodesBetween(from, to, visitor(f), nodeStart, parent && parent[CORE])
  }

  /** Call the given callback for every descendant node. */
  descendants(f: (node: Node, pos: number, parent: Node | null, index: number) => boolean | void): void {
    this[CORE].descendants(visitor(f))
  }

  /** Extract the text between `from` and `to`. */
  textBetween(
    from: number,
    to: number,
    blockSeparator?: string | null,
    leafText?: string | null | ((leafNode: Node) => string)
  ): string {
    return this[CORE].textBetween(from, to, blockSeparator, leafTextInput(leafText))
  }

  /** Create a new fragment containing the combined content of this fragment and the other. */
  append(other: Fragment): Fragment {
    return wrap(this[CORE].append(other[CORE]))
  }

  /** Cut out the sub-fragment between the two given positions. */
  cut(from: number, to?: number): Fragment {
    return wrap(this[CORE].cut(from, to))
  }

  /** @internal */
  cutByIndex(from: number, to: number): Fragment {
    return wrap(this[CORE].cutByIndex(from, to))
  }

  /** Create a new fragment in which the node at the given index is replaced by the given node. */
  replaceChild(index: number, node: Node): Fragment {
    return wrap(this[CORE].replaceChild(index, node[CORE]))
  }

  /** Create a new fragment by prepending the given node to this fragment. */
  addToStart(node: Node): Fragment {
    return wrap(this[CORE].addToStart(node[CORE]))
  }

  /** Create a new fragment by appending the given node to this fragment. */
  addToEnd(node: Node): Fragment {
    return wrap(this[CORE].addToEnd(node[CORE]))
  }

  /** Compare this fragment to another one. */
  eq(other: Fragment): boolean {
    return this[CORE].eq(other[CORE])
  }

  /** The first child of the fragment, or `null` if it is empty. */
  get firstChild(): Node | null {
    return nullable(this[CORE].firstChild)
  }

  /** The last child of the fragment, or `null` if it is empty. */
  get lastChild(): Node | null {
    return nullable(this[CORE].lastChild)
  }

  /** The number of child nodes in this fragment. */
  get childCount(): number {
    return this[CORE].childCount
  }

  /** Get the child node at the given index. Raise an error when the index is out of range. */
  child(index: number): Node {
    return wrap(guard(() => this[CORE].childUnsafe(index)))
  }

  /** Get the child node at the given index, if it exists. */
  maybeChild(index: number): Node | null {
    return wrap(this[CORE].content[index] ?? null)
  }

  /** Call `f` for every child node in this fragment. */
  forEach(f: (node: Node, offset: number, index: number) => void): void {
    this[CORE].forEach((node, offset, index) => f(wrap(node), offset, index))
  }

  /** Find the first position at which this fragment and another fragment differ, or `null` if they are the same. */
  findDiffStart(other: Fragment, pos = 0): number | null {
    return Option.getOrNull(this[CORE].findDiffStart(other[CORE], pos))
  }

  /** Find the first position, searching from the end, at which this fragment and the given fragment differ. */
  findDiffEnd(
    other: Fragment,
    pos: number = this.size,
    otherPos: number = other.size
  ): { a: number; b: number } | null {
    return Option.getOrNull(this[CORE].findDiffEnd(other[CORE], pos, otherPos)) as { a: number; b: number } | null
  }

  /** @internal */
  findIndex(pos: number): { index: number; offset: number } {
    return guard(() => this[CORE].findIndex(pos))
  }

  /** Return a debugging string that describes this fragment. */
  toString(): string {
    return this[CORE].toString()
  }

  /** @internal */
  toStringInner(): string {
    return this[CORE].toStringInner()
  }

  /** Create a JSON-serializeable representation of this fragment. */
  toJSON(): any {
    return this[CORE].toJSON()
  }

  /** Deserialize a fragment from its JSON representation. */
  static fromJSON(schema: Schema, value: any): Fragment {
    if (!value) return Fragment.empty
    if (!Array.isArray(value)) throw new RangeError("Invalid input for Fragment.fromJSON")
    return wrap(guard(() => M.Fragment.fromArray(value.map((v) => schema[CORE].nodeFromJSONUnsafe(v)))))
  }

  /** Build a fragment from an array of nodes. */
  static fromArray(array: ReadonlyArray<Node>): Fragment {
    return wrap(M.Fragment.fromArray(unwrapArray(array)))
  }

  /** Create a fragment from something that can be interpreted as a set of nodes. */
  static from(nodes?: Fragment | Node | ReadonlyArray<Node> | null): Fragment {
    return wrap(guard(() => M.Fragment.from(fragmentInput(nodes))))
  }

  /** An empty fragment. */
  static empty: Fragment
}

registerWrapper(M.Fragment, (core) => adopt(Fragment.prototype, core))
Fragment.empty = wrap(M.Fragment.empty)

// -----------------------------------------------------------------------------
// Mark
// -----------------------------------------------------------------------------

/**
 * A mark is a piece of information that can be attached to a node.
 *
 * @since 0.1.0
 * @category models
 */
export class Mark {
  /** @internal */
  declare readonly [CORE]: M.Mark

  /** @internal */
  constructor(type: MarkType, attrs: Attrs) {
    link(this, new M.Mark(type[CORE], attrs))
  }

  /** The type of this mark. */
  get type(): MarkType {
    return wrap(this[CORE].type)
  }

  /** The attributes associated with this mark. */
  get attrs(): Attrs {
    return this[CORE].attrs
  }

  /** Given a set of marks, create a new set which contains this one as well. */
  addToSet(set: ReadonlyArray<Mark>): ReadonlyArray<Mark> {
    return wrapArray(this[CORE].addToSet(unwrapArray(set)))
  }

  /** Remove this mark from the given set. */
  removeFromSet(set: ReadonlyArray<Mark>): ReadonlyArray<Mark> {
    return wrapArray(this[CORE].removeFromSet(unwrapArray(set)))
  }

  /** Test whether this mark is in the given set of marks. */
  isInSet(set: ReadonlyArray<Mark>): boolean {
    return this[CORE].isInSet(unwrapArray(set))
  }

  /** Test whether this mark has the same type and attributes as another mark. */
  eq(other: Mark): boolean {
    return this === other || this[CORE].eq(other[CORE])
  }

  /** Convert this mark to a JSON-serializeable representation. */
  toJSON(): any {
    return this[CORE].toJSON()
  }

  /** @internal */
  toString(): string {
    return this[CORE].toString()
  }

  /** Deserialize a mark from JSON. */
  static fromJSON(schema: Schema, json: any): Mark {
    return wrap(guard(() => schema[CORE].markFromJSONUnsafe(json)))
  }

  /** Test whether two sets of marks are identical. */
  static sameSet(a: ReadonlyArray<Mark>, b: ReadonlyArray<Mark>): boolean {
    return a === b || M.Mark.sameSet(unwrapArray(a), unwrapArray(b))
  }

  /** Create a properly sorted mark set from null, a single mark, or an unsorted array of marks. */
  static setFrom(marks?: Mark | ReadonlyArray<Mark> | null): ReadonlyArray<Mark> {
    return wrapArray(M.Mark.setFrom(marks instanceof Mark ? marks[CORE] : marksInput(marks as any)))
  }

  /** The empty set of marks. */
  static none: ReadonlyArray<Mark>
}

registerWrapper(M.Mark, (core) => adopt(Mark.prototype, core))
Mark.none = wrapArray(M.Mark.none)
setEmptyCoreArray(M.Mark.none)

// -----------------------------------------------------------------------------
// Slice
// -----------------------------------------------------------------------------

/**
 * A slice represents a piece cut out of a larger document.
 *
 * @since 0.1.0
 * @category models
 */
export class Slice {
  /** @internal */
  declare readonly [CORE]: M.Slice

  /** Create a slice. */
  constructor(content: Fragment, openStart: number, openEnd: number) {
    link(this, new M.Slice(content[CORE], openStart, openEnd))
  }

  /** The slice's content. */
  get content(): Fragment {
    return wrap(this[CORE].content)
  }

  /** The open depth at the start of the fragment. */
  get openStart(): number {
    return this[CORE].openStart
  }

  /** The open depth at the end. */
  get openEnd(): number {
    return this[CORE].openEnd
  }

  /** The size this slice would add when inserted into a document. */
  get size(): number {
    return this[CORE].size
  }

  /** @internal */
  insertAt(pos: number, fragment: Fragment): Slice | null {
    return wrap(guard(() => this[CORE].insertAt(pos, fragment[CORE])))
  }

  /** @internal */
  removeBetween(from: number, to: number): Slice {
    return wrap(guard(() => this[CORE].removeBetween(from, to)))
  }

  /** Tests whether this slice is equal to another slice. */
  eq(other: Slice): boolean {
    return this[CORE].eq(other[CORE])
  }

  /** @internal */
  toString(): string {
    return this[CORE].toString()
  }

  /** Convert a slice to a JSON-serializable representation. */
  toJSON(): any {
    return this[CORE].toJSON()
  }

  /** Deserialize a slice from its JSON representation. */
  static fromJSON(schema: Schema, json: any): Slice {
    return wrap(guard(() => M.Slice.fromJSONUnsafe(schema[CORE], json)))
  }

  /** Create a slice from a fragment by taking the maximum possible open value on both side of the fragment. */
  static maxOpen(fragment: Fragment, openIsolating = true): Slice {
    return wrap(M.Slice.maxOpen(fragment[CORE], openIsolating))
  }

  /** The empty slice. */
  static empty: Slice
}

registerWrapper(M.Slice, (core) => adopt(Slice.prototype, core))
Slice.empty = wrap(M.Slice.empty)

// -----------------------------------------------------------------------------
// ResolvedPos / NodeRange
// -----------------------------------------------------------------------------

/**
 * You can resolve a position to get more information about it.
 *
 * @since 0.1.0
 * @category models
 */
export class ResolvedPos {
  /** @internal */
  declare readonly [CORE]: M.ResolvedPos
  /** @internal */
  declare private _path?: Array<any>

  /** @internal */
  constructor(pos: number, path: Array<any>, parentOffset: number) {
    link(this, new M.ResolvedPos(pos, path.map((x, i) => i % 3 === 0 ? unwrap(x) : x), parentOffset))
  }

  /** The position that was resolved. */
  get pos(): number {
    return this[CORE].pos
  }

  /** @internal */
  get path(): Array<any> {
    return this._path ??= this[CORE].path.map((x, i) => i % 3 === 0 ? wrap(x) : x)
  }

  /** The offset this position has into its parent node. */
  get parentOffset(): number {
    return this[CORE].parentOffset
  }

  /** The number of levels the parent node is from the root. */
  get depth(): number {
    return this[CORE].depth
  }

  /** The parent node that the position points into. */
  get parent(): Node {
    return wrap(this[CORE].parent)
  }

  /** The root node in which the position was resolved. */
  get doc(): Node {
    return wrap(this[CORE].doc)
  }

  /** The ancestor node at the given level. */
  node(depth?: number | null): Node {
    return wrap(this[CORE].node(depth))
  }

  /** The index into the ancestor at the given level. */
  index(depth?: number | null): number {
    return this[CORE].index(depth)
  }

  /** The index pointing after this position into the ancestor at the given level. */
  indexAfter(depth?: number | null): number {
    return this[CORE].indexAfter(depth)
  }

  /** The (absolute) position at the start of the node at the given level. */
  start(depth?: number | null): number {
    return this[CORE].start(depth)
  }

  /** The (absolute) position at the end of the node at the given level. */
  end(depth?: number | null): number {
    return this[CORE].end(depth)
  }

  /** The (absolute) position directly before the wrapping node at the given level. */
  before(depth?: number | null): number {
    return guard(() => this[CORE].beforeUnsafe(depth))
  }

  /** The (absolute) position directly after the wrapping node at the given level. */
  after(depth?: number | null): number {
    return guard(() => this[CORE].afterUnsafe(depth))
  }

  /** When this position points into a text node, this returns the distance between the position and the start of the text node. */
  get textOffset(): number {
    return this[CORE].textOffset
  }

  /** Get the node directly after the position, if any. */
  get nodeAfter(): Node | null {
    return wrap(this[CORE].nodeAfterOrNull)
  }

  /** Get the node directly before the position, if any. */
  get nodeBefore(): Node | null {
    return wrap(this[CORE].nodeBeforeOrNull)
  }

  /** Get the position at the given index in the parent node at the given depth. */
  posAtIndex(index: number, depth?: number | null): number {
    return this[CORE].posAtIndex(index, depth)
  }

  /** Get the marks at this position. */
  marks(): ReadonlyArray<Mark> {
    return wrapArray(this[CORE].marks())
  }

  /** Get the marks after the current position, if any, except those that are non-inclusive and not present at position `$end`. */
  marksAcross($end: ResolvedPos): ReadonlyArray<Mark> | null {
    const marks = this[CORE].marksAcrossOrNull($end[CORE])
    return marks && wrapArray(marks)
  }

  /** The depth up to which this position and the given (non-resolved) position share the same parent nodes. */
  sharedDepth(pos: number): number {
    return this[CORE].sharedDepth(pos)
  }

  /** Returns a range based on the place where this position and the given position diverge around block content. */
  blockRange(other: ResolvedPos = this, pred?: (node: Node) => boolean): NodeRange | null {
    return wrap(this[CORE].blockRangeOrNull(other[CORE], pred && ((node) => pred(wrap(node)))))
  }

  /** Query whether the given position shares the same parent node. */
  sameParent(other: ResolvedPos): boolean {
    return this[CORE].sameParent(other[CORE])
  }

  /** Return the greater of this and the given position. */
  max(other: ResolvedPos): ResolvedPos {
    return wrap(this[CORE].max(other[CORE]))
  }

  /** Return the smaller of this and the given position. */
  min(other: ResolvedPos): ResolvedPos {
    return wrap(this[CORE].min(other[CORE]))
  }

  /** @internal */
  toString(): string {
    return this[CORE].toString()
  }

  /** @internal */
  static resolve(doc: Node, pos: number): ResolvedPos {
    return wrap(guard(() => M.ResolvedPos.resolve(doc[CORE], pos)))
  }

  /** @internal */
  static resolveCached(doc: Node, pos: number): ResolvedPos {
    return wrap(guard(() => M.ResolvedPos.resolveCached(doc[CORE], pos)))
  }
}

registerWrapper(M.ResolvedPos, (core) => adopt(ResolvedPos.prototype, core))

/**
 * Represents a flat range of content, i.e. one that starts and ends in
 * the same node.
 *
 * @since 0.1.0
 * @category models
 */
export class NodeRange {
  /** @internal */
  declare readonly [CORE]: M.NodeRange

  /** Construct a node range. */
  constructor($from: ResolvedPos, $to: ResolvedPos, depth: number) {
    link(this, new M.NodeRange($from[CORE], $to[CORE], depth))
  }

  /** A resolved position along the start of the content. */
  get $from(): ResolvedPos {
    return wrap(this[CORE].$from)
  }

  /** A position along the end of the content. */
  get $to(): ResolvedPos {
    return wrap(this[CORE].$to)
  }

  /** The depth of the node that this range points into. */
  get depth(): number {
    return this[CORE].depth
  }

  /** The position at the start of the range. */
  get start(): number {
    return this[CORE].start
  }

  /** The position at the end of the range. */
  get end(): number {
    return this[CORE].end
  }

  /** The parent node that the range points into. */
  get parent(): Node {
    return wrap(this[CORE].parent)
  }

  /** The start index of the range in the parent node. */
  get startIndex(): number {
    return this[CORE].startIndex
  }

  /** The end index of the range in the parent node. */
  get endIndex(): number {
    return this[CORE].endIndex
  }
}

registerWrapper(M.NodeRange, (core) => adopt(NodeRange.prototype, core))

// -----------------------------------------------------------------------------
// ContentMatch
// -----------------------------------------------------------------------------

/**
 * Instances of this class represent a match state of a node type's
 * content expression.
 *
 * @since 0.1.0
 * @category models
 */
export class ContentMatch {
  /** @internal */
  declare readonly [CORE]: M.ContentMatch

  /** @internal */
  constructor(validEnd: boolean) {
    link(this, new M.ContentMatch(validEnd))
  }

  /** True when this match state represents a valid end of the node. */
  get validEnd(): boolean {
    return this[CORE].validEnd
  }

  /** @internal */
  get next(): ReadonlyArray<{ readonly type: NodeType; readonly next: ContentMatch }> {
    return this[CORE].next.map(wrapEdge)
  }

  /** @internal */
  static parse(string: string, nodeTypes: { readonly [name: string]: NodeType }): ContentMatch {
    const types: Record<string, M.NodeType> = {}
    for (const name in nodeTypes) types[name] = nodeTypes[name]![CORE]
    return wrap(guard(() => M.ContentMatch.compile(string, types, "")))
  }

  /** Match a node type, returning a match after that node if successful. */
  matchType(type: NodeType): ContentMatch | null {
    return wrap(this[CORE].matchTypeOrNull(type[CORE]))
  }

  /** Try to match a fragment. Returns the resulting match when successful. */
  matchFragment(frag: Fragment, start = 0, end: number = frag.childCount): ContentMatch | null {
    return wrap(this[CORE].matchFragmentOrNull(frag[CORE], start, end))
  }

  /** @internal */
  get inlineContent(): boolean {
    return this[CORE].inlineContent
  }

  /** Get the first matching node type at this match position that can be generated. */
  get defaultType(): NodeType | null {
    return wrap(this[CORE].defaultTypeOrNull)
  }

  /** @internal */
  compatible(other: ContentMatch): boolean {
    return this[CORE].compatible(other[CORE])
  }

  /** Try to match the given fragment, and if that fails, see if it can be made to match by inserting nodes in front of it. */
  fillBefore(after: Fragment, toEnd = false, startIndex = 0): Fragment | null {
    return wrap(this[CORE].fillBeforeOrNull(after[CORE], toEnd, startIndex))
  }

  /** Find a set of wrapping node types that would allow a node of the given type to appear at this position. */
  findWrapping(target: NodeType): ReadonlyArray<NodeType> | null {
    const found = this[CORE].findWrappingOrNull(target[CORE])
    return found && wrapArray(found)
  }

  /** The number of outgoing edges this node has in the finite automaton that describes the content expression. */
  get edgeCount(): number {
    return this[CORE].edgeCount
  }

  /** Get the _n_th outgoing edge from this node in the finite automaton that describes the content expression. */
  edge(n: number): { readonly type: NodeType; readonly next: ContentMatch } {
    const edge = this[CORE].next[n]
    if (!edge) throw new RangeError(`There's no ${n}th edge in this content match`)
    return wrapEdge(edge)
  }

  /** @internal */
  toString(): string {
    return this[CORE].toString()
  }

  /** @internal */
  static empty: ContentMatch
}

const wrapEdge = (edge: M.MatchEdge) => ({ type: wrap(edge.type) as NodeType, next: wrap(edge.next) as ContentMatch })

registerWrapper(M.ContentMatch, (core) => adopt(ContentMatch.prototype, core))
ContentMatch.empty = wrap(M.ContentMatch.empty)

// -----------------------------------------------------------------------------
// Specs
// -----------------------------------------------------------------------------

/**
 * Used to define attributes on nodes or marks.
 *
 * @since 0.1.0
 * @category models
 */
export interface AttributeSpec {
  default?: any | undefined
  validate?: ((string | ((value: any) => void))) | undefined
}

/**
 * A description of a node type, used when defining a schema.
 *
 * @since 0.1.0
 * @category models
 */
export interface NodeSpec {
  content?: string | undefined
  marks?: string | undefined
  group?: string | undefined
  inline?: boolean | undefined
  atom?: boolean | undefined
  attrs?: { [name: string]: AttributeSpec } | undefined
  selectable?: boolean | undefined
  draggable?: boolean | undefined
  code?: boolean | undefined
  whitespace?: "pre" | "normal" | undefined
  definingAsContext?: boolean | undefined
  definingForContent?: boolean | undefined
  defining?: boolean | undefined
  isolating?: boolean | undefined
  toDOM?: ((node: Node) => DOMOutputSpec) | undefined
  parseDOM?: ReadonlyArray<TagParseRule> | undefined
  toDebugString?: ((node: Node) => string) | undefined
  leafText?: ((node: Node) => string) | undefined
  linebreakReplacement?: boolean | undefined
  [key: string]: any
}

/**
 * Used to define marks when creating a schema.
 *
 * @since 0.1.0
 * @category models
 */
export interface MarkSpec {
  attrs?: { [name: string]: AttributeSpec } | undefined
  inclusive?: boolean | undefined
  excludes?: string | undefined
  group?: string | undefined
  spanning?: boolean | undefined
  code?: boolean | undefined
  toDOM?: ((mark: Mark, inline: boolean) => DOMOutputSpec) | undefined
  parseDOM?: ReadonlyArray<ParseRule> | undefined
  [key: string]: any
}

/**
 * An object describing a schema, as passed to the `Schema` constructor.
 *
 * @since 0.1.0
 * @category models
 */
export interface SchemaSpec<Nodes extends string = any, Marks extends string = any> {
  nodes: { [name in Nodes]: NodeSpec } | OrderedMap<NodeSpec>
  marks?: { [name in Marks]: MarkSpec } | OrderedMap<MarkSpec> | undefined
  topNode?: string | undefined
}

/**
 * Fields that may be present in both tag and style parse rules.
 *
 * @since 0.1.0
 * @category models
 */
export interface GenericParseRule {
  priority?: number | undefined
  consuming?: boolean | undefined
  context?: string | undefined
  mark?: string | undefined
  ignore?: boolean | undefined
  closeParent?: boolean | undefined
  skip?: boolean | undefined
  attrs?: Attrs | undefined
}

/**
 * Parse rule targeting a DOM element.
 *
 * @since 0.1.0
 * @category models
 */
export interface TagParseRule extends GenericParseRule {
  tag: string
  style?: undefined
  namespace?: string | undefined
  node?: string | undefined
  getAttrs?: ((node: HTMLElement) => Attrs | false | null) | undefined
  contentElement?: ((string | HTMLElement | ((node: HTMLElement) => HTMLElement))) | undefined
  getContent?: ((node: globalThis.Node, schema: Schema) => Fragment) | undefined
  preserveWhitespace?: boolean | "full" | undefined
}

/**
 * A parse rule targeting a style property.
 *
 * @since 0.1.0
 * @category models
 */
export interface StyleParseRule extends GenericParseRule {
  style: string
  clearMark?: ((mark: Mark) => boolean) | undefined
  getAttrs?: ((node: string) => Attrs | false | null) | undefined
}

/**
 * A value that describes how to parse a given DOM node or inline style
 * as a ProseMirror node or mark.
 *
 * @since 0.1.0
 * @category models
 */
export type ParseRule = TagParseRule | StyleParseRule

const translateRule = (rule: any): any => {
  if (!rule.getContent && !rule.clearMark) return rule
  const copy = { ...rule, [ORIGINAL]: rule }
  if (rule.getContent) {
    copy.getContent = (dom: globalThis.Node, schema: M.AnySchema) => unwrap(rule.getContent(dom, wrap(schema)))
  }
  if (rule.clearMark) copy.clearMark = (mark: M.Mark) => rule.clearMark(wrap(mark))
  return copy
}

const translateNodeSpec = (spec: NodeSpec): M.NodeSpec => {
  const copy: any = { ...spec, [ORIGINAL]: spec }
  if (spec.toDOM) copy.toDOM = (node: M.Node) => spec.toDOM!(wrap(node))
  if (spec.toDebugString) copy.toDebugString = (node: M.Node) => spec.toDebugString!(wrap(node))
  if (spec.leafText) copy.leafText = (node: M.Node) => spec.leafText!(wrap(node))
  if (spec.parseDOM) copy.parseDOM = spec.parseDOM.map(translateRule)
  return copy
}

const translateMarkSpec = (spec: MarkSpec): M.MarkSpec => {
  const copy: any = { ...spec, [ORIGINAL]: spec }
  if (spec.toDOM) copy.toDOM = (mark: M.Mark, inline: boolean) => spec.toDOM!(wrap(mark), inline)
  if (spec.parseDOM) copy.parseDOM = spec.parseDOM.map(translateRule)
  return copy
}

const originalSpec = (spec: any): any => spec[ORIGINAL] ?? spec

// -----------------------------------------------------------------------------
// NodeType / MarkType
// -----------------------------------------------------------------------------

/**
 * Node types are objects allocated once per `Schema` and used to tag
 * `Node` instances.
 *
 * @since 0.1.0
 * @category models
 */
export class NodeType {
  /** @internal */
  declare readonly [CORE]: M.NodeType

  /** The name the node type has in this schema. */
  get name(): string {
    return this[CORE].name
  }

  /** A link back to the `Schema` the node type belongs to. */
  get schema(): Schema {
    return wrap(this[CORE].schema)
  }

  /** The spec that this type is based on. */
  get spec(): NodeSpec {
    return originalSpec(this[CORE].spec)
  }

  /** @internal */
  get groups(): ReadonlyArray<string> {
    return this[CORE].groups
  }

  /** @internal */
  get attrs(): { readonly [name: string]: { readonly hasDefault: boolean; readonly default: any } } {
    return this[CORE].attrs
  }

  /** @internal */
  get defaultAttrs(): Attrs | null {
    return this[CORE].defaultAttrs
  }

  /** True if this is a block type. */
  get isBlock(): boolean {
    return this[CORE].isBlock
  }

  /** True if this is the text node type. */
  get isText(): boolean {
    return this[CORE].isText
  }

  /** True if this node type has inline content. */
  get inlineContent(): boolean {
    return this[CORE].inlineContent
  }

  /** The starting match of the node type's content expression. */
  get contentMatch(): ContentMatch {
    return wrap(this[CORE].contentMatch)
  }

  /** The set of marks allowed in this node. `null` means all marks are allowed. */
  get markSet(): ReadonlyArray<MarkType> | null {
    const set = this[CORE].markSet
    return set && wrapArray(set)
  }

  /** True if this is an inline type. */
  get isInline(): boolean {
    return this[CORE].isInline
  }

  /** True if this is a textblock type, a block that contains inline content. */
  get isTextblock(): boolean {
    return this[CORE].isTextblock
  }

  /** True for node types that allow no content. */
  get isLeaf(): boolean {
    return this[CORE].isLeaf
  }

  /** True when this node is an atom, i.e. when it does not have directly editable content. */
  get isAtom(): boolean {
    return this[CORE].isAtom
  }

  /** Return true when this node type is part of the given group. */
  isInGroup(group: string): boolean {
    return this[CORE].isInGroup(group)
  }

  /** The node type's whitespace option. */
  get whitespace(): "pre" | "normal" {
    return this[CORE].whitespace
  }

  /** Tells you whether this node type has any required attributes. */
  hasRequiredAttrs(): boolean {
    return this[CORE].hasRequiredAttrs()
  }

  /** Indicates whether this node allows some of the same content as the given node type. */
  compatibleContent(other: NodeType): boolean {
    return this[CORE].compatibleContent(other[CORE])
  }

  /** @internal */
  computeAttrs(attrs: Attrs | null | undefined): Attrs {
    return guard(() => this[CORE].computeAttrs(attrs))
  }

  /** Create a `Node` of this type. */
  create(
    attrs: Attrs | null = null,
    content?: Fragment | Node | ReadonlyArray<Node> | null,
    marks?: ReadonlyArray<Mark>
  ): Node {
    return wrap(guard(() => this[CORE].createUnsafe(attrs, fragmentInput(content), marksInput(marks))))
  }

  /** Like `create`, but check the given content against the node type's content restrictions. */
  createChecked(
    attrs: Attrs | null = null,
    content?: Fragment | Node | ReadonlyArray<Node> | null,
    marks?: ReadonlyArray<Mark>
  ): Node {
    return wrap(guard(() => this[CORE].createCheckedUnsafe(attrs, fragmentInput(content), marksInput(marks))))
  }

  /** Like `create`, but see if it is necessary to add nodes to the start or end of the given fragment to make it fit the node. */
  createAndFill(
    attrs: Attrs | null = null,
    content?: Fragment | Node | ReadonlyArray<Node> | null,
    marks?: ReadonlyArray<Mark>
  ): Node | null {
    return wrap(guard(() => this[CORE].createAndFillOrNull(attrs, fragmentInput(content), marksInput(marks))))
  }

  /** Returns true if the given fragment is valid content for this node type. */
  validContent(content: Fragment): boolean {
    return this[CORE].validContent(content[CORE])
  }

  /** @internal */
  checkContent(content: Fragment): void {
    guard(() => this[CORE].checkContent(content[CORE]))
  }

  /** @internal */
  checkAttrs(attrs: Attrs): void {
    guard(() => this[CORE].checkAttrs(attrs))
  }

  /** Check whether the given mark type is allowed in this node. */
  allowsMarkType(markType: MarkType): boolean {
    return this[CORE].allowsMarkType(markType[CORE])
  }

  /** Test whether the given set of marks are allowed in this node. */
  allowsMarks(marks: ReadonlyArray<Mark>): boolean {
    return this[CORE].allowsMarks(unwrapArray(marks))
  }

  /** Removes the marks that are not allowed in this node from the given set. */
  allowedMarks(marks: ReadonlyArray<Mark>): ReadonlyArray<Mark> {
    return wrapArray(this[CORE].allowedMarks(unwrapArray(marks)))
  }

  /** @internal */
  toString(): string {
    return this[CORE].toString()
  }
}

registerWrapper(M.NodeType, (core) => adopt(NodeType.prototype, core))

/**
 * Like nodes, marks (which are associated with nodes to signify things
 * like emphasis or being part of a link) are tagged with type objects,
 * which are instantiated once per `Schema`.
 *
 * @since 0.1.0
 * @category models
 */
export class MarkType {
  /** @internal */
  declare readonly [CORE]: M.MarkType

  /** The name of the mark type. */
  get name(): string {
    return this[CORE].name
  }

  /** @internal */
  get rank(): number {
    return this[CORE].rank
  }

  /** The schema that this mark type instance is part of. */
  get schema(): Schema {
    return wrap(this[CORE].schema)
  }

  /** The spec on which the type is based. */
  get spec(): MarkSpec {
    return originalSpec(this[CORE].spec)
  }

  /** @internal */
  get attrs(): { readonly [name: string]: { readonly hasDefault: boolean; readonly default: any } } {
    return this[CORE].attrs
  }

  /** @internal */
  get excluded(): ReadonlyArray<MarkType> {
    return wrapArray(this[CORE].excluded)
  }

  /** @internal */
  get instance(): Mark | null {
    return wrap(this[CORE].instance)
  }

  /** Create a mark of this type. */
  create(attrs: Attrs | null = null): Mark {
    return wrap(guard(() => this[CORE].createUnsafe(attrs)))
  }

  /** When there is a mark of this type in the given set, a new set without it is returned. */
  removeFromSet(set: ReadonlyArray<Mark>): ReadonlyArray<Mark> {
    return wrapArray(this[CORE].removeFromSet(unwrapArray(set)))
  }

  /** Tests whether there is a mark of this type in the given set. */
  isInSet(set: ReadonlyArray<Mark>): Mark | undefined {
    return wrap(this[CORE].findInSet(unwrapArray(set)))
  }

  /** @internal */
  checkAttrs(attrs: Attrs): void {
    guard(() => this[CORE].checkAttrs(attrs))
  }

  /** Queries whether a given mark type is excluded by this one. */
  excludes(other: MarkType): boolean {
    return this[CORE].excludes(other[CORE])
  }

  /** @internal */
  toString(): string {
    return this[CORE].toString()
  }
}

registerWrapper(M.MarkType, (core) => adopt(MarkType.prototype, core))

// -----------------------------------------------------------------------------
// Schema
// -----------------------------------------------------------------------------

/**
 * A document schema. Holds node and mark type objects for the nodes and
 * marks that may occur in conforming documents, and provides
 * functionality for creating and deserializing such documents.
 *
 * @since 0.1.0
 * @category models
 */
export class Schema<Nodes extends string = any, Marks extends string = any> {
  /** @internal */
  declare readonly [CORE]: M.DocSchema

  /** The spec on which the schema is based. */
  declare spec: {
    nodes: OrderedMap<NodeSpec>
    marks: OrderedMap<MarkSpec>
    topNode?: string
  }

  /** An object mapping the schema's node names to node type objects. */
  declare nodes: { readonly [name in Nodes]: NodeType } & { readonly [key: string]: NodeType }

  /** A map from mark names to mark type objects. */
  declare marks: { readonly [name in Marks]: MarkType } & { readonly [key: string]: MarkType }

  /** The linebreak replacement node defined in this schema, if any. */
  declare linebreakReplacement: NodeType | null

  /** The type of the default top node for this schema. */
  declare topNodeType: NodeType

  /** An object for storing whatever values modules may want to compute and cache per schema. */
  declare cached: { [key: string]: any }

  /** Construct a schema from a schema specification. */
  constructor(spec: SchemaSpec<Nodes, Marks>) {
    const instanceSpec: any = {}
    for (const prop in spec) instanceSpec[prop] = (spec as any)[prop]
    instanceSpec.nodes = OrderedMap.from(spec.nodes)
    instanceSpec.marks = OrderedMap.from(spec.marks || {})
    const nodes: Record<string, M.NodeSpec> = {}, marks: Record<string, M.MarkSpec> = {}
    instanceSpec.nodes.forEach((name: string, s: NodeSpec) => {
      nodes[name] = translateNodeSpec(s)
    })
    instanceSpec.marks.forEach((name: string, s: MarkSpec) => {
      marks[name] = translateMarkSpec(s)
    })
    const core = guard(() => M.DocSchema.makeUnsafe({ nodes, marks, topNode: spec.topNode }))
    link(this, core)
    initSchema(this, core, instanceSpec)
  }

  /** Create a node in this schema. */
  node(
    type: string | NodeType,
    attrs: Attrs | null = null,
    content?: Fragment | Node | ReadonlyArray<Node>,
    marks?: ReadonlyArray<Mark>
  ): Node {
    return wrap(guard(() =>
      this[CORE].nodeUnsafe(
        typeof type === "string" ? type : type[CORE] as any,
        attrs,
        fragmentInput(content),
        marksInput(marks)
      )
    ))
  }

  /** Create a text node in the schema. Empty text nodes are not allowed. */
  text(text: string, marks?: ReadonlyArray<Mark> | null): Node {
    return wrap(guard(() => this[CORE].textUnsafe(text, marksInput(marks))))
  }

  /** Create a mark with the given type and attributes. */
  mark(type: string | MarkType, attrs?: Attrs | null): Mark {
    return wrap(guard(() => this[CORE].markUnsafe(typeof type === "string" ? type : type[CORE] as any, attrs)))
  }

  /** Deserialize a node from its JSON representation. */
  nodeFromJSON(json: any): Node {
    return wrap(guard(() => this[CORE].nodeFromJSONUnsafe(json)))
  }

  /** Deserialize a mark from its JSON representation. */
  markFromJSON(json: any): Mark {
    return wrap(guard(() => this[CORE].markFromJSONUnsafe(json)))
  }

  /** @internal */
  nodeType(name: string): NodeType {
    return wrap(guard(() => this[CORE].nodeType(name)))
  }
}

function initSchema(schema: Schema, core: M.DocSchema, spec: any) {
  const nodes: Record<string, NodeType> = Object.create(null)
  for (const name in core.nodes) nodes[name] = wrap(core.nodes[name])
  const marks: Record<string, MarkType> = Object.create(null)
  for (const name in core.marks) marks[name] = wrap(core.marks[name])
  schema.spec = spec
  schema.nodes = nodes as any
  schema.marks = marks as any
  schema.linebreakReplacement = nullable(core.linebreakReplacement)
  schema.topNodeType = wrap(core.topNodeType)
  schema.cached = Object.create(null)
  schema.nodeFromJSON = schema.nodeFromJSON.bind(schema)
  schema.markFromJSON = schema.markFromJSON.bind(schema)
}

registerWrapper(M.DocSchema, (core: M.DocSchema) => {
  const schema = adopt<Schema>(Schema.prototype, core)
  const nodes: Record<string, NodeSpec> = {}, marks: Record<string, MarkSpec> = {}
  for (const name in core.spec.nodes) nodes[name] = originalSpec(core.spec.nodes[name])
  for (const name in core.spec.marks) marks[name] = originalSpec(core.spec.marks[name])
  initSchema(schema, core, {
    ...core.spec,
    nodes: OrderedMap.from(nodes),
    marks: OrderedMap.from(marks)
  })
  return schema
})

// -----------------------------------------------------------------------------
// DOMParser
// -----------------------------------------------------------------------------

/**
 * Options accepted by the parser methods.
 *
 * @since 0.1.0
 * @category models
 */
export interface ParseOptions {
  preserveWhitespace?: boolean | "full" | undefined
  findPositions?: Array<{ node: globalThis.Node; offset: number; pos?: number }> | undefined
  from?: number | undefined
  to?: number | undefined
  topNode?: Node | undefined
  topMatch?: ContentMatch | undefined
  context?: ResolvedPos | undefined
  ruleFromNode?: ((node: globalThis.Node) => Omit<TagParseRule, "tag"> | null) | undefined
  topOpen?: boolean | undefined
}

/** @internal */
export const parseOptions = (options: ParseOptions | undefined): M.ParseOptions => {
  if (!options) return {}
  const result: any = { ...options }
  if (options.topNode) result.topNode = options.topNode[CORE]
  if (options.topMatch) result.topMatch = options.topMatch[CORE]
  if (options.context) result.context = options.context[CORE]
  if (options.ruleFromNode) {
    const f = options.ruleFromNode
    result.ruleFromNode = (node: globalThis.Node) => {
      const rule = f(node)
      return rule && translateRule(rule)
    }
  }
  return result
}

/**
 * A DOM parser represents a strategy for parsing DOM content into a
 * ProseMirror document conforming to a given schema.
 *
 * @since 0.1.0
 * @category models
 */
export class DOMParser {
  /** @internal */
  declare readonly [CORE]: M.DOMParser
  /** @internal */
  declare private _rules?: ReadonlyArray<ParseRule>

  /** Create a parser that targets the given schema, using the given parsing rules. */
  constructor(schema: Schema, rules: ReadonlyArray<ParseRule>) {
    this._rules = rules
    link(this, guard(() => new M.DOMParser(schema[CORE], rules.map(translateRule))))
  }

  /** The schema into which the parser parses. */
  get schema(): Schema {
    return wrap(this[CORE].schema)
  }

  /** The set of parse rules that the parser uses, in order of precedence. */
  get rules(): ReadonlyArray<ParseRule> {
    return this._rules ?? this[CORE].rules.map(originalSpec)
  }

  /** @internal */
  get tags(): ReadonlyArray<TagParseRule> {
    return this[CORE].tags.map(originalSpec)
  }

  /** @internal */
  get styles(): ReadonlyArray<StyleParseRule> {
    return this[CORE].styles.map(originalSpec)
  }

  /** Parse a document from the content of a DOM node. */
  parse(dom: globalThis.Node, options?: ParseOptions): Node {
    return wrap(guard(() => this[CORE].parseUnsafe(dom, parseOptions(options))))
  }

  /** Parses the content of the given DOM node, like `parse`, and returns a slice open at the sides. */
  parseSlice(dom: globalThis.Node, options?: ParseOptions): Slice {
    return wrap(guard(() => this[CORE].parseSliceUnsafe(dom, parseOptions(options))))
  }

  /** @internal */
  matchTag(dom: globalThis.Node, context?: any, after?: TagParseRule): TagParseRule | null {
    return Option.getOrNull(this[CORE].matchTag(dom, context, after as any)) as any
  }

  /** @internal */
  matchStyle(prop: string, value: string, context?: any, after?: StyleParseRule): StyleParseRule | null {
    return Option.getOrNull(this[CORE].matchStyle(prop, value, context, after as any)) as any
  }

  /** @internal */
  static schemaRules(schema: Schema): Array<ParseRule> {
    return M.DOMParser.schemaRules(schema[CORE]).map((rule: any) => {
      const original = rule[ORIGINAL]
      if (!original) return rule
      const result = { ...original }
      if (rule.node !== undefined) result.node = rule.node
      if (rule.mark !== undefined) result.mark = rule.mark
      return result
    })
  }

  /** Construct a DOM parser using the parsing rules listed in a schema's node specs, reordered by priority. */
  static fromSchema(schema: Schema): DOMParser {
    return wrap(M.DOMParser.fromSchema(schema[CORE]))
  }
}

registerWrapper(M.DOMParser, (core) => adopt(DOMParser.prototype, core))

// -----------------------------------------------------------------------------
// DOMSerializer
// -----------------------------------------------------------------------------

/**
 * A DOM serializer knows how to convert ProseMirror nodes and marks of
 * various types to DOM nodes.
 *
 * @since 0.1.0
 * @category models
 */
export class DOMSerializer {
  /** @internal */
  declare readonly [CORE]: M.DOMSerializer
  /** The node serialization functions. */
  declare readonly nodes: { readonly [node: string]: (node: Node) => DOMOutputSpec }
  /** The mark serialization functions. */
  declare readonly marks: {
    readonly [mark: string]: (mark: Mark, inline: boolean) => DOMOutputSpec
  }

  /** Create a serializer. */
  constructor(
    nodes: { readonly [node: string]: (node: Node) => DOMOutputSpec },
    marks: { readonly [mark: string]: ((mark: Mark, inline: boolean) => DOMOutputSpec) | null | undefined }
  ) {
    ;(this as any).nodes = nodes
    ;(this as any).marks = marks
    const coreNodes: Record<string, M.NodeSerializer> = {}
    for (const name in nodes) {
      const f = nodes[name]
      if (f) coreNodes[name] = (node) => f(wrap(node))
    }
    const coreMarks: Record<string, M.MarkSerializer | null | undefined> = {}
    for (const name in marks) {
      const f = marks[name]
      coreMarks[name] = f ? (mark, inline) => f(wrap(mark), inline) : f
    }
    link(this, new M.DOMSerializer(coreNodes, coreMarks))
  }

  /** Serialize the content of this fragment to a DOM fragment. */
  serializeFragment(
    fragment: Fragment,
    options: { document?: Document } = {},
    target?: HTMLElement | DocumentFragment
  ): HTMLElement | DocumentFragment {
    return guard(() => this[CORE].serializeFragment(fragment[CORE], options, target))
  }

  /** Serialize this node to a DOM node. */
  serializeNode(node: Node, options: { document?: Document } = {}): globalThis.Node {
    return guard(() => this[CORE].serializeNode(node[CORE], options))
  }

  /** @internal */
  serializeMark(
    mark: Mark,
    inline: boolean,
    options: { document?: Document } = {}
  ): { dom: globalThis.Node; contentDOM?: HTMLElement } | null {
    return guard(() => this[CORE].serializeMarkOrNull(mark[CORE], inline, options)) as any
  }

  /** Render an output spec to a DOM node. */
  static renderSpec(
    doc: Document,
    structure: DOMOutputSpec,
    xmlNS: string | null = null,
    blockArraysIn?: { [name: string]: any }
  ): { dom: globalThis.Node; contentDOM?: HTMLElement } {
    return guard(() => M.DOMSerializer.renderSpecUnsafe(doc, structure, xmlNS, blockArraysIn)) as any
  }

  /** Build a serializer using the `toDOM` properties in a schema's node and mark specs. */
  static fromSchema(schema: Schema): DOMSerializer {
    return schema.cached.domSerializer as DOMSerializer ||
      (schema.cached.domSerializer = new DOMSerializer(this.nodesFromSchema(schema), this.marksFromSchema(schema)))
  }

  /** Gather the serializers in a schema's node specs into an object. */
  static nodesFromSchema(schema: Schema): { [node: string]: (node: Node) => DOMOutputSpec } {
    const result = gatherToDOM(schema.nodes)
    if (!result.text) result.text = (node: Node) => node.text
    return result
  }

  /** Gather the serializers in a schema's mark specs into an object. */
  static marksFromSchema(schema: Schema): { [mark: string]: (mark: Mark, inline: boolean) => DOMOutputSpec } {
    return gatherToDOM(schema.marks)
  }
}

function gatherToDOM(obj: { readonly [node: string]: NodeType | MarkType }) {
  const result: { [node: string]: any } = {}
  for (const name in obj) {
    const toDOM = obj[name]!.spec.toDOM
    if (toDOM) result[name] = toDOM
  }
  return result
}

registerWrapper(M.DOMSerializer, (core: M.DOMSerializer) => {
  const serializer = adopt<DOMSerializer>(DOMSerializer.prototype, core)
  const nodes: Record<string, (node: Node) => DOMOutputSpec> = {}
  for (const name in core.nodes) nodes[name] = (node) => core.nodes[name]!(node[CORE])
  const marks: Record<string, (mark: Mark, inline: boolean) => DOMOutputSpec> = {}
  for (const name in core.marks) {
    const f = core.marks[name]
    if (f) marks[name] = (mark, inline) => f(mark[CORE], inline)
  }
  ;(serializer as any).nodes = nodes
  ;(serializer as any).marks = marks
  return serializer
})

// -----------------------------------------------------------------------------
// toCore / fromCore
// -----------------------------------------------------------------------------

/**
 * Get the core (Effect API) object behind a facade.
 *
 * @since 0.1.0
 * @category conversions
 */
export function toCore(node: Node): M.Node
export function toCore(fragment: Fragment): M.Fragment
export function toCore(mark: Mark): M.Mark
export function toCore(slice: Slice): M.Slice
export function toCore($pos: ResolvedPos): M.ResolvedPos
export function toCore(range: NodeRange): M.NodeRange
export function toCore(match: ContentMatch): M.ContentMatch
export function toCore(type: NodeType): M.NodeType
export function toCore(type: MarkType): M.MarkType
export function toCore(schema: Schema): M.DocSchema
export function toCore(parser: DOMParser): M.DOMParser
export function toCore(serializer: DOMSerializer): M.DOMSerializer
export function toCore(marks: ReadonlyArray<Mark>): ReadonlyArray<M.Mark>
export function toCore(nodes: ReadonlyArray<Node>): ReadonlyArray<M.Node>
export function toCore(value: unknown): unknown {
  return Array.isArray(value) ? unwrapArray(value) : unwrap(value)
}

/**
 * Get the facade for a core (Effect API) object. The same core object
 * always yields the same facade.
 *
 * @since 0.1.0
 * @category conversions
 */
export function fromCore(node: M.TextNode<any>): Node
export function fromCore(node: M.Node<any, any>): Node
export function fromCore(fragment: M.Fragment<any, any>): Fragment
export function fromCore(mark: M.Mark<any, any>): Mark
export function fromCore(slice: M.Slice<any>): Slice
export function fromCore($pos: M.ResolvedPos<any>): ResolvedPos
export function fromCore(range: M.NodeRange<any>): NodeRange
export function fromCore(match: M.ContentMatch): ContentMatch
export function fromCore(type: M.NodeType<any, any>): NodeType
export function fromCore(type: M.MarkType<any, any>): MarkType
export function fromCore(schema: M.DocSchema<any, any>): Schema
export function fromCore(parser: M.DOMParser<any>): DOMParser
export function fromCore(serializer: M.DOMSerializer<any>): DOMSerializer
export function fromCore(marks: ReadonlyArray<M.Mark<any, any>>): ReadonlyArray<Mark>
export function fromCore(nodes: ReadonlyArray<M.Node<any, any>>): ReadonlyArray<Node>
export function fromCore(value: unknown): unknown {
  return Array.isArray(value) ? wrapArray(value) : wrap(value)
}
