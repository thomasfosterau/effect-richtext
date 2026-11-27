// Ported from prosemirror-view (MIT, Marijn Haverbeke and others)
/**
 * Decorations: widgets, inline and node decorations, and decoration sets.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array"
import type * as Order from "effect/Order"
import * as Rec from "effect/Record"
import type { Fragment, Mark, Node } from "../Model.ts"
import type { EditorState } from "../State.ts"
import type { Mappable, Mapping } from "../Transform.ts"
import type { DOMNode } from "./dom.ts"
import type { EditorView } from "./view.ts"

function compareObjs(a: Readonly<Record<string, unknown>>, b: Readonly<Record<string, unknown>>) {
  if (a == b) return true
  return Rec.keys(a).every((p) => a[p] === b[p]) && Rec.keys(b).every((p) => p in a)
}

// Calls `f` with the start index of each `[from, to, set]` triple in a
// decoration set's `children`.
// A plain loop, stepping by three: a callback over every entry made the
// mapped-decorations benchmark slower.
function forEachChild(children: ReadonlyArray<number | DecorationSet>, f: (i: number) => void): void {
  // oxlint-disable-next-line effect/imperative-loops
  for (let i = 0; i < children.length; i += 3) f(i)
}

// Walks a fragment's children in increasing offset order, so validating
// sorted node decorations costs linear rather than quadratic time
// (prosemirror-view 1.42.7).
class FragmentCursor {
  index = 0
  off = 0
  constructor(readonly frag: Fragment<any, any>) {}

  // Whether a non-text child spans exactly `from`..`to`. Calls must come
  // in increasing `from` order.
  spansNode(from: number, to: number): boolean {
    const children = this.frag.content
    // A plain loop: the cursor carries on from where the last call left off.
    // oxlint-disable-next-line effect/imperative-loops
    while (this.off <= from && this.index < children.length) {
      const next = children[this.index]
      if (!next) break
      if (this.off == from) return !next.isText && from + next.nodeSize == to
      this.off += next.nodeSize
      this.index++
    }
    return false
  }
}

/** @internal */
export interface DecorationType {
  spec: any
  map(mapping: Mappable, span: Decoration, offset: number, oldOffset: number): Decoration | null
  valid(node: Node<any, any>, span: Decoration, cursor: FragmentCursor): boolean
  eq(other: DecorationType): boolean
  destroy(dom: DOMNode): void
}

/**
 * The DOM content of a widget decoration: either a DOM node, or a
 * function that renders it (lazily, when the widget is drawn). The
 * `getPos` argument can be used to find the widget's current document
 * position (it returns `undefined` when the widget is not in the
 * document).
 *
 * @since 0.1.0
 * @category models
 */
export type WidgetConstructor =
  | ((view: EditorView<any, any, any>, getPos: () => number | undefined) => DOMNode)
  | DOMNode

/** @internal */
export class WidgetType implements DecorationType {
  spec: any
  side: number

  constructor(
    readonly toDOM: WidgetConstructor,
    spec: any
  ) {
    this.spec = spec || noSpec
    this.side = this.spec.side || 0
  }

  map(mapping: Mappable, span: Decoration, offset: number, oldOffset: number): Decoration | null {
    const { deleted, pos } = mapping.mapResult(span.from + oldOffset, this.side < 0 ? -1 : 1)
    return deleted ? null : new Decoration(pos - offset, pos - offset, this)
  }

  valid() {
    return true
  }

  eq(other: WidgetType): boolean {
    return (
      this == other ||
      (other instanceof WidgetType &&
        ((this.spec.key && this.spec.key == other.spec.key) ||
          (this.toDOM == other.toDOM && compareObjs(this.spec, other.spec))))
    )
  }

  destroy(node: DOMNode) {
    if (this.spec.destroy) this.spec.destroy(node)
  }
}

/** @internal */
export class InlineType implements DecorationType {
  spec: any

  constructor(
    readonly attrs: DecorationAttrs,
    spec: any
  ) {
    this.spec = spec || noSpec
  }

  map(mapping: Mappable, span: Decoration, offset: number, oldOffset: number): Decoration | null {
    const from = mapping.map(span.from + oldOffset, this.spec.inclusiveStart ? -1 : 1) - offset
    const to = mapping.map(span.to + oldOffset, this.spec.inclusiveEnd ? 1 : -1) - offset
    return from >= to ? null : new Decoration(from, to, this)
  }

