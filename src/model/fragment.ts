/**
 * Fragments: sequences of child nodes.
 *
 * @since 0.1.0
 */
import type * as Effect from "effect/Effect"
import * as Equal from "effect/Equal"
import * as Hash from "effect/Hash"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import { attempt } from "../internal/attempt.ts"
import { findDiffEnd, findDiffStart } from "./diff.ts"
import { PositionError } from "./errors.ts"
import type { Node, NodeJSON } from "./node.ts"
import type { AnySchema, NodeNames } from "./schema.ts"

const isPositionError = (u: unknown): u is PositionError => u instanceof PositionError

/**
 * Callback used by `nodesBetween` and `descendants`. Return `false` to
 * prevent descending into a node.
 *
 * @since 0.1.0
 * @category models
 */
export type NodeVisitor<Sc extends AnySchema = AnySchema> = (
  node: Node<Sc>,
  pos: number,
  parent: Option.Option<Node<Sc>>,
  index: number
) => boolean | void

/**
 * A fragment represents a node's collection of child nodes.
 *
 * Like nodes, fragments are persistent data structures, and you should
 * not mutate them or their content. Rather, you create new instances
 * whenever needed.
 *
 * Fragments implement `Equal` (structural equality) and are iterable.
 *
 * @example
 * ```ts
 * import * as assert from "node:assert"
 * import { Fragment } from "@thomasfosterau/effect-richtext/Model"
 * import { schema } from "@thomasfosterau/effect-richtext/SchemaBasic"
 *
 * const paragraph = schema.nodeUnsafe("paragraph", null, [schema.textUnsafe("Hi")])
 * const fragment = Fragment.from([paragraph, paragraph])
 *
 * // A paragraph holding "Hi" is 4 tokens long: open, two characters, close.
 * assert.strictEqual(fragment.childCount, 2)
 * assert.strictEqual(fragment.size, 8)
 * assert.strictEqual(fragment.textBetween(0, fragment.size, " "), "Hi Hi")
 * ```
 *
 * @since 0.1.0
 * @category models
 */
