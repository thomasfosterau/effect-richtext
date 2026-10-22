/**
 * Slices and the replace algorithm.
 *
 * @since 0.1.0
 */
import * as Equal from "effect/Equal"
import * as Hash from "effect/Hash"
import { ContentError, JSONError, PositionError, ReplaceError } from "./errors.ts"
import { Fragment } from "./fragment.ts"
import type { Node, NodeJSON, TextNode } from "./node.ts"
import type { ResolvedPos } from "./resolvedpos.ts"
import type { AnySchema } from "./schema.ts"

/**
 * The JSON representation of a slice.
 *
 * @since 0.1.0
 * @category models
 */
export interface SliceJSON {
  readonly content: ReadonlyArray<NodeJSON>
  readonly openStart?: number
  readonly openEnd?: number
}

/**
 * A slice represents a piece cut out of a larger document. It stores
 * not only a fragment, but also the depth up to which nodes on both
 * side are ‘open’ (cut through).
 *
 * @since 0.1.0
 * @category models
 */
export class Slice<Sc extends AnySchema = AnySchema> implements Equal.Equal {
  /**
   * Create a slice. When specifying a non-zero open depth, you must
   * make sure that there are nodes of at least that depth at the
   * appropriate side of the fragment—i.e. if the fragment is an empty
   * paragraph node, `openStart` and `openEnd` can't be greater than 1.
   *
   * It is not necessary for the content of open nodes to conform to the
   * schema's content constraints, though it should be a valid
   * start/end/middle for such a node, depending on which sides are
   * open.
   */
  constructor(
    /** The slice's content. */
    readonly content: Fragment<Sc>,
    /** The open depth at the start of the fragment. */
    readonly openStart: number,
    /** The open depth at the end. */
    readonly openEnd: number
  ) {}

  /** The size this slice would add when inserted into a document. */
  get size(): number {
    return this.content.size - this.openStart - this.openEnd
  }

  /** @internal */
  insertAt(pos: number, fragment: Fragment<Sc>): Slice<Sc> | null {
    const content = insertInto(this.content, pos + this.openStart, fragment)
    return content && new Slice(content, this.openStart, this.openEnd)
  }

  /** @internal */
  removeBetween(from: number, to: number): Slice<Sc> {
    return new Slice(
      removeRange(this.content, from + this.openStart, to + this.openStart),
      this.openStart,
      this.openEnd
    )
  }

  /** Tests whether this slice is equal to another slice. */
  eq(other: Slice<any>): boolean {
    return this.content.eq(other.content) && this.openStart === other.openStart && this.openEnd === other.openEnd
  }

  /** @internal */
  [Equal.symbol](that: Equal.Equal): boolean {
    return that instanceof Slice && this.eq(that)
  }

  /** @internal */
  [Hash.symbol](): number {
    return Hash.combine(Hash.hash(this.content))(Hash.combine(Hash.number(this.openStart))(Hash.number(this.openEnd)))
  }

  /** @internal */
  toString(): string {
    return this.content + "(" + this.openStart + "," + this.openEnd + ")"
  }

  /** Convert a slice to a JSON-serializable representation. */
  toJSON(): SliceJSON | null {
    if (!this.content.size) return null
    const json: { content: ReadonlyArray<NodeJSON>; openStart?: number; openEnd?: number } = {
      content: this.content.toJSON()!
    }
    if (this.openStart > 0) json.openStart = this.openStart
    if (this.openEnd > 0) json.openEnd = this.openEnd
    return json
  }

  /** @internal */
  static fromJSONUnsafe<Sc extends AnySchema>(schema: Sc, json: any): Slice<Sc> {
    if (!json) return Slice.empty
    const openStart = json.openStart || 0,
      openEnd = json.openEnd || 0
    if (typeof openStart !== "number" || typeof openEnd !== "number") {
      throw new JSONError({ message: "Invalid input for Slice.fromJSON" })
    }
    if (json.content != null && !Array.isArray(json.content)) {
      throw new JSONError({ message: "Invalid input for Slice.fromJSON" })
    }
    const nodes = (json.content ?? []).map((n: unknown) => schema.nodeFromJSONUnsafe(n))
    return new Slice(Fragment.fromArray(nodes), openStart, openEnd)
  }