  valid(_: Node<any, any>, span: Decoration) {
    return span.from < span.to
  }

  eq(other: DecorationType): boolean {
    return (
      this == other ||
      (other instanceof InlineType && compareObjs(this.attrs, other.attrs) && compareObjs(this.spec, other.spec))
    )
  }

  static is(this: void, span: Decoration) {
    return span.type instanceof InlineType
  }

  destroy() {}
}

/** @internal */
export class NodeType implements DecorationType {
  spec: any
  constructor(
    readonly attrs: DecorationAttrs,
    spec: any
  ) {
    this.spec = spec || noSpec
  }

  map(mapping: Mappable, span: Decoration, offset: number, oldOffset: number): Decoration | null {
    const from = mapping.mapResult(span.from + oldOffset, 1)
    if (from.deleted) return null
    const to = mapping.mapResult(span.to + oldOffset, -1)
    if (to.deleted || to.pos <= from.pos) return null
    return new Decoration(from.pos - offset, to.pos - offset, this)
  }

  valid(_node: Node<any, any>, span: Decoration, cursor: FragmentCursor): boolean {
    return cursor.spansNode(span.from, span.to)
  }

  eq(other: DecorationType): boolean {
    return (
      this == other ||
      (other instanceof NodeType && compareObjs(this.attrs, other.attrs) && compareObjs(this.spec, other.spec))
    )
  }

  destroy() {}
}

/**
 * The spec of a widget decoration (see `Decoration.widget`).
 *
 * @since 0.1.0
 * @category models
 */
export interface WidgetDecorationSpec {
  /**
   * Controls which side of the document position this widget is
   * associated with. When negative, it is drawn before a cursor at its
   * position, and content inserted at that position ends up after the
   * widget. When zero (the default) or positive, the widget is drawn
   * after the cursor and content inserted there ends up before the
   * widget.
   *
   * When there are multiple widgets at a given position, their `side`
   * values determine the order in which they appear. Those with lower
   * values appear first. The ordering of widgets with the same `side`
   * value is unspecified.
   *
   * When `marks` is null, `side` also determines the marks that the
   * widget is wrapped in—those of the node before when negative, those
   * of the node after when positive.
   */
  readonly side?: number | undefined

  /**
   * By default, the cursor, when at the position of the widget, will be
   * strictly kept on the side indicated by `side`. Set this to true to
   * allow the DOM selection to stay on the other side if the client
   * sets it there.
   */
  readonly relaxedSide?: boolean | undefined

  /** The precise set of marks to draw around the widget. */
  readonly marks?: ReadonlyArray<Mark<any, any>> | undefined

  /**
   * Can be used to control which DOM events, when they bubble out of
   * this widget, the editor view should ignore.
   */
  readonly stopEvent?: ((event: Event) => boolean) | undefined

  /**
   * When set (defaults to false), selection changes inside the widget
   * are ignored, and don't cause the view to try and re-sync the
   * selection with its selection state.
   */
  readonly ignoreSelection?: boolean | undefined

  /**
   * When comparing decorations of this type (in order to decide whether
   * it needs to be redrawn), the view will by default compare the widget
   * DOM node by identity. If you pass a key, that key will be compared
   * instead, which can be useful when you generate decorations on the
   * fly and don't want to store and reuse DOM nodes. Make sure that any
   * widgets with the same key are interchangeable.
   */
  readonly key?: string | undefined

  /** Called when the widget decoration is removed or the editor is destroyed. */
  readonly destroy?: ((node: DOMNode) => void) | undefined

  /** Specs allow arbitrary additional properties. */
  readonly [key: string]: any
}

/**
 * The spec of an inline decoration (see `Decoration.inline`).
 *
 * @since 0.1.0
 * @category models
 */
export interface InlineDecorationSpec {
  /**
   * Determines how the left side of the decoration is mapped when
   * content is inserted directly at that position. By default, the
   * decoration won't include the new content, but you can set this to
   * `true` to make it inclusive.
   */
  readonly inclusiveStart?: boolean | undefined

  /** Determines how the right side of the decoration is mapped. */
  readonly inclusiveEnd?: boolean | undefined

