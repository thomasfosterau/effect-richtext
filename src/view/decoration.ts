// Ported from prosemirror-view (MIT, Marijn Haverbeke and others)
/**
 * Decorations: widgets, inline and node decorations, and decoration sets.
 *
 * @since 0.1.0
 */
import type { Mark, Node } from "../model.ts"
import type { EditorState } from "../state.ts"
import type { Mappable, Mapping } from "../transform.ts"
import type { DOMNode } from "./dom.ts"
import type { EditorView } from "./view.ts"

function compareObjs(a: { [prop: string]: any }, b: { [prop: string]: any }) {
  if (a == b) return true
  for (const p in a) if (a[p] !== b[p]) return false
  for (const p in b) if (!(p in a)) return false
  return true
}

/** @internal */
export interface DecorationType {
  spec: any
  map(mapping: Mappable, span: Decoration, offset: number, oldOffset: number): Decoration | null
  valid(node: Node<any, any>, span: Decoration): boolean
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

  constructor(readonly toDOM: WidgetConstructor, spec: any) {
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
    return this == other ||
      (other instanceof WidgetType &&
        (this.spec.key && this.spec.key == other.spec.key ||
          this.toDOM == other.toDOM && compareObjs(this.spec, other.spec)))
  }

  destroy(node: DOMNode) {
    if (this.spec.destroy) this.spec.destroy(node)
  }
}

/** @internal */
export class InlineType implements DecorationType {
  spec: any

  constructor(readonly attrs: DecorationAttrs, spec: any) {
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
    return this == other ||
      (other instanceof InlineType && compareObjs(this.attrs, other.attrs) &&
        compareObjs(this.spec, other.spec))
  }

  static is(span: Decoration) {
    return span.type instanceof InlineType
  }

  destroy() {}
}

/** @internal */
export class NodeType implements DecorationType {
  spec: any
  constructor(readonly attrs: DecorationAttrs, spec: any) {
    this.spec = spec || noSpec
  }

  map(mapping: Mappable, span: Decoration, offset: number, oldOffset: number): Decoration | null {
    const from = mapping.mapResult(span.from + oldOffset, 1)
    if (from.deleted) return null
    const to = mapping.mapResult(span.to + oldOffset, -1)
    if (to.deleted || to.pos <= from.pos) return null
    return new Decoration(from.pos - offset, to.pos - offset, this)
  }

  valid(node: Node<any, any>, span: Decoration): boolean {
    const { index, offset } = node.content.findIndex(span.from)
    let child: Node<any, any>
    return offset == span.from && !(child = node.content.content[index]!).isText &&
      offset + child.nodeSize == span.to
  }

  eq(other: DecorationType): boolean {
    return this == other ||
      (other instanceof NodeType && compareObjs(this.attrs, other.attrs) &&
        compareObjs(this.spec, other.spec))
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

const none: ReadonlyArray<any> = [], noSpec = {}

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
    for (let i = 0; i < this.local.length; i++) {
      const span = this.local[i]!
      if (span.from <= end && span.to >= start && (!predicate || predicate(span.spec))) {
        result.push(span.copy(span.from + offset, span.to + offset))
      }
    }
    for (let i = 0; i < this.children.length; i += 3) {
      if ((this.children[i] as number) < end && (this.children[i + 1] as number) > start) {
        const childOff = (this.children[i] as number) + 1
        ;(this.children[i + 2] as DecorationSet).findInner(
          start - childOff,
          end - childOff,
          result,
          offset + childOff,
          predicate
        )
      }
    }
  }