  /**
   * Create a slice from a fragment by taking the maximum possible open
   * value on both side of the fragment.
   */
  static maxOpen<Sc extends AnySchema>(fragment: Fragment<Sc>, openIsolating = true): Slice<Sc> {
    let openStart = 0,
      openEnd = 0
    for (
      let n = fragment.content[0];
      n && !n.isLeaf && (openIsolating || !n.type.spec.isolating);
      n = n.content.content[0]
    )
      openStart++
    for (
      let n = fragment.content[fragment.content.length - 1];
      n && !n.isLeaf && (openIsolating || !n.type.spec.isolating);
      n = n.content.content[n.content.content.length - 1]
    )
      openEnd++
    return new Slice(fragment, openStart, openEnd)
  }

  /** The empty slice. */
  static readonly empty: Slice<any> = new Slice(Fragment.empty, 0, 0)
}

function removeRange<Sc extends AnySchema>(content: Fragment<Sc>, from: number, to: number): Fragment<Sc> {
  const { index, offset } = content.findIndex(from)
  const child = content.content[index]
  const { index: indexTo, offset: offsetTo } = content.findIndex(to)
  if (offset === from || child!.isText) {
    if (offsetTo !== to && !content.content[indexTo]!.isText) {
      throw new PositionError({ message: "Removing non-flat range" })
    }
    return content.cut(0, from).append(content.cut(to))
  }
  if (index !== indexTo) throw new PositionError({ message: "Removing non-flat range" })
  return content.replaceChild(index, child!.copy(removeRange(child!.content, from - offset - 1, to - offset - 1)))
}

function insertInto<Sc extends AnySchema>(
  content: Fragment<Sc>,
  dist: number,
  insert: Fragment<Sc>,
  parent?: Node<Sc> | null
): Fragment<Sc> | null {
  const { index, offset } = content.findIndex(dist)
  const child = content.content[index]
  if (offset === dist || child!.isText) {
    if (parent && !parent.canReplace(index, index, insert)) return null
    return content.cut(0, dist).append(insert).append(content.cut(dist))
  }
  const inner = insertInto(child!.content, dist - offset - 1, insert, child)
  return inner && content.replaceChild(index, child!.copy(inner))
}

/** @internal */
export function replace<Sc extends AnySchema>(
  $from: ResolvedPos<Sc>,
  $to: ResolvedPos<Sc>,
  slice: Slice<Sc>
): Node<Sc> {
  if (slice.openStart > $from.depth) {
    throw new ReplaceError({ message: "Inserted content deeper than insertion position" })
  }
  if ($from.depth - slice.openStart !== $to.depth - slice.openEnd) {
    throw new ReplaceError({ message: "Inconsistent open depths" })
  }
  return replaceOuter($from, $to, slice, 0)
}

function replaceOuter<Sc extends AnySchema>(
  $from: ResolvedPos<Sc>,
  $to: ResolvedPos<Sc>,
  slice: Slice<Sc>,
  depth: number
): Node<Sc> {
  const index = $from.index(depth),
    node = $from.node(depth)
  if (index === $to.index(depth) && depth < $from.depth - slice.openStart) {
    const inner = replaceOuter($from, $to, slice, depth + 1)
    return node.copy(node.content.replaceChild(index, inner))
  } else if (!slice.content.size) {
    return close(node, replaceTwoWay($from, $to, depth))
  } else if (!slice.openStart && !slice.openEnd && $from.depth === depth && $to.depth === depth) {
    // Simple, flat case
    const parent = $from.parent,
      content = parent.content
    return close(parent, content.cut(0, $from.parentOffset).append(slice.content).append(content.cut($to.parentOffset)))
  } else {
    const { end, start } = prepareSliceForReplace(slice, $from)
    return close(node, replaceThreeWay($from, start, end, $to, depth))
  }
}