  /** Specs may have arbitrary additional properties. */
  readonly [key: string]: any
}

/**
 * Decoration objects can be provided to the view through the
 * `decorations` prop. They come in several variants—see the static
 * members of this class for details.
 *
 * @since 0.1.0
 * @category models
 */
export class Decoration {
  /** @internal */
  constructor(
    /** The start position of the decoration. */
    readonly from: number,
    /** The end position. Will be the same as `from` for widget decorations. */
    readonly to: number,
    /** @internal */
    readonly type: DecorationType
  ) {}

  /** @internal */
  copy(from: number, to: number): Decoration {
    return new Decoration(from, to, this.type)
  }

  /** @internal */
  eq(other: Decoration, offset = 0): boolean {
    return this.type.eq(other.type) && this.from + offset == other.from && this.to + offset == other.to
  }

  /** @internal */
  map(mapping: Mappable, offset: number, oldOffset: number): Decoration | null {
    return this.type.map(mapping, this, offset, oldOffset)
  }

  /**
   * Creates a widget decoration, which is a DOM node that's shown in
   * the document at the given position. It is recommended that you
   * delay rendering the widget by passing a function that will be
   * called when the widget is actually drawn in a view, but you can
   * also directly pass a DOM node. `getPos` can be used to find the
   * widget's current document position.
   */
  static widget(pos: number, toDOM: WidgetConstructor, spec?: WidgetDecorationSpec): Decoration {
    return new Decoration(pos, pos, new WidgetType(toDOM, spec))
  }

  /**
   * Creates an inline decoration, which adds the given attributes to
   * each inline node between `from` and `to`.
   */
  static inline(from: number, to: number, attrs: DecorationAttrs, spec?: InlineDecorationSpec): Decoration {
    return new Decoration(from, to, new InlineType(attrs, spec))
  }

  /**
   * Creates a node decoration. `from` and `to` should point precisely
   * before and after a node in the document. That node, and only that
   * node, will receive the given attributes.
   */
  static node(from: number, to: number, attrs: DecorationAttrs, spec?: any): Decoration {
    return new Decoration(from, to, new NodeType(attrs, spec))
  }

  /**
   * The spec provided when creating this decoration. Can be useful if
   * you've stored extra information in that object.
   */
  get spec(): any {
    return this.type.spec
  }

  /** @internal */
  get inline(): boolean {
    return this.type instanceof InlineType
  }

  /** @internal */
  get widget(): boolean {
    return this.type instanceof WidgetType
  }
}

/**
 * A set of attributes to add to a decorated node. Most properties
 * simply directly correspond to DOM attributes of the same name, which
 * will be set to the property's value. These are exceptions:
 *
 * - `nodeName`: when non-null, the target node is wrapped in a DOM
 *   element of this type (and the other attributes are applied to this
 *   element).
 * - `class`: a CSS class name or a space-separated set of class names
 *   to be _added_ to the classes that the node already had.
 * - `style`: a string of CSS to be _added_ to the node's existing
 *   `style` property.
 *
 * @since 0.1.0
 * @category models
 */
export type DecorationAttrs = {
  readonly nodeName?: string | undefined
  readonly class?: string | undefined
  readonly style?: string | undefined
  readonly [attribute: string]: string | undefined
}

const none: ReadonlyArray<any> = [],
  noSpec = {}

/**
 * An object that can provide decorations. Implemented by
 * `DecorationSet`, and passed to node views.
 *
 * @since 0.1.0
 * @category models
 */
export interface DecorationSource {
  /** Map the set of decorations in response to a change in the document. */
  readonly map: (mapping: Mapping, node: Node<any, any>) => DecorationSource
  /** @internal */
  locals(node: Node<any, any>): ReadonlyArray<Decoration>
  /** Extract a DecorationSource containing decorations for the given child node at the given offset. */
  forChild(offset: number, child: Node<any, any>): DecorationSource
  /** @internal */
  eq(other: DecorationSource): boolean
  /** Call the given function for each decoration set in the group. */
  forEachSet(f: (set: DecorationSet) => void): void
}

/**
 * Options for `DecorationSet.map`.
 *
 * @since 0.1.0
 * @category models
 */
export interface DecorationMapOptions {
  /**
   * When given, this function will be called for each decoration that
   * gets dropped as a result of the mapping, passing the spec of that
   * decoration.
   */
  readonly onRemove?: ((decorationSpec: any) => void) | undefined
}

