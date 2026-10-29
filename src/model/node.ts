/**
 * Document nodes.
 *
 * @since 0.1.0
 */
import type * as Effect from "effect/Effect"
import * as Equal from "effect/Equal"
import * as Hash from "effect/Hash"
import * as Option from "effect/Option"
import { attempt } from "../internal/attempt.ts"
import { showJson } from "../internal/json.ts"
import { encodeAttrs } from "./attrsCodec.ts"
import { compareDeep } from "./comparedeep.ts"
import type { ContentMatch } from "./content.ts"
import type { AttributeError } from "./errors.ts"
import { ContentError, isModelError, PositionError, type ReplaceError } from "./errors.ts"
import { Fragment, type NodeVisitor } from "./fragment.ts"
import { Mark, type MarkJSON } from "./mark.ts"
import { replace, Slice } from "./replace.ts"
import { ResolvedPos } from "./resolvedpos.ts"
import type { AnySchema, Attrs, ChildNames, MarkType, NodeAttrs, NodeNames, NodeType } from "./schema.ts"

const emptyAttrs: Attrs = Object.create(null)

const isPositionError = (u: unknown): u is PositionError => u instanceof PositionError

/**
 * The JSON representation of a node.
 *
 * @since 0.1.0
 * @category models
 */
export interface NodeJSON {
  readonly type: string
  readonly attrs?: { readonly [name: string]: unknown }
  readonly content?: ReadonlyArray<NodeJSON>
  readonly marks?: ReadonlyArray<MarkJSON>
  readonly text?: string
}

/**
 * The result of `childAfter` / `childBefore`.
 *
 * @since 0.1.0
 * @category models
 */
export interface ChildInfo<Sc extends AnySchema, N extends NodeNames<Sc>> {
  readonly node: Option.Option<Node<Sc, N>>
  readonly index: number
  readonly offset: number
}

/**
 * This class represents a node in the tree that makes up a document.
 * So a document is an instance of `Node`, with children that are also
 * instances of `Node`.
 *
 * Nodes are persistent data structures. Instead of changing them, you
 * create new ones with the content you want. Old ones keep pointing at
 * the old document shape. This is made cheaper by sharing structure
 * between the old and new data as much as possible.
 *
 * The type parameters track the schema and the node type name (or
 * union of names), which determines the type of `attrs` and of the
 * node's children. Use `is` to narrow a node to a specific type.
 *
 * Nodes implement `Equal`, comparing structurally.
 *
 * @since 0.1.0
 * @category models
 */