  /** Map the set of decorations in response to a change in the document. */
  map(mapping: Mapping, doc: Node<any, any>, options?: DecorationMapOptions): DecorationSet {
    if (this == empty || mapping.maps.length == 0) return this
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
    for (let i = 0; i < this.local.length; i++) {
      const mapped = this.local[i]!.map(mapping, offset, oldOffset)
      if (mapped && mapped.type.valid(node, mapped)) (newLocal || (newLocal = [])).push(mapped)
      else if (options.onRemove) options.onRemove(this.local[i]!.spec)
    }

    if (this.children.length) {
      return mapChildren(this.children, newLocal || [], mapping, node, offset, oldOffset, options)
    } else {
      return newLocal ? new DecorationSet(newLocal.sort(byPos), none) : empty
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
    let children: Array<number | DecorationSet> | undefined, childIndex = 0
    doc.forEach((childNode, childOffset) => {
      const baseOffset = childOffset + offset
      let found
      if (!(found = takeSpansForNode(decorations, childNode, baseOffset))) return

      if (!children) children = this.children.slice()
      while (childIndex < children.length && (children[childIndex] as number) < childOffset) childIndex += 3
      if (children[childIndex] == childOffset) {
        children[childIndex + 2] = (children[childIndex + 2] as DecorationSet).addInner(
          childNode,
          found,
          baseOffset + 1
        )
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

    const local = moveSpans(
      childIndex ? withoutNulls(decorations) : decorations as Array<Decoration>,
      -offset
    )
    for (let i = 0; i < local.length; i++) if (!local[i]!.type.valid(doc, local[i]!)) local.splice(i--, 1)

    return new DecorationSet(
      local.length ? this.local.concat(local).sort(byPos) : this.local,
      children || this.children
    )
  }

  /**
   * Create a new set that contains the decorations in this set, minus
   * the ones in the given array.
   */
  remove(decorations: Array<Decoration>): DecorationSet {
    if (decorations.length == 0 || this == empty) return this
    return this.removeInner(decorations, 0)
  }

  private removeInner(decorations: Array<Decoration | null>, offset: number): DecorationSet {
    let children = this.children as Array<number | DecorationSet>, local = this.local as Array<Decoration>
    for (let i = 0; i < children.length; i += 3) {
      let found: Array<Decoration> | undefined
      const from = (children[i] as number) + offset, to = (children[i + 1] as number) + offset
      for (let j = 0, span; j < decorations.length; j++) {
        if ((span = decorations[j])) {
          if (span.from > from && span.to < to) {
            decorations[j] = null
            ;(found || (found = [])).push(span)
          }
        }
      }
      if (!found) continue
      if (children == this.children) children = this.children.slice()
      const removed = (children[i + 2] as DecorationSet).removeInner(found, from + 1)
      if (removed != empty) {
        children[i + 2] = removed
      } else {
        children.splice(i, 3)
        i -= 3
      }
    }
    if (local.length) {
      for (let i = 0, span; i < decorations.length; i++) {
        if ((span = decorations[i])) {
          for (let j = 0; j < local.length; j++) {
            if (local[j]!.eq(span, offset)) {
              if (local == this.local) local = this.local.slice()
              local.splice(j--, 1)
            }
          }
        }
      }
    }
    if (children == this.children && local == this.local) return this
    return local.length || children.length ? new DecorationSet(local, children) : empty
  }

  forChild(offset: number, node: Node<any, any>): DecorationSource {
    if (this == empty) return this
    if (node.isLeaf) return DecorationSet.empty

    let child: DecorationSet | undefined, local: Array<Decoration> | undefined
    for (let i = 0; i < this.children.length; i += 3) {
      if ((this.children[i] as number) >= offset) {
        if (this.children[i] == offset) child = this.children[i + 2] as DecorationSet
        break
      }
    }
    const start = offset + 1, end = start + node.content.size
    for (let i = 0; i < this.local.length; i++) {
      const dec = this.local[i]!
      if (dec.from < end && dec.to > start && (dec.type instanceof InlineType)) {
        const from = Math.max(start, dec.from) - start, to = Math.min(end, dec.to) - start
        if (from < to) (local || (local = [])).push(dec.copy(from, to))
      }
    }
    if (local) {
      const localSet = new DecorationSet(local.sort(byPos), none)
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
    ) return false
    for (let i = 0; i < this.local.length; i++) {
      if (!this.local[i]!.eq(other.local[i]!)) return false
    }
    for (let i = 0; i < this.children.length; i += 3) {
      if (
        this.children[i] != other.children[i] ||
        this.children[i + 1] != other.children[i + 1] ||
        !(this.children[i + 2] as DecorationSet).eq(other.children[i + 2] as DecorationSet)
      ) return false
    }
    return true
  }

  /** @internal */
  locals(node: Node<any, any>): ReadonlyArray<Decoration> {
    return removeOverlap(this.localsInner(node))
  }

  /** @internal */
  localsInner(node: Node<any, any>): ReadonlyArray<Decoration> {
    if (this == empty) return none
    if (node.inlineContent || !this.local.some(InlineType.is)) return this.local
    const result = []
    for (let i = 0; i < this.local.length; i++) {
      if (!(this.local[i]!.type instanceof InlineType)) {
        result.push(this.local[i]!)
      }
    }
    return result
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
    const mappedDecos = this.members.map(
      (member) => member.map(mapping, doc, noSpec)
    )
    return DecorationGroup.from(mappedDecos)
  }

  forChild(offset: number, child: Node<any, any>): DecorationSource {
    if (child.isLeaf) return DecorationSet.empty
    let found: Array<DecorationSet> = []
    for (let i = 0; i < this.members.length; i++) {
      const result = this.members[i]!.forChild(offset, child)
      if (result == empty) continue
      if (result instanceof DecorationGroup) found = found.concat(result.members)
      else found.push(result as DecorationSet)
    }
    return DecorationGroup.from(found)
  }

  eq(other: DecorationSource): boolean {
    if (
      !(other instanceof DecorationGroup) ||
      other.members.length != this.members.length
    ) return false
    for (let i = 0; i < this.members.length; i++) {
      if (!this.members[i]!.eq(other.members[i]!)) return false
    }
    return true
  }

  locals(node: Node<any, any>): ReadonlyArray<Decoration> {
    let result: Array<Decoration> | undefined, sorted = true
    for (let i = 0; i < this.members.length; i++) {
      const locals = this.members[i]!.localsInner(node)
      if (!locals.length) continue
      if (!result) {
        result = locals as Array<Decoration>
      } else {
        if (sorted) {
          result = result.slice()
          sorted = false
        }
        for (let j = 0; j < locals.length; j++) result.push(locals[j]!)
      }
    }
    return result ? removeOverlap(sorted ? result : result.sort(byPos)) : none
  }

  // Create a group for the given array of decoration sets, or return
  // a single set when possible.
  static from(members: ReadonlyArray<DecorationSource>): DecorationSource {
    switch (members.length) {
      case 0:
        return empty
      case 1:
        return members[0]!
      default:
        return new DecorationGroup(
          members.every((m) => m instanceof DecorationSet)
            ? members as ReadonlyArray<DecorationSet>
            : members.reduce(
              (r, m) => r.concat(m instanceof DecorationSet ? m : (m as DecorationGroup).members),
              [] as Array<DecorationSet>
            )
        )
    }
  }

  forEachSet(f: (set: DecorationSet) => void): void {
    for (let i = 0; i < this.members.length; i++) this.members[i]!.forEachSet(f)
  }
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
  const children = oldChildren.slice() as Array<number | DecorationSet>

  // Mark the children that are directly touched by changes, and
  // move those that are after the changes.
  for (let i = 0, baseOffset = oldOffset; i < mapping.maps.length; i++) {
    let moved = 0
    mapping.maps[i]!.forEach((oldStart: number, oldEnd: number, newStart: number, newEnd: number) => {
      const dSize = (newEnd - newStart) - (oldEnd - oldStart)
      for (let i = 0; i < children.length; i += 3) {
        const end = children[i + 1] as number
        if (end < 0 || oldStart > end + baseOffset - moved) continue
        const start = (children[i] as number) + baseOffset - moved
        if (oldEnd >= start) {
          children[i + 1] = oldStart <= start ? -2 : -1
        } else if (oldStart >= baseOffset && dSize) {
          ;(children[i] as number) += dSize
          ;(children[i + 1] as number) += dSize
        }
      }
      moved += dSize
    })
    baseOffset = mapping.maps[i]!.map(baseOffset, -1)
  }

  // Find the child nodes that still correspond to a single node,
  // recursively call mapInner on them and update their positions.
  let mustRebuild = false
  for (let i = 0; i < children.length; i += 3) {
    if ((children[i + 1] as number) < 0) { // Touched nodes
      if (children[i + 1] == -2) {
        mustRebuild = true
        children[i + 1] = -1
        continue
      }
      const from = mapping.map((oldChildren[i] as number) + oldOffset), fromLocal = from - offset
      if (fromLocal < 0 || fromLocal >= node.content.size) {
        mustRebuild = true
        continue
      }
      // Must read oldChildren because children was tagged with -1
      const to = mapping.map((oldChildren[i + 1] as number) + oldOffset, -1), toLocal = to - offset
      const { index, offset: childOffset } = node.content.findIndex(fromLocal)
      const childNode = node.content.content[index]
      if (childNode && childOffset == fromLocal && childOffset + childNode.nodeSize == toLocal) {
        const mapped = (children[i + 2] as DecorationSet)
          .mapInner(mapping, childNode, from + 1, (oldChildren[i] as number) + oldOffset + 1, options)
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
  }

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
    newLocal = built.local as Array<Decoration>
    for (let i = 0; i < children.length; i += 3) {
      if ((children[i + 1] as number) < 0) {
        children.splice(i, 3)
        i -= 3
      }
    }
    for (let i = 0, j = 0; i < built.children.length; i += 3) {
      const from = built.children[i] as number
      while (j < children.length && (children[j] as number) < from) j += 3
      children.splice(j, 0, built.children[i]!, built.children[i + 1]!, built.children[i + 2]!)
    }
  }

  return new DecorationSet(newLocal.sort(byPos), children)
}

function moveSpans(spans: Array<Decoration>, offset: number) {
  if (!offset || !spans.length) return spans
  const result = []
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i]!
    result.push(new Decoration(span.from + offset, span.to + offset, span.type))
  }
  return result
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
  function gather(set: DecorationSet, oldOffset: number) {
    for (let i = 0; i < set.local.length; i++) {
      const mapped = set.local[i]!.map(mapping, offset, oldOffset)
      if (mapped) decorations.push(mapped)
      else if (options.onRemove) options.onRemove(set.local[i]!.spec)
    }
    for (let i = 0; i < set.children.length; i += 3) {
      gather(set.children[i + 2] as DecorationSet, set.children[i] as number + oldOffset + 1)
    }
  }
  for (let i = 0; i < children.length; i += 3) {
    if (children[i + 1] == -1) {
      gather(children[i + 2] as DecorationSet, oldChildren[i] as number + oldOffset + 1)
    }
  }

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
  for (let i = 0, span; i < spans.length; i++) {
    if ((span = spans[i]) && span.from > offset && span.to < end) {
      ;(found || (found = [])).push(span)
      spans[i] = null
    }
  }
  return found
}

function withoutNulls<T>(array: ReadonlyArray<T | null>): Array<T> {
  const result: Array<T> = []
  for (let i = 0; i < array.length; i++) {
    if (array[i] != null) result.push(array[i]!)
  }
  return result
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
  const locals = moveSpans(hasNulls ? withoutNulls(spans) : spans as Array<Decoration>, -offset).sort(byPos)
  for (let i = 0; i < locals.length; i++) {
    if (!locals[i]!.type.valid(node, locals[i]!)) {
      if (options.onRemove) options.onRemove(locals[i]!.spec)
      locals.splice(i--, 1)
    }
  }
  return locals.length || children.length ? new DecorationSet(locals, children) : empty
}

// Used to sort decorations so that ones with a low start position
// come first, and within a set with the same start position, those
// with an smaller end position come first.
function byPos(a: Decoration, b: Decoration) {
  return a.from - b.from || a.to - b.to
}

// Scan a sorted array of decorations for partially overlapping spans,
// and split those so that only fully overlapping spans are left (to
// make subsequent rendering easier). Will return the input array if
// no partially overlapping spans are found (the common case).
function removeOverlap(spans: ReadonlyArray<Decoration>): Array<Decoration> {
  let working: Array<Decoration> = spans as Array<Decoration>
  for (let i = 0; i < working.length - 1; i++) {
    const span = working[i]!
    if (span.from != span.to) {
      for (let j = i + 1; j < working.length; j++) {
        const next = working[j]!
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
  while (i < array.length && byPos(deco, array[i]!) > 0) i++
  array.splice(i, 0, deco)
}

/**
 * Get the decorations associated with the current props of a view.
 *
 * @internal
 */
export function viewDecorations(view: EditorView<any, any, any>): DecorationSource {
  const found: Array<DecorationSource> = []
  view.someProp("decorations", (f) => {
    const result = f(view.state as EditorState<any>)
    if (result && result != empty) found.push(result)
  })
  if (view.cursorWrapper) {
    found.push(DecorationSet.create(view.state.doc, [view.cursorWrapper.deco]))
  }
  return DecorationGroup.from(found)
}