/**
 * A collection of decorations, organized in such a way that the
 * drawing algorithm can efficiently use and compare them. This is a
 * persistent data structure—it is not modified, updates create a new
 * value.
 *
 * @since 0.1.0
 * @category models
 */
export class DecorationSet implements DecorationSource {
  /** @internal */
  local: ReadonlyArray<Decoration>
  /** @internal */
  children: ReadonlyArray<number | DecorationSet>

  /** @internal */
  constructor(local: ReadonlyArray<Decoration>, children: ReadonlyArray<number | DecorationSet>) {
    this.local = local.length ? local : none
    this.children = children.length ? children : none
  }

  /**
   * Create a set of decorations, using the structure of the given
   * document. This will consume (modify) the `decorations` array, so you
   * must make a copy if you want need to preserve that.
   */
  static create(doc: Node<any, any>, decorations: Array<Decoration>): DecorationSet {
    return decorations.length ? buildTree(decorations, doc, 0, noSpec) : empty
  }

  /**
   * Find all decorations in this set which touch the given range
   * (including decorations that start or end directly at the
   * boundaries) and match the given predicate on their spec. When
   * `start` and `end` are omitted, all decorations in the set are
   * considered. When `predicate` isn't given, all decorations are
   * assumed to match.
   */
  find(start?: number, end?: number, predicate?: (spec: any) => boolean): Array<Decoration> {
    const result: Array<Decoration> = []
    this.findInner(start == null ? 0 : start, end == null ? 1e9 : end, result, 0, predicate)
    return result
  }

  private findInner(
    start: number,
    end: number,
    result: Array<Decoration>,
    offset: number,
    predicate?: (spec: any) => boolean
  ) {
    this.local.forEach((span) => {
      if (span.from <= end && span.to >= start && (!predicate || predicate(span.spec))) {
        result.push(span.copy(span.from + offset, span.to + offset))
      }
    })
    forEachChild(this.children, (i) => {
      if (posAt(this.children, i) < end && posAt(this.children, i + 1) > start) {
        const childOff = posAt(this.children, i) + 1
        setAt(this.children, i + 2).findInner(start - childOff, end - childOff, result, offset + childOff, predicate)
      }
    })
  }

  /** Map the set of decorations in response to a change in the document. */
  map(mapping: Mapping, doc: Node<any, any>, options?: DecorationMapOptions): DecorationSet {
    if (this == empty || Arr.isReadonlyArrayEmpty(mapping.maps)) return this
    return this.mapInner(mapping, doc, 0, 0, options || noSpec)
  }

  /** @internal */
  mapInner(
    mapping: Mapping,
    node: Node<any, any>,
    offset: number,
    oldOffset: number,
    options: DecorationMapOptions
  ): DecorationSet {
    let newLocal: Array<Decoration> | undefined
    if (this.local.length) {
      const cur = new FragmentCursor(node.content)
      this.local.forEach((deco) => {
        const mapped = deco.map(mapping, offset, oldOffset)
        if (mapped && mapped.type.valid(node, mapped, cur)) (newLocal || (newLocal = [])).push(mapped)
        else if (options.onRemove) options.onRemove(deco.spec)
      })
    }

    if (this.children.length) {
      return mapChildren(this.children, newLocal || [], mapping, node, offset, oldOffset, options)
    } else {
      return newLocal ? new DecorationSet(Arr.sort(newLocal, byPos), none) : empty
    }
  }

  /**
   * Add the given array of decorations to the ones in the set, producing
   * a new set. Consumes the `decorations` array. Needs access to the
   * current document to create the appropriate tree structure.
   */
  add(doc: Node<any, any>, decorations: Array<Decoration>): DecorationSet {
    if (!decorations.length) return this
    if (this == empty) return DecorationSet.create(doc, decorations)
    return this.addInner(doc, decorations, 0)
  }