export class Node<Sc extends AnySchema = AnySchema, out N extends NodeNames<Sc> = NodeNames<Sc>>
  implements Equal.Equal
{
  /** A container holding the node's children. */
  readonly content: Fragment<Sc, ChildNames<Sc, N>>

  /** @internal */
  constructor(
    /** The type of node that this is. */
    readonly type: NodeType<Sc, N>,
    /**
     * An object mapping attribute names to values. The kind of
     * attributes allowed and required are determined by the node type.
     */
    readonly attrs: NodeAttrs<Sc, N>,
    content?: Fragment<Sc, ChildNames<Sc, N>> | null,
    /** The marks applied to this node. */
    readonly marks: ReadonlyArray<Mark<Sc>> = Mark.none
  ) {
    this.content = content || Fragment.empty
  }

  /** Narrow this node to the given node type(s). */
  is<K extends NodeNames<Sc>>(...names: ReadonlyArray<K>): this is Node<Sc, K> {
    return names.indexOf(this.type.name as any) > -1
  }

  /** Narrow this node to a text node. */
  isTextNode(): this is TextNode<Sc> {
    return this.type.isText
  }

  /** The array of this node's child nodes. */
  get children(): ReadonlyArray<Node<Sc, ChildNames<Sc, N>>> {
    return this.content.content
  }

  /**
   * The size of this node, as defined by the integer-based indexing
   * scheme. For text nodes, this is the amount of characters. For other
   * leaf nodes, it is one. For non-leaf nodes, it is the size of the
   * content plus two (the start and end token).
   */
  get nodeSize(): number {
    return this.isLeaf ? 1 : 2 + this.content.size
  }

  /** The number of children that the node has. */
  get childCount(): number {
    return this.content.childCount
  }

  /** Get the child node at the given index. Fails when the index is out of range. */
  child(index: number): Effect.Effect<Node<Sc, ChildNames<Sc, N>>, PositionError> {
    return this.content.child(index)
  }

  /** Like `child`, but throws a `PositionError` when the index is out of range. */
  childUnsafe(index: number): Node<Sc, ChildNames<Sc, N>> {
    return this.content.childUnsafe(index)
  }

  /** Get the child node at the given index, if it exists. */
  maybeChild(index: number): Option.Option<Node<Sc, ChildNames<Sc, N>>> {
    return this.content.maybeChild(index)
  }

  /** Call `f` for every child node, passing the node, its offset into this parent node, and its index. */
  forEach(f: (node: Node<Sc, ChildNames<Sc, N>>, offset: number, index: number) => void): void {
    this.content.forEach(f)
  }

  /**
   * Invoke a callback for all descendant nodes recursively overlapping
   * the given two positions that are relative to start of this node's
   * content. This includes all ancestors of the nodes containing the
   * two positions. The callback is invoked with the node, its position
   * relative to the original node (method receiver), its parent node,
   * and its child index. When the callback returns false for a given
   * node, that node's children will not be recursed over. The last
   * parameter can be used to specify a starting position to count
   * from.
   */
  nodesBetween(from: number, to: number, f: NodeVisitor<Sc>, startPos = 0): void {
    this.content.nodesBetween(from, to, f, startPos, this as Node<Sc>)
  }

  /** Call the given callback for every descendant node. Doesn't descend into a node when the callback returns `false`. */
  descendants(f: NodeVisitor<Sc>): void {
    this.nodesBetween(0, this.content.size, f)
  }

  /** Concatenates all the text nodes found in this node and its children. */
  get textContent(): string {
    return this.isLeaf && this.type.spec.leafText
      ? this.type.spec.leafText(this)
      : this.textBetween(0, this.content.size, "")
  }

  /**
   * Get all text between positions `from` and `to`. When
   * `blockSeparator` is given, it will be inserted to separate text from
   * different block nodes. If `leafText` is given, it'll be inserted for
   * every non-text leaf node encountered, otherwise the spec's
   * `leafText` will be used.
   */
  textBetween(
    from: number,
    to: number,
    blockSeparator?: string | null,
    leafText?: null | string | ((leafNode: Node<Sc>) => string)
  ): string {
    return this.content.textBetween(from, to, blockSeparator, leafText)
  }

  /** Returns this node's first child, if any. */
  get firstChild(): Option.Option<Node<Sc, ChildNames<Sc, N>>> {
    return this.content.firstChild
  }

  /** Returns this node's last child, if any. */
  get lastChild(): Option.Option<Node<Sc, ChildNames<Sc, N>>> {
    return this.content.lastChild
  }

  /** Test whether two nodes represent the same piece of document. */
  eq(other: Node<any, any>): boolean {
    return this === other || (this.sameMarkup(other) && this.content.eq(other.content))
  }

  /** @internal */
  [Equal.symbol](that: Equal.Equal): boolean {
    return that instanceof Node && this.eq(that)
  }

  /** @internal */
  [Hash.symbol](): number {
    return Hash.combine(Hash.string(this.type.name))(
      Hash.combine(Hash.structure(this.attrs as object))(Hash.combine(Hash.array(this.marks))(Hash.hash(this.content)))
    )
  }

  /** Compare the markup (type, attributes, and marks) of this node to those of another. */
  sameMarkup(other: Node<any, any>): boolean {
    return this.hasMarkup(other.type, other.attrs, other.marks)
  }

  /** Check whether this node's markup correspond to the given type, attributes, and marks. */
  hasMarkup(type: NodeType<any, any>, attrs?: Attrs | null, marks?: ReadonlyArray<Mark<any, any>>): boolean {
    return (
      this.type === type &&
      compareDeep(this.attrs, attrs || type.defaultAttrs || emptyAttrs) &&
      Mark.sameSet(this.marks, marks || Mark.none)
    )
  }

  /** Create a new node with the same markup as this node, containing the given content (or empty, if no content is given). */
  copy(content: Fragment<Sc, ChildNames<Sc, N>> | null = null): Node<Sc, N> {
    if (content === this.content) return this
    return new Node(this.type, this.attrs, content, this.marks)
  }

  /** Create a copy of this node, with the given set of marks instead of the node's own marks. */
  mark(marks: ReadonlyArray<Mark<Sc>>): Node<Sc, N> {
    return marks === this.marks ? this : new Node(this.type, this.attrs, this.content, marks)
  }

  /**
   * Create a copy of this node with only the content between the given
   * positions. If `to` is not given, it defaults to the end of the node.
   */
  cut(from: number, to: number = this.content.size): Node<Sc, N> {
    if (from === 0 && to === this.content.size) return this
    return this.copy(this.content.cut(from, to))
  }

  /** Cut out the part of the document between the given positions, and return it as a `Slice`. */
  slice(from: number, to: number = this.content.size, includeParents = false): Effect.Effect<Slice<Sc>, PositionError> {
    return attempt(() => this.sliceUnsafe(from, to, includeParents), isPositionError)
  }

  /** Like `slice`, but throws a `PositionError` for invalid positions. */
  sliceUnsafe(from: number, to: number = this.content.size, includeParents = false): Slice<Sc> {
    if (from === to) return Slice.empty
    const $from = this.resolveUnsafe(from),
      $to = this.resolveUnsafe(to)
    const depth = includeParents ? 0 : $from.sharedDepth(to)
    const start = $from.start(depth),
      node = $from.node(depth)
    const content = node.content.cut($from.pos - start, $to.pos - start)
    return new Slice(content, $from.depth - depth, $to.depth - depth)
  }

  /**
   * Replace the part of the document between the given positions with
   * the given slice. The slice must 'fit', meaning its open sides must
   * be able to connect to the surrounding content, and its content
   * nodes must be valid children for the node they are placed into. If
   * any of this is violated, the effect fails with a `ReplaceError`.
   */
  replace(
    from: number,
    to: number,
    slice: Slice<Sc>
  ): Effect.Effect<Node<Sc, N>, ReplaceError | PositionError | ContentError> {
    return attempt(() => this.replaceUnsafe(from, to, slice), isModelError as any)
  }

  /** Like `replace`, but throws on failure. */
  replaceUnsafe(from: number, to: number, slice: Slice<Sc>): Node<Sc, N> {
    return replace(this.resolveUnsafe(from), this.resolveUnsafe(to), slice) as Node<Sc, N>
  }

  /** Find the node directly after the given position, if any. */
  nodeAt(pos: number): Option.Option<Node<Sc>> {
    return Option.fromNullishOr(this.nodeAtOrNull(pos))
  }

  /** @internal */
  nodeAtOrNull(pos: number): Node<Sc> | null {
    if (pos < 0 || pos > this.content.size) return null
    for (let node: Node<Sc> | undefined = this as Node<Sc>; ;) {
      const { index, offset } = node.content.findIndex(pos)
      node = node.content.content[index]
      if (!node) return null
      if (offset === pos || node.isText) return node
      pos -= offset + 1
    }
  }

  /**
   * Find the (direct) child node after the given offset, if any, and
   * return it along with its index and offset relative to this node.
   */
  childAfter(pos: number): ChildInfo<Sc, ChildNames<Sc, N>> {
    const { index, offset } = this.content.findIndex(pos)
    return { node: this.content.maybeChild(index), index, offset }
  }

  /**
   * Find the (direct) child node before the given offset, if any, and
   * return it along with its index and offset relative to this node.
   */
  childBefore(pos: number): ChildInfo<Sc, ChildNames<Sc, N>> {
    if (pos === 0) return { node: Option.none(), index: 0, offset: 0 }
    const { index, offset } = this.content.findIndex(pos)
    if (offset < pos) return { node: Option.some(this.content.content[index]!), index, offset }
    const node = this.content.content[index - 1]!
    return { node: Option.some(node), index: index - 1, offset: offset - node.nodeSize }
  }

  /**
   * Resolve the given position in the document, returning an object
   * with information about its context.
   */
  resolve(pos: number): Effect.Effect<ResolvedPos<Sc>, PositionError> {
    return attempt(() => this.resolveUnsafe(pos), isPositionError)
  }

  /** Like `resolve`, but throws a `PositionError` for out-of-range positions. */
  resolveUnsafe(pos: number): ResolvedPos<Sc> {
    return ResolvedPos.resolveCached(this as Node<Sc>, pos)
  }

  /** @internal */
  resolveNoCache(pos: number): ResolvedPos<Sc> {
    return ResolvedPos.resolve(this as Node<Sc>, pos)
  }

  /** Test whether a given mark or mark type occurs in this document between the two given positions. */
  rangeHasMark(from: number, to: number, type: Mark<any, any> | MarkType<any, any>): boolean {
    let found = false
    if (to > from) {
      this.nodesBetween(from, to, (node) => {
        if (type instanceof Mark ? type.isInSet(node.marks) : type.findInSet(node.marks)) found = true
        return !found
      })
    }
    return found
  }

  /** True when this is a block (non-inline node) */
  get isBlock(): boolean {
    return this.type.isBlock
  }

  /** True when this is a textblock node, a block node with inline content. */
  get isTextblock(): boolean {
    return this.type.isTextblock
  }

  /** True when this node allows inline content. */
  get inlineContent(): boolean {
    return this.type.inlineContent
  }

  /** True when this is an inline node (a text node or a node that can appear among text). */
  get isInline(): boolean {
    return this.type.isInline
  }

  /** True when this is a text node. */
  get isText(): boolean {
    return this.type.isText
  }

  /** True when this is a leaf node. */
  get isLeaf(): boolean {
    return this.type.isLeaf
  }

  /**
   * True when this is an atom, i.e. when it does not have directly
   * editable content. This is usually the same as `isLeaf`, but can be
   * configured with the `atom` property on a node's spec.
   */
  get isAtom(): boolean {
    return this.type.isAtom
  }

  /** Return a string representation of this node for debugging purposes. */
  toString(): string {
    if (this.type.spec.toDebugString) return this.type.spec.toDebugString(this)
    let name: string = this.type.name
    if (this.content.size) name += "(" + this.content.toStringInner() + ")"
    return wrapMarks(this.marks, name)
  }

  /** Get the content match in this node at the given index. */
  contentMatchAt(index: number): Effect.Effect<ContentMatch, ContentError> {
    return attempt(
      () => this.contentMatchAtUnsafe(index),
      (u): u is ContentError => u instanceof ContentError
    )
  }

  /** Like `contentMatchAt`, but throws when the node's content is invalid. */
  contentMatchAtUnsafe(index: number): ContentMatch {
    const match = this.type.contentMatch.matchFragmentOrNull(this.content, 0, index)
    if (!match) throw new ContentError({ message: "Called contentMatchAt on a node with invalid content" })
    return match
  }

  /**
   * Test whether replacing the range between `from` and `to` (by child
   * index) with the given replacement fragment (which defaults to the
   * empty fragment) would leave the node's content valid. You can
   * optionally pass `start` and `end` indices into the replacement
   * fragment.
   */
  canReplace(
    from: number,
    to: number,
    replacement: Fragment<any, any> = Fragment.empty,
    start = 0,
    end = replacement.childCount
  ): boolean {
    const one = this.contentMatchAtUnsafe(from).matchFragmentOrNull(replacement, start, end)
    const two = one && one.matchFragmentOrNull(this.content, to)
    if (!two || !two.validEnd) return false
    for (let i = start; i < end; i++) if (!this.type.allowsMarks(replacement.content[i]!.marks)) return false
    return true
  }

  /**
   * Test whether replacing the range `from` to `to` (by index) with a
   * node of the given type would leave the node's content valid.
   */
  canReplaceWith(from: number, to: number, type: NodeType<any, any>, marks?: ReadonlyArray<Mark<any, any>>): boolean {
    if (marks && !this.type.allowsMarks(marks)) return false
    const start = this.contentMatchAtUnsafe(from).matchTypeOrNull(type)
    const end = start && start.matchFragmentOrNull(this.content, to)
    return end ? end.validEnd : false
  }

  /**
   * Test whether the given node's content could be appended to this
   * node. If that node is empty, this will only return true if there is
   * at least one node type that can appear in both nodes (to avoid
   * merging completely incompatible nodes).
   */
  canAppend(other: Node<any, any>): boolean {
    if (other.content.size) return this.canReplace(this.childCount, this.childCount, other.content)
    return this.type.compatibleContent(other.type)
  }

  /**
   * Check whether this node and its descendants conform to the schema
   * (including attribute schemas), failing with a `ContentError` or
   * `AttributeError` when they do not.
   */
  check(): Effect.Effect<void, ContentError | AttributeError> {
    return attempt(() => this.checkUnsafe(), isModelError as any)
  }

  /** Like `check`, but throws on failure. */
  checkUnsafe(): void {
    this.type.checkContent(this.content)
    this.type.checkAttrs(this.attrs)
    let copy: ReadonlyArray<Mark<Sc>> = Mark.none
    for (let i = 0; i < this.marks.length; i++) {
      const mark = this.marks[i]!
      mark.type.checkAttrs(mark.attrs)
      copy = mark.addToSet(copy)
    }
    if (!Mark.sameSet(copy, this.marks)) {
      throw new ContentError({
        message: `Invalid collection of marks for node ${this.type.name}: ${this.marks.map((m) => m.type.name)}`
      })
    }
    this.content.forEach((node) => node.checkUnsafe())
  }

  /** Return a JSON-serializable representation of this node. */
  toJSON(): NodeJSON {
    const obj: {
      type: string
      attrs?: { readonly [name: string]: unknown }
      content?: ReadonlyArray<NodeJSON>
      marks?: ReadonlyArray<MarkJSON>
    } = { type: this.type.name }
    for (const _ in this.attrs) {
      obj.attrs = encodeAttrs(this.type.attrs, this.attrs as Attrs)
      break
    }
    if (this.content.size) obj.content = this.content.toJSON()!
    if (this.marks.length) obj.marks = this.marks.map((n) => n.toJSON())
    return obj
  }
}