export class Fragment<Sc extends AnySchema = AnySchema, out N extends NodeNames<Sc> = NodeNames<Sc>>
  implements Equal.Equal, Iterable<Node<Sc, N>>
{
  /** The size of the fragment, which is the total of the size of its content nodes. */
  readonly size: number

  /** @internal */
  constructor(
    /** The child nodes in this fragment. */
    readonly content: ReadonlyArray<Node<Sc, N>>,
    size?: number
  ) {
    if (size === undefined) {
      size = 0
      // Every new fragment runs this, so it stays a plain loop.
      // oxlint-disable-next-line effect/imperative-loops
      for (let i = 0; i < content.length; i++) size += content[i].nodeSize
    }
    this.size = size
  }

  [Symbol.iterator](): Iterator<Node<Sc, N>> {
    return this.content[Symbol.iterator]()
  }

  /**
   * Invoke a callback for all descendant nodes between the given two
   * positions (relative to start of this fragment). Doesn't descend
   * into a node when the callback returns `false`.
   */
  nodesBetween(from: number, to: number, f: NodeVisitor<Sc>, nodeStart = 0, parent?: Node<Sc>): void {
    const parentOption: Option.Option<Node<Sc>> = parent ? Option.some(parent) : Option.none()
    // Visits every node of a document walk, so it stays a plain loop.
    // oxlint-disable-next-line effect/imperative-loops
    for (let i = 0, pos = 0; pos < to; i++) {
      const child = this.content[i],
        end = pos + child.nodeSize
      if (end > from && f(child, nodeStart + pos, parentOption, i) !== false && child.content.size) {
        const start = pos + 1
        child.nodesBetween(Math.max(0, from - start), Math.min(child.content.size, to - start), f, nodeStart + start)
      }
      pos = end
    }
  }

  /**
   * Call the given callback for every descendant node. `pos` will be
   * relative to the start of the fragment. The callback may return
   * `false` to prevent traversal of a given node's children.
   */
  descendants(f: NodeVisitor<Sc>): void {
    this.nodesBetween(0, this.size, f)
  }

  /** Extract the text between `from` and `to`. See `Node.textBetween`. */
  textBetween(
    from: number,
    to: number,
    blockSeparator?: string | null,
    leafText?: string | null | ((leafNode: Node<Sc>) => string)
  ): string {
    let text = "",
      first = true
    this.nodesBetween(
      from,
      to,
      (node, pos) => {
        const nodeText = node.isTextNode()
          ? node.text.slice(Math.max(from, pos) - pos, to - pos)
          : !node.isLeaf
            ? ""
            : leafText
              ? Predicate.isFunction(leafText)
                ? leafText(node)
                : leafText
              : node.type.spec.leafText
                ? node.type.spec.leafText(node)
                : ""
        if (node.isBlock && ((node.isLeaf && nodeText) || node.isTextblock) && blockSeparator) {
          if (first) first = false
          else text += blockSeparator
        }
        text += nodeText
      },
      0
    )
    return text
  }

  /** Create a new fragment containing the combined content of this fragment and the other. */
  append<N2 extends NodeNames<Sc>>(other: Fragment<Sc, N2>): Fragment<Sc, N | N2> {
    if (!other.size) return this
    if (!this.size) return other
    const last = this.content[this.content.length - 1],
      first = other.content[0]
    const content: Array<Node<Sc, N | N2>> = this.content.slice()
    let rest: ReadonlyArray<Node<Sc, N2>> = other.content
    if (last.isTextNode() && last.sameMarkup(first)) {
      const joinedText: Node<Sc> = last.withText(last.textContent + first.textContent)
      // SAFETY: the joined node keeps `last`'s type, one of `N`.
      content[content.length - 1] = joinedText as Node<Sc, N>
      rest = other.content.slice(1)
    }
    return new Fragment(content.concat(rest), this.size + other.size)
  }

  /** Cut out the sub-fragment between the two given positions. */
  cut(from: number, to = this.size): Fragment<Sc, N> {
    if (from === 0 && to === this.size) return this
    const result: Array<Node<Sc, N>> = []
    let size = 0
    if (to > from) {
      // Every replace cuts fragments, so this stays a plain loop.
      // oxlint-disable-next-line effect/imperative-loops
      for (let i = 0, pos = 0; pos < to; i++) {
        let child = this.content[i]
        const end = pos + child.nodeSize
        if (end > from) {
          if (pos < from || end > to) {
            if (child.isText) {
              child = child.cut(Math.max(0, from - pos), Math.min(child.nodeSize, to - pos))
            } else {
              child = child.cut(Math.max(0, from - pos - 1), Math.min(child.content.size, to - pos - 1))
            }
          }
          result.push(child)
          size += child.nodeSize
        }
        pos = end
      }
    }
    return new Fragment(result, size)
  }

  /** @internal */
  cutByIndex(from: number, to: number): Fragment<Sc, N> {
    if (from === to) return Fragment.empty
    if (from === 0 && to === this.content.length) return this
    return new Fragment(this.content.slice(from, to))
  }

  /** Create a new fragment in which the node at the given index is replaced by the given node. */
  replaceChild<N2 extends NodeNames<Sc>>(index: number, node: Node<Sc, N2>): Fragment<Sc, N | N2> {
    const current: Node<Sc, N | N2> = this.content[index]
    if (current === node) return this
    const copy: Array<Node<Sc, N | N2>> = this.content.slice()
    const size = this.size + node.nodeSize - current.nodeSize
    copy[index] = node
    return new Fragment(copy, size)
  }

  /** Create a new fragment by prepending the given node to this fragment. */
  addToStart<N2 extends NodeNames<Sc>>(node: Node<Sc, N2>): Fragment<Sc, N | N2> {
    const added: Array<Node<Sc, N | N2>> = [node]
    return new Fragment<Sc, N | N2>(added.concat(this.content), this.size + node.nodeSize)
  }

  /** Create a new fragment by appending the given node to this fragment. */
  addToEnd<N2 extends NodeNames<Sc>>(node: Node<Sc, N2>): Fragment<Sc, N | N2> {
    const content: ReadonlyArray<Node<Sc, N | N2>> = this.content
    return new Fragment<Sc, N | N2>(content.concat(node), this.size + node.nodeSize)
  }

  /** Compare this fragment to another one. */
  eq(other: Fragment<any, any>): boolean {
    if (this.content.length !== other.content.length) return false
    return this.content.every((child, i) => child.eq(other.content[i]))
  }

  /** @internal */
  [Equal.symbol](that: Equal.Equal): boolean {
    return that instanceof Fragment && this.eq(that)
  }

  /** @internal */
  [Hash.symbol](): number {
    return Hash.array(this.content)
  }

  /** The first child of the fragment, if any. */
  get firstChild(): Option.Option<Node<Sc, N>> {
    return Option.fromUndefinedOr(this.content[0])
  }

  /** The last child of the fragment, if any. */
  get lastChild(): Option.Option<Node<Sc, N>> {
    return Option.fromUndefinedOr(this.content[this.content.length - 1])
  }

  /** The number of child nodes in this fragment. */
  get childCount(): number {
    return this.content.length
  }

  /** Get the child node at the given index. Fails with a `PositionError` when the index is out of range. */
  child(index: number): Effect.Effect<Node<Sc, N>, PositionError> {
    return attempt(() => this.childUnsafe(index), isPositionError)
  }

  /** Like `child`, but throws a `PositionError` when the index is out of range. */
  childUnsafe(index: number): Node<Sc, N> {
    const found = this.content[index]
    if (!found) throw new PositionError({ message: "Index " + index + " out of range for " + this })
    return found
  }

  /** Get the child node at the given index, if it exists. */
  maybeChild(index: number): Option.Option<Node<Sc, N>> {
    return Option.fromUndefinedOr(this.content[index])
  }

  /** Call `f` for every child node, passing the node, its offset into this parent node, and its index. */
  forEach(f: (node: Node<Sc, N>, offset: number, index: number) => void): void {
    // The child iteration every traversal goes through stays a plain loop.
    // oxlint-disable-next-line effect/imperative-loops
    for (let i = 0, p = 0; i < this.content.length; i++) {
      const child = this.content[i]
      f(child, p, i)
      p += child.nodeSize
    }
  }

  /** Find the first position at which this fragment and another fragment differ, if any. */
  findDiffStart(other: Fragment<any, any>, pos = 0): Option.Option<number> {
    return Option.fromNullishOr(findDiffStart(this, other, pos))
  }

  /**
   * Find the first position, searching from the end, at which this
   * fragment and the given fragment differ, if any. Since this
   * position will not be the same in both nodes, an object with two
   * separate positions is returned.
   */
  findDiffEnd(
    other: Fragment<any, any>,
    pos = this.size,
    otherPos = other.size
  ): Option.Option<{ readonly a: number; readonly b: number }> {
    return Option.fromNullishOr(findDiffEnd(this, other, pos, otherPos))
  }

  /**
   * Find the index and inner offset corresponding to a given relative
   * position in this fragment. The result object will be reused
   * (overwritten) the next time the function is called.
   *
   * @internal
   */
  findIndex(pos: number): { index: number; offset: number } {
    if (pos === 0) return retIndex(0, pos)
    if (pos === this.size) return retIndex(this.content.length, pos)
    if (pos > this.size || pos < 0) {
      throw new PositionError({ message: `Position ${pos} outside of fragment (${this.toString()})` })
    }
    // Runs for every level of every position resolved, so it stays a plain loop.
    // oxlint-disable-next-line effect/imperative-loops
    for (let i = 0, curPos = 0; ; i++) {
      const cur = this.content[i],
        end = curPos + cur.nodeSize
      if (end >= pos) {
        if (end === pos) return retIndex(i + 1, end)
        return retIndex(i, curPos)
      }
      curPos = end
    }
  }

  /** Return a debugging string that describes this fragment. */
  toString(): string {
    return "<" + this.toStringInner() + ">"
  }

  /** @internal */
  toStringInner(): string {
    return this.content.join(", ")
  }

  /** Create a JSON-serializable representation of this fragment. */
  toJSON(): ReadonlyArray<NodeJSON> | null {
    return this.content.length ? this.content.map((n) => n.toJSON()) : null
  }

  /**
   * Build a fragment from an array of nodes. Ensures that adjacent text
   * nodes with the same marks are joined together.
   */
  static fromArray<Sc extends AnySchema, N extends NodeNames<Sc>>(array: ReadonlyArray<Node<Sc, N>>): Fragment<Sc, N> {
    if (!array.length) return Fragment.empty
    let joined: Array<Node<Sc, N>> | undefined
    let size = 0
    // Builds every fragment made from an array, so it stays a plain loop.
    // oxlint-disable-next-line effect/imperative-loops
    for (let i = 0; i < array.length; i++) {
      const node = array[i]
      size += node.nodeSize
      if (i && node.isTextNode() && array[i - 1].sameMarkup(node)) {
        if (!joined) joined = array.slice(0, i)
        const joinedText: Node<Sc> = node.withText(joined[joined.length - 1].textContent + node.textContent)
        // SAFETY: the joined node keeps `node`'s type, one of `N`.
        joined[joined.length - 1] = joinedText as Node<Sc, N>
      } else if (joined) {
        joined.push(node)
      }
    }
    return new Fragment(joined || array, size)
  }

  /**
   * Create a fragment from something that can be interpreted as a set
   * of nodes. For `null`/`undefined`, it returns the empty fragment.
   * For a fragment, the fragment itself. For a node or array of nodes,
   * a fragment containing those nodes.
   */
  static from<Sc extends AnySchema, N extends NodeNames<Sc>>(
    nodes?: Fragment<Sc, N> | Node<Sc, N> | ReadonlyArray<Node<Sc, N>> | null
  ): Fragment<Sc, N> {
    if (!nodes) return Fragment.empty
    if (nodes instanceof Fragment) return nodes
    if (Array.isArray(nodes)) return this.fromArray(nodes)
    // SAFETY: not empty, a fragment or an array, so a node; `attrs` checks it at runtime.
    const node = nodes as Node<Sc, N>
    if (node.attrs) return new Fragment([node], node.nodeSize)
    throw new PositionError({ message: "Can not convert " + nodes + " to a Fragment" })
  }

  /**
   * An empty fragment. Intended to be reused whenever a node doesn't
   * contain anything (rather than allocating a new empty fragment for
   * each leaf node).
   */
  static readonly empty: Fragment<any, any> = new Fragment([], 0)
}

const found = { index: 0, offset: 0 }
function retIndex(index: number, offset: number) {
  found.index = index
  found.offset = offset
  return found
}