  private addInner(doc: Node<any, any>, decorations: Array<Decoration | null>, offset: number): DecorationSet {
    let children: Array<number | DecorationSet> | undefined,
      childIndex = 0
    doc.forEach((childNode, childOffset) => {
      const baseOffset = childOffset + offset
      let found
      if (!(found = takeSpansForNode(decorations, childNode, baseOffset))) return

      if (!children) children = this.children.slice()
      // A plain loop: the index carries on across the document's children.
      // oxlint-disable-next-line effect/imperative-loops
      while (childIndex < children.length && posAt(children, childIndex) < childOffset) childIndex += 3
      if (children[childIndex] == childOffset) {
        children[childIndex + 2] = setAt(children, childIndex + 2).addInner(childNode, found, baseOffset + 1)
      } else {
        children.splice(
          childIndex,
          0,
          childOffset,
          childOffset + childNode.nodeSize,
          buildTree(found, childNode, baseOffset + 1, noSpec)
        )
      }
      childIndex += 3
    })

    // SAFETY: with `childIndex` 0 no child took spans, so `decorations` holds no nulls.
    const moved = moveSpans(childIndex ? withoutNulls(decorations) : (decorations as Array<Decoration>), -offset)
    const cur = new FragmentCursor(doc.content)
    const local = moved.filter((deco) => deco.type.valid(doc, deco, cur))

    return new DecorationSet(
      local.length ? Arr.sort(this.local.concat(local), byPos) : this.local,
      children || this.children
    )
  }

  /**
   * Create a new set that contains the decorations in this set, minus
   * the ones in the given array.
   */
  remove(decorations: Array<Decoration>): DecorationSet {
    if (Arr.isReadonlyArrayEmpty(decorations) || this == empty) return this
    return this.removeInner(decorations, 0)
  }

  private removeInner(decorations: Array<Decoration | null>, offset: number): DecorationSet {
    let changedChildren = false
    const mappedChildren = Arr.chunksOf(this.children, 3).flatMap((triple): Array<number | DecorationSet> => {
      const from = posAt(triple, 0) + offset,
        to = posAt(triple, 1) + offset
      // Take the decorations that fall inside this child.
      const found: Array<Decoration> = []
      decorations.forEach((span, j) => {
        if (span && span.from > from && span.to < to) {
          decorations[j] = null
          found.push(span)
        }
      })
      if (Arr.isArrayEmpty(found)) return triple
      changedChildren = true
      const removed = setAt(triple, 2).removeInner(found, from + 1)
      return removed != empty ? [triple[0], triple[1], removed] : []
    })
    const children = changedChildren ? mappedChildren : this.children
    const kept = this.local.filter((deco) => !decorations.some((span) => span !== null && deco.eq(span, offset)))
    const local = kept.length === this.local.length ? this.local : kept
    if (children == this.children && local == this.local) return this
    return local.length || children.length ? new DecorationSet(local, children) : empty
  }

  forChild(offset: number, node: Node<any, any>): DecorationSource {
    if (this == empty) return this
    if (node.isLeaf) return DecorationSet.empty

    let local: Array<Decoration> | undefined
    const at = this.children.findIndex((_, i) => i % 3 === 0 && posAt(this.children, i) >= offset)
    const child = at >= 0 && this.children[at] == offset ? setAt(this.children, at + 2) : undefined
    const start = offset + 1,
      end = start + node.content.size
    this.local.forEach((dec) => {
      if (dec.from < end && dec.to > start && dec.type instanceof InlineType) {
        const from = Math.max(start, dec.from) - start,
          to = Math.min(end, dec.to) - start
        if (from < to) (local || (local = [])).push(dec.copy(from, to))
      }
    })
    if (local) {
      const localSet = new DecorationSet(Arr.sort(local, byPos), none)
      return child ? new DecorationGroup([localSet, child]) : localSet
    }
    return child || empty
  }

  /** @internal */
  eq(other: DecorationSource): boolean {
    if (this == other) return true
    if (
      !(other instanceof DecorationSet) ||
      this.local.length != other.local.length ||
      this.children.length != other.children.length
    )
      return false
    return (
      this.local.every((deco, i) => deco.eq(other.local[i])) &&
      this.children.every((entry, i) =>
        i % 3 === 2 ? setAt(this.children, i).eq(setAt(other.children, i)) : entry == other.children[i]
      )
    )
  }

  /** @internal */
  locals(node: Node<any, any>): ReadonlyArray<Decoration> {
    return removeOverlap(this.localsInner(node))
  }