/**
 * A text node. Text nodes are always leaves and carry their text in
 * `text`.
 *
 * @since 0.1.0
 * @category models
 */
export class TextNode<Sc extends AnySchema = AnySchema> extends Node<Sc, "text" & NodeNames<Sc>> {
  /** The text content of this node. */
  readonly text: string

  /** @internal */
  constructor(type: NodeType<Sc, any>, attrs: Attrs, content: string, marks?: ReadonlyArray<Mark<Sc>>) {
    super(type, attrs as any, null, marks)
    if (!content) throw new ContentError({ message: "Empty text nodes are not allowed" })
    this.text = content
  }

  override toString(): string {
    if (this.type.spec.toDebugString) return this.type.spec.toDebugString(this)
    return wrapMarks(this.marks, showJson(this.text))
  }

  override get textContent(): string {
    return this.text
  }

  override textBetween(from: number, to: number): string {
    return this.text.slice(from, to)
  }

  override get nodeSize(): number {
    return this.text.length
  }

  override mark(marks: ReadonlyArray<Mark<Sc>>): TextNode<Sc> {
    return marks === this.marks ? this : new TextNode(this.type, this.attrs, this.text, marks)
  }

  /** Create a copy of this text node with different text. */
  withText(text: string): TextNode<Sc> {
    if (text === this.text) return this
    return new TextNode(this.type, this.attrs, text, this.marks)
  }

  override cut(from = 0, to = this.text.length): TextNode<Sc> {
    if (from === 0 && to === this.text.length) return this
    return this.withText(this.text.slice(from, to))
  }

  override eq(other: Node<any, any>): boolean {
    return this.sameMarkup(other) && other instanceof TextNode && this.text === other.text
  }

  override [Hash.symbol](): number {
    return Hash.combine(Hash.string(this.text))(Hash.array(this.marks))
  }

  override toJSON(): NodeJSON {
    return { ...super.toJSON(), text: this.text }
  }
}

function wrapMarks(marks: ReadonlyArray<Mark<any, any>>, str: string) {
  for (let i = marks.length - 1; i >= 0; i--) str = marks[i]!.type.name + "(" + str + ")"
  return str
}