function checkJoin(main: Node<any>, sub: Node<any>) {
  if (!sub.type.compatibleContent(main.type)) {
    throw new ReplaceError({ message: "Cannot join " + sub.type.name + " onto " + main.type.name })
  }
}

function joinable<Sc extends AnySchema>($before: ResolvedPos<Sc>, $after: ResolvedPos<Sc>, depth: number) {
  const node = $before.node(depth)
  checkJoin(node, $after.node(depth))
  return node
}

function addNode<Sc extends AnySchema>(child: Node<Sc>, target: Array<Node<Sc>>) {
  const last = target.length - 1
  if (last >= 0 && child.isText && child.sameMarkup(target[last]!)) {
    target[last] = (child as TextNode<Sc>).withText((target[last] as TextNode<Sc>).text + (child as TextNode<Sc>).text)
  } else {
    target.push(child)
  }
}

function addRange<Sc extends AnySchema>(
  $start: ResolvedPos<Sc> | null,
  $end: ResolvedPos<Sc> | null,
  depth: number,
  target: Array<Node<Sc>>
) {
  const node = ($end || $start)!.node(depth)
  let startIndex = 0
  const endIndex = $end ? $end.index(depth) : node.childCount
  if ($start) {
    startIndex = $start.index(depth)
    if ($start.depth > depth) {
      startIndex++
    } else if ($start.textOffset) {
      addNode($start.nodeAfterOrNull!, target)
      startIndex++
    }
  }
  for (let i = startIndex; i < endIndex; i++) addNode(node.content.content[i]!, target)
  if ($end && $end.depth === depth && $end.textOffset) addNode($end.nodeBeforeOrNull!, target)
}

function close<Sc extends AnySchema>(node: Node<Sc>, content: Fragment<Sc>): Node<Sc> {
  try {
    node.type.checkContent(content)
  } catch (e) {
    if (e instanceof ContentError) throw new ReplaceError({ message: e.message })
    throw e
  }
  return node.copy(content)
}

function replaceThreeWay<Sc extends AnySchema>(
  $from: ResolvedPos<Sc>,
  $start: ResolvedPos<Sc>,
  $end: ResolvedPos<Sc>,
  $to: ResolvedPos<Sc>,
  depth: number
): Fragment<Sc> {
  const openStart = $from.depth > depth && joinable($from, $start, depth + 1)
  const openEnd = $to.depth > depth && joinable($end, $to, depth + 1)

  const content: Array<Node<Sc>> = []
  addRange(null, $from, depth, content)
  if (openStart && openEnd && $start.index(depth) === $end.index(depth)) {
    checkJoin(openStart, openEnd)
    addNode(close(openStart, replaceThreeWay($from, $start, $end, $to, depth + 1)), content)
  } else {
    if (openStart) addNode(close(openStart, replaceTwoWay($from, $start, depth + 1)), content)
    addRange($start, $end, depth, content)
    if (openEnd) addNode(close(openEnd, replaceTwoWay($end, $to, depth + 1)), content)
  }
  addRange($to, null, depth, content)
  return new Fragment(content)
}

function replaceTwoWay<Sc extends AnySchema>(
  $from: ResolvedPos<Sc>,
  $to: ResolvedPos<Sc>,
  depth: number
): Fragment<Sc> {
  const content: Array<Node<Sc>> = []
  addRange(null, $from, depth, content)
  if ($from.depth > depth) {
    const type = joinable($from, $to, depth + 1)
    addNode(close(type, replaceTwoWay($from, $to, depth + 1)), content)
  }
  addRange($to, null, depth, content)
  return new Fragment(content)
}

function prepareSliceForReplace<Sc extends AnySchema>(slice: Slice<Sc>, $along: ResolvedPos<Sc>) {
  const extra = $along.depth - slice.openStart,
    parent = $along.node(extra)
  let node = parent.copy(slice.content)
  for (let i = extra - 1; i >= 0; i--) node = $along.node(i).copy(Fragment.from(node))
  return {
    start: node.resolveNoCache(slice.openStart + extra),
    end: node.resolveNoCache(node.content.size - slice.openEnd - extra)
  }
}