  /** @internal */
  localsInner(node: Node<any, any>): ReadonlyArray<Decoration> {
    if (this == empty) return none
    if (node.inlineContent || !this.local.some(InlineType.is)) return this.local
    return this.local.filter((deco) => !(deco.type instanceof InlineType))
  }

  /** The empty set of decorations. */
  static empty: DecorationSet = new DecorationSet([], [])

  /** @internal */
  static removeOverlap = removeOverlap

  forEachSet(f: (set: DecorationSet) => void): void {
    f(this)
  }
}

const empty = DecorationSet.empty

// An abstraction that allows the code dealing with decorations to
// treat multiple DecorationSet objects as if it were a single object
// with (a subset of) the same interface.
/** @internal */
export class DecorationGroup implements DecorationSource {
  constructor(readonly members: ReadonlyArray<DecorationSet>) {}

  map(mapping: Mapping, doc: Node<any, any>): DecorationSource {
    const mappedDecos = this.members.map((member) => member.map(mapping, doc, noSpec))
    return DecorationGroup.from(mappedDecos)
  }

  forChild(offset: number, child: Node<any, any>): DecorationSource {
    if (child.isLeaf) return DecorationSet.empty
    const found = this.members.flatMap((member): ReadonlyArray<DecorationSet> => {
      const result = member.forChild(offset, child)
      if (result == empty) return []
      if (result instanceof DecorationGroup) return result.members
      return result instanceof DecorationSet ? [result] : []
    })
    return DecorationGroup.from(found)
  }

  eq(other: DecorationSource): boolean {
    if (!(other instanceof DecorationGroup) || other.members.length != this.members.length) return false
    return this.members.every((member, i) => member.eq(other.members[i]))
  }

  locals(node: Node<any, any>): ReadonlyArray<Decoration> {
    let result: ReadonlyArray<Decoration> | undefined,
      sorted = true
    this.members.forEach((member) => {
      const locals = member.localsInner(node)
      if (!locals.length) return
      if (!result) {
        result = locals
      } else {
        result = result.concat(locals)
        sorted = false
      }
    })
    return result ? removeOverlap(sorted ? result : Arr.sort(result, byPos)) : none
  }

  // Create a group for the given array of decoration sets, or return
  // a single set when possible.
  static from(members: ReadonlyArray<DecorationSource>): DecorationSource {
    if (Arr.isReadonlyArrayEmpty(members)) return empty
    if (members.length == 1) return members[0]
    return new DecorationGroup(
      members.every((m) => m instanceof DecorationSet)
        ? members
        : members.reduce<Array<DecorationSet>>(
            (r, m) => r.concat(m instanceof DecorationGroup ? m.members : m instanceof DecorationSet ? [m] : []),
            []
          )
    )
  }

  forEachSet(f: (set: DecorationSet) => void): void {
    this.members.forEach((member) => member.forEachSet(f))
  }
}

// A decoration set's `children` holds `[from, to, set]` triples.
function posAt(children: ReadonlyArray<number | DecorationSet>, i: number): number {
  // SAFETY: `i` is the first or second index of a triple, which holds a position.
  return children[i] as number
}

function setAt(children: ReadonlyArray<number | DecorationSet>, i: number): DecorationSet {
  // SAFETY: `i` is the third index of a triple, which holds a child set.
  return children[i] as DecorationSet
}

function mapChildren(
  oldChildren: ReadonlyArray<number | DecorationSet>,
  newLocal: Array<Decoration>,
  mapping: Mapping,
  node: Node<any, any>,
  offset: number,
  oldOffset: number,
  options: DecorationMapOptions
) {
  const children = oldChildren.slice()

  // Mark the children that are directly touched by changes, and
  // move those that are after the changes.
  let baseOffset = oldOffset
  mapping.maps.forEach((map) => {
    const base = baseOffset
    let moved = 0
    map.forEach((oldStart: number, oldEnd: number, newStart: number, newEnd: number) => {
      const dSize = newEnd - newStart - (oldEnd - oldStart)
      // A plain loop: it runs over every child for every change, and a
      // callback made the mapped-decorations benchmark a tenth slower.
      // oxlint-disable-next-line effect/imperative-loops
      for (let j = 0; j < children.length; j += 3) {
        const end = posAt(children, j + 1)
        if (end < 0 || oldStart > end + base - moved) continue
        const start = posAt(children, j) + base - moved
        if (oldEnd >= start) {
          children[j + 1] = oldStart <= start ? -2 : -1
        } else if (oldStart >= base && dSize) {
          children[j] = posAt(children, j) + dSize
          children[j + 1] = end + dSize
        }
      }
      moved += dSize
    })
    baseOffset = map.map(baseOffset, -1)
  })

  // Find the child nodes that still correspond to a single node,
  // recursively call mapInner on them and update their positions.
  let mustRebuild = false
  forEachChild(children, (i) => {
    if (posAt(children, i + 1) < 0) {
      // Touched nodes
      if (children[i + 1] == -2) {
        mustRebuild = true
        children[i + 1] = -1
        return
      }
      const from = mapping.map(posAt(oldChildren, i) + oldOffset),
        fromLocal = from - offset
      if (fromLocal < 0 || fromLocal >= node.content.size) {
        mustRebuild = true
        return
      }
      // Must read oldChildren because children was tagged with -1
      const to = mapping.map(posAt(oldChildren, i + 1) + oldOffset, -1),
        toLocal = to - offset
      const { index, offset: childOffset } = node.content.findIndex(fromLocal)
      const childNode = node.content.content[index]
      if (childNode && childOffset == fromLocal && childOffset + childNode.nodeSize == toLocal) {
        const mapped = setAt(children, i + 2).mapInner(
          mapping,
          childNode,
          from + 1,
          posAt(oldChildren, i) + oldOffset + 1,
          options
        )
        if (mapped != empty) {
          children[i] = fromLocal
          children[i + 1] = toLocal
          children[i + 2] = mapped
        } else {
          children[i + 1] = -2
          mustRebuild = true
        }
      } else {
        mustRebuild = true
      }
    }
  })

  // Remaining children must be collected and rebuilt into the appropriate structure
  if (mustRebuild) {
    const decorations = mapAndGatherRemainingDecorations(
      children,
      oldChildren,
      newLocal,
      mapping,
      offset,
      oldOffset,
      options
    )
    const built = buildTree(decorations, node, 0, options)
    // SAFETY: `newLocal` is only sorted (into a new array) from here on.
    newLocal = built.local as Array<Decoration>
    // Drop the touched children, then merge in the rebuilt ones by position.
    const kept = Arr.chunksOf(children, 3).filter((triple) => posAt(triple, 1) >= 0)
    Arr.chunksOf(built.children, 3).forEach((triple) => {
      const at = kept.findIndex((other) => posAt(other, 0) >= posAt(triple, 0))
      kept.splice(at < 0 ? kept.length : at, 0, triple)
    })
    return new DecorationSet(Arr.sort(newLocal, byPos), kept.flat())
  }

  return new DecorationSet(Arr.sort(newLocal, byPos), children)
}

function moveSpans(spans: Array<Decoration>, offset: number) {
  if (!offset || !spans.length) return spans
  return spans.map((span) => new Decoration(span.from + offset, span.to + offset, span.type))
}

function mapAndGatherRemainingDecorations(
  children: Array<number | DecorationSet>,
  oldChildren: ReadonlyArray<number | DecorationSet>,
  decorations: Array<Decoration>,
  mapping: Mapping,
  offset: number,
  oldOffset: number,
  options: DecorationMapOptions
) {
  // Gather all decorations from the remaining marked children
  function gather(set: DecorationSet, base: number) {
    set.local.forEach((deco) => {
      const mapped = deco.map(mapping, offset, base)
      if (mapped) decorations.push(mapped)
      else if (options.onRemove) options.onRemove(deco.spec)
    })
    forEachChild(set.children, (i) => gather(setAt(set.children, i + 2), posAt(set.children, i) + base + 1))
  }
  forEachChild(children, (i) => {
    if (children[i + 1] == -1) gather(setAt(children, i + 2), posAt(oldChildren, i) + oldOffset + 1)
  })

  return decorations
}

function takeSpansForNode(
  spans: Array<Decoration | null>,
  node: Node<any, any>,
  offset: number
): Array<Decoration> | null {
  if (node.isLeaf) return null
  const end = offset + node.nodeSize
  let found: Array<Decoration> | null = null
  // A plain loop: building a set runs it over every span for every node,
  // and a callback made the live-search benchmark a tenth slower.
  // oxlint-disable-next-line effect/imperative-loops
  for (let i = 0, span; i < spans.length; i++) {
    if ((span = spans[i]) && span.from > offset && span.to < end) {
      ;(found || (found = [])).push(span)
      spans[i] = null
    }
  }
  return found
}

function withoutNulls<T>(array: ReadonlyArray<T | null>): Array<T> {
  return array.filter((item): item is T => item != null)
}

// Build up a tree that corresponds to a set of decorations. `offset`
// is a base offset that should be subtracted from the `from` and `to`
// positions in the spans (so that we don't have to allocate new spans
// for recursive calls).
function buildTree(
  spans: Array<Decoration | null>,
  node: Node<any, any>,
  offset: number,
  options: DecorationMapOptions
): DecorationSet {
  const children: Array<DecorationSet | number> = []
  let hasNulls = false
  node.forEach((childNode, localStart) => {
    const found = takeSpansForNode(spans, childNode, localStart + offset)
    if (found) {
      hasNulls = true
      const subtree = buildTree(found, childNode, offset + localStart + 1, options)
      if (subtree != empty) {
        children.push(localStart, localStart + childNode.nodeSize, subtree)
      }
    }
  })
  // SAFETY: without `hasNulls` no child took spans, so `spans` holds no nulls.
  const sorted = Arr.sort(moveSpans(hasNulls ? withoutNulls(spans) : (spans as Array<Decoration>), -offset), byPos)
  const cur = new FragmentCursor(node.content)
  const locals = sorted.filter((deco) => {
    if (deco.type.valid(node, deco, cur)) return true
    if (options.onRemove) options.onRemove(deco.spec)
    return false
  })
  return locals.length || children.length ? new DecorationSet(locals, children) : empty
}

// Used to sort decorations so that ones with a low start position
// come first, and within a set with the same start position, those
// with an smaller end position come first.
// Same ordering as `a.from - b.from || a.to - b.to`.
const byPos: Order.Order<Decoration> = (a, b) =>
  a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : a.to > b.to ? 1 : 0

// Scan a sorted array of decorations for partially overlapping spans,
// and split those so that only fully overlapping spans are left (to
// make subsequent rendering easier). Will return the input array if
// no partially overlapping spans are found (the common case).
function removeOverlap(spans: ReadonlyArray<Decoration>): Array<Decoration> {
  // SAFETY: copy-on-write: replaced by a `slice()` before it is mutated.
  let working: Array<Decoration> = spans as Array<Decoration>
  // Plain loops: splitting a span inserts into the array being scanned.
  // oxlint-disable-next-line effect/imperative-loops
  for (let i = 0; i < working.length - 1; i++) {
    const span = working[i]
    if (span.from != span.to) {
      // oxlint-disable-next-line effect/imperative-loops
      for (let j = i + 1; j < working.length; j++) {
        const next = working[j]
        if (next.from == span.from) {
          if (next.to != span.to) {
            if (working == spans) working = spans.slice()
            // Followed by a partially overlapping larger span. Split that
            // span.
            working[j] = next.copy(next.from, span.to)
            insertAhead(working, j + 1, next.copy(span.to, next.to))
          }
          continue
        } else {
          if (next.from < span.to) {
            if (working == spans) working = spans.slice()
            // The end of this one overlaps with a subsequent span. Split
            // this one.
            working[i] = span.copy(span.from, next.from)
            insertAhead(working, j, span.copy(next.from, span.to))
          }
          break
        }
      }
    }
  }
  return working
}

function insertAhead(array: Array<Decoration>, i: number, deco: Decoration) {
  const at = array.findIndex((other, k) => k >= i && byPos(deco, other) <= 0)
  array.splice(at < 0 ? array.length : at, 0, deco)
}

/**
 * Get the decorations associated with the current props of a view.
 *
 * @internal
 */
export function viewDecorations(view: EditorView<any, any, any>): DecorationSource {
  const found: Array<DecorationSource> = []
  view.someProp("decorations", (f) => {
    // SAFETY: decoration props only read the state, so its requirement and error types don't matter.
    const result = f(view.state as EditorState<any>)
    if (result && result != empty) found.push(result)
  })
  if (view.cursorWrapper) {
    found.push(DecorationSet.create(view.state.doc, [view.cursorWrapper.deco]))
  }
  return DecorationGroup.from(found)
}
