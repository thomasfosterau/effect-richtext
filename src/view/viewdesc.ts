// Ported from prosemirror-view (MIT, Marijn Haverbeke and others)
/**
 * View descriptions, node views and mark views.
 *
 * @since 0.1.0
 */
import * as Predicate from "effect/Predicate"
import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import * as Order from "effect/Order"
import * as Rec from "effect/Record"
import {
  type AnySchema,
  DOMSerializer,
  Fragment,
  Mark,
  type MarkNames,
  type Node,
  type NodeNames,
  type TagParseRule
} from "../Model.ts"
import { TextSelection } from "../State.ts"
import * as browser from "./browser.ts"
import type { Decoration, DecorationSource, NodeType, WidgetType } from "./decoration.ts"
import { domIndex, type DOMNode, isElt, isEquivalentPosition, selectionOf } from "./dom.ts"
import { ViewError } from "./errors.ts"
import type { EditorView } from "./view.ts"

type AnyView = EditorView<any, any, any>

// Only called on text nodes.
const textOf = (node: Node<any, any>): string => (node.isTextNode() ? node.text : "")

// SAFETY: only called on widget decorations, whose type is a `WidgetType`.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const widgetType = (widget: Decoration): WidgetType => widget.type as WidgetType

/**
 * A `ViewMutationRecord` represents a DOM mutation or a selection
 * change happens within the view. When the change is a selection
 * change, the record will have a `type` property of `"selection"`
 * (which doesn't occur for native mutation records).
 *
 * @since 0.1.0
 * @category models
 */
export type ViewMutationRecord = MutationRecord | { readonly type: "selection"; readonly target: DOMNode }

/**
 * By default, document nodes are rendered using the result of the
 * `toDOM` method of their spec, and managed entirely by the editor. For
 * some use cases, such as embedded node-specific editing interfaces,
 * you want more control over the behavior of a node's in-editor
 * representation, and need to define a custom node view.
 *
 * Objects returned as node views must conform to this interface. Node
 * views are plain, synchronous objects.
 *
 * @since 0.1.0
 * @category models
 */
export interface NodeView<Sc extends AnySchema = AnySchema> {
  /** The outer DOM node that represents the document node. */
  dom: DOMNode

  /**
   * The DOM node that should hold the node's content. Only meaningful if
   * the node view also defines a `dom` property and if its node type is
   * not a leaf node type. When this is present, the view will take care
   * of rendering the node's children into it. When it is not present,
   * the node view itself is responsible for rendering (or deciding not
   * to render) its child nodes.
   */
  contentDOM?: HTMLElement

  /**
   * When given, this will be called when the view is updating itself.
   * It will be given a node, an array of active decorations around the
   * node (which are automatically drawn, and the node view may ignore if
   * it isn't interested in them), and a decoration source that
   * represents any decorations that apply to the content of the node
   * (which again may be ignored). It should return true if it was able
   * to update to that node, and false otherwise. If the node view has a
   * `contentDOM` property (or no `dom` property), updating its child
   * nodes will be handled by the view.
   */
  update?: (node: Node<Sc>, decorations: ReadonlyArray<Decoration>, innerDecorations: DecorationSource) => boolean

  /**
   * By default, `update` will only be called when a node of the same
   * node type appears in this view's position. When you set this to
   * true, it will be called for any node, making it possible to have a
   * node view that represents multiple types of nodes. You will need to
   * check the type of the nodes you get in `update` and return `false`
   * for types you cannot handle.
   */
  multiType?: boolean

  /**
   * Can be used to override the way the node's selected status (as a
   * node selection) is displayed.
   */
  selectNode?: () => void

  /**
   * When defining a `selectNode` method, you should also provide a
   * `deselectNode` method to remove the effect again.
   */
  deselectNode?: () => void

  /**
   * This will be called to handle setting the selection inside the
   * node. The `anchor` and `head` positions are relative to the start of
   * the node. By default, a DOM selection will be created between the
   * DOM positions corresponding to those positions, but if you override
   * it you can do something else.
   */
  setSelection?: (anchor: number, head: number, root: Document | ShadowRoot) => void

  /**
   * Can be used to prevent the editor view from trying to handle some
   * or all DOM events that bubble up from the node view. Events for
   * which this returns true are not handled by the editor.
   */
  stopEvent?: (event: Event) => boolean

  /**
   * Called when a mutation happens within the view. Return false if the
   * editor should re-read the selection or re-parse the range around
   * the mutation, true if it can safely be ignored.
   */
  ignoreMutation?: (mutation: ViewMutationRecord) => boolean

  /** Called when the node view is removed from the editor or the whole editor is destroyed. */
  destroy?: () => void
}

/**
 * By default, document marks are rendered using the result of the
 * `toDOM` method of their spec, and managed entirely by the editor. For
 * some use cases, you want more control over the behavior of a mark's
 * in-editor representation, and need to define a custom mark view.
 *
 * Objects returned as mark views must conform to this interface.
 *
 * @since 0.1.0
 * @category models
 */
export interface MarkView {
  /** The outer DOM node that represents the document node. */
  dom: HTMLElement

  /**
   * The DOM node that should hold the mark's content. When this is not
   * present, the `dom` property is used as the content DOM.
   */
  contentDOM?: HTMLElement

  /**
   * Called when the mark at this position changes to another mark of the
   * same type. Return true to keep this view (it now represents `mark`),
   * false to have it redrawn.
   */
  update?: (mark: Mark<any, any>) => boolean

  /**
   * Called when a mutation happens within the view. Return false if the
   * editor should re-read the selection or re-parse the range around
   * the mutation, true if it can safely be ignored.
   */
  ignoreMutation?: (mutation: ViewMutationRecord) => boolean

  /** Called when the mark view is removed from the editor or the whole editor is destroyed. */
  destroy?: () => void
}

/**
 * The type of function provided to create node views for nodes named
 * `N`. `getPos` returns the node's current position, or `None` when
 * the node is not in the document.
 *
 * @since 0.1.0
 * @category models
 */
export type NodeViewConstructor<Sc extends AnySchema = AnySchema, N extends NodeNames<Sc> = NodeNames<Sc>> = (
  node: Node<Sc, N>,
  view: EditorView<Sc, any, any>,
  getPos: () => Option.Option<number>,
  decorations: ReadonlyArray<Decoration>,
  innerDecorations: DecorationSource
) => NodeView<Sc>

/**
 * The function type used to create mark views for marks named `M`.
 *
 * @since 0.1.0
 * @category models
 */
export type MarkViewConstructor<Sc extends AnySchema = AnySchema, M extends MarkNames<Sc> = MarkNames<Sc>> = (
  mark: Mark<Sc, M>,
  view: EditorView<Sc, any, any>,
  inline: boolean
) => MarkView

// View descriptions are data structures that describe the DOM that is
// used to represent the editor's content. They are used for:
//
// - Incremental redrawing when the document changes
//
// - Figuring out what part of the document a given DOM position
//   corresponds to
//
// - Wiring in custom implementations of the editing interface for a
//   given node
//
// They form a doubly-linked mutable tree, starting at `view.docView`.

const NOT_DIRTY = 0,
  CHILD_DIRTY = 1,
  CONTENT_DIRTY = 2,
  NODE_DIRTY = 3

type ParseRuleLike = Omit<TagParseRule, "tag">

// The text node of a composition inside a node, and where its text is.
interface CompositionInfo {
  readonly node: Text
  readonly pos: number
  readonly text: string
}
type MutableParseRule = { -readonly [K in keyof ParseRuleLike]: ParseRuleLike[K] }

// Superclass for the various kinds of descriptions. Defines their
// basic structure and shared methods.
/**
 * The DOM position of a document position (`ViewDesc.domFromPos`). `atom`
 * is set when the position is inside a leaf with no content DOM.
 *
 * @internal
 */
export interface DOMFromPos {
  readonly node: DOMNode
  readonly offset: number
  readonly atom?: number
}

/**
 * A DOM range in a single parent covering a changed document range
 * (`ViewDesc.parseRange`).
 *
 * @internal
 */
export interface ParsedRange {
  readonly node: DOMNode
  readonly from: number
  readonly to: number
  readonly fromOffset: number
  readonly toOffset: number
}

/** @internal */
export class ViewDesc {
  dirty = NOT_DIRTY

  constructor(
    public parent: Option.Option<ViewDesc>,
    public children: Array<ViewDesc>,
    public dom: DOMNode,
    // This is the node that holds the child views. It is `None` for
    // descs that don't have children.
    public contentDOM: Option.Option<HTMLElement>
  ) {
    // An expando property on the DOM node provides a link back to its
    // description.
    dom.pmViewDesc = this
  }

  // Whether this desc describes a document node.
  isNode(): this is NodeViewDesc {
    return false
  }

  // Used to check whether a given description corresponds to a
  // widget/mark/node.
  matchesWidget(_widget: Decoration): boolean {
    return false
  }
  matchesMark(_mark: Mark<any, any>): boolean {
    return false
  }
  matchesNode(_node: Node<any, any>, _outerDeco: ReadonlyArray<Decoration>, _innerDeco: DecorationSource): boolean {
    return false
  }
  matchesHack(_nodeName: string): boolean {
    return false
  }

  // When parsing in-editor content (in domchange.js), we allow
  // descriptions to determine the parse rules that should be used to
  // parse them.
  parseRule(_addedNodes?: ReadonlyArray<DOMNode>): Option.Option<ParseRuleLike> {
    return Option.none()
  }

  // Used by the editor's event handler to ignore events that come
  // from certain descs.
  stopEvent(_event: Event): boolean {
    return false
  }

  // The size of the content represented by this desc.
  get size(): number {
    let size = 0
    // Scans the children with a running offset, which callbacks make slower.
    // oxlint-disable-next-line effect/imperative-loops
    for (let i = 0; i < this.children.length; i++) size += this.children[i].size
    return size
  }

  // For block nodes, this represents the space taken up by their
  // start/end tokens.
  get border(): number {
    return 0
  }

  destroy(): void {
    this.parent = Option.none()
    if (this.dom.pmViewDesc == this) delete this.dom.pmViewDesc
    this.children.forEach((child) => child.destroy())
  }

  posBeforeChild(child: ViewDesc): number {
    // Scans the children with a running offset, which callbacks make slower.
    // oxlint-disable-next-line effect/imperative-loops
    for (let i = 0, pos = this.posAtStart; ; i++) {
      const cur = this.children[i]
      if (cur == child) return pos
      pos += cur.size
    }
  }

  // The ancestor of `dom` that is a direct child of the content DOM.
  private childOfContent(dom: DOMNode): DOMNode {
    const up = dom.parentNode
    if (Option.isSome(this.contentDOM) && up == this.contentDOM.value) return dom
    if (!up) throw new ViewError({ message: "DOM position outside the view desc's content" })
    return this.childOfContent(up)
  }

  // The desc of `dom` or its nearest sibling in direction `dir` that is a child of this one.
  private ownDescFrom(dom: ChildNode, dir: number): Option.Option<ViewDesc> {
    const desc = dom.pmViewDesc
    if (desc && Option.exists(desc.parent, (parent) => parent == this)) return Option.some(desc)
    const next = dir < 0 ? dom.previousSibling : dom.nextSibling
    return next ? this.ownDescFrom(next, dir) : Option.none()
  }

  get posBefore(): number {
    if (Option.isNone(this.parent)) throw new ViewError({ message: "A detached view desc has no position" })
    return this.parent.value.posBeforeChild(this)
  }

  get posAtStart(): number {
    return Option.isSome(this.parent) ? this.parent.value.posBeforeChild(this) + this.border : 0
  }

  get posAfter(): number {
    return this.posBefore + this.size
  }

  get posAtEnd(): number {
    return this.posAtStart + this.size - 2 * this.border
  }

  localPosFromDOM(dom: DOMNode, offset: number, bias: number): number {
    const contentDOM = Option.getOrUndefined(this.contentDOM)
    // If the DOM position is in the content, use the child desc after
    // it to figure out a position.
    if (contentDOM && contentDOM.contains(dom.nodeType == 1 ? dom : dom.parentNode)) {
      return this.posInContent(contentDOM, dom, offset, bias)
    }
    // Otherwise, use various heuristics, falling back on the bias
    // parameter, to determine whether to return the position at the
    // start or at the end of this view desc.
    const side = this.sideOf(dom, offset)
    return (side == "unknown" ? bias > 0 : side == "end") ? this.posAtEnd : this.posAtStart
  }

  private posInContent(contentDOM: HTMLElement, dom: DOMNode, offset: number, bias: number): number {
    if (bias < 0) {
      const domBefore = dom == contentDOM ? dom.childNodes[offset - 1] : this.childOfContent(dom).previousSibling
      return Option.match(domBefore ? this.ownDescFrom(domBefore, -1) : Option.none(), {
        onNone: () => this.posAtStart,
        onSome: (desc) => this.posBeforeChild(desc) + desc.size
      })
    }
    const domAfter = dom == contentDOM ? dom.childNodes[offset] : this.childOfContent(dom).nextSibling
    return Option.match(domAfter ? this.ownDescFrom(domAfter, 1) : Option.none(), {
      onNone: () => this.posAtEnd,
      onSome: (desc) => this.posBeforeChild(desc)
    })
  }

  // Whether a DOM position outside the content is at the start or the
  // end of this desc.
  private sideOf(dom: DOMNode, offset: number): "start" | "end" | "unknown" {
    const contentDOM = Option.getOrUndefined(this.contentDOM)
    if (dom == this.dom && contentDOM) return offset > domIndex(contentDOM) ? "end" : "start"
    if (contentDOM && contentDOM != this.dom && this.dom.contains(contentDOM)) {
      const rel = dom.compareDocumentPosition(contentDOM)
      // contentDOM is inside dom
      if (rel & 16)
        return offset > Array.from(dom.childNodes).findIndex((n) => n.contains(contentDOM)) ? "end" : "start"
      // Check if after or before
      return rel & 4 ? "start" : "end"
    }
    if (!this.dom.firstChild) return "unknown"
    if (offset == 0 && reachesAlongEdge(dom, this.dom, -1)) return "start"
    if (offset == dom.childNodes.length && reachesAlongEdge(dom, this.dom, 1)) return "end"
    return "unknown"
  }

  // Scan up the dom finding the first desc that is a descendant of
  // this one.
  nearestDesc(dom: DOMNode): Option.Option<ViewDesc>
  nearestDesc(dom: DOMNode, onlyNodes: true): Option.Option<NodeViewDesc>
  nearestDesc(dom: DOMNode, onlyNodes: boolean = false): Option.Option<ViewDesc> {
    return this.nearestDescFrom(dom, dom, onlyNodes, true)
  }

  private nearestDescFrom(cur: DOMNode, dom: DOMNode, onlyNodes: boolean, first: boolean): Option.Option<ViewDesc> {
    const desc = Option.getOrUndefined(this.getDesc(cur))
    let nodeDOM,
      stillFirst = first
    if (desc && (!onlyNodes || desc.isNode())) {
      // If dom is outside of this desc's nodeDOM, don't count it.
      if (
        first &&
        desc instanceof NodeViewDesc &&
        (nodeDOM = desc.nodeDOM) &&
        !(nodeDOM.nodeType == 1 ? nodeDOM.contains(dom.nodeType == 1 ? dom : dom.parentNode) : nodeDOM == dom)
      ) {
        stillFirst = false
      } else {
        return Option.some(desc)
      }
    }
    const up = cur.parentNode
    return up ? this.nearestDescFrom(up, dom, onlyNodes, stillFirst) : Option.none()
  }

  getDesc(dom: DOMNode): Option.Option<ViewDesc> {
    const desc = dom.pmViewDesc
    return desc && this.isAncestorOf(desc) ? Option.some(desc) : Option.none()
  }

  // Whether this desc is `desc` or one of its ancestors.
  private isAncestorOf(desc: ViewDesc): boolean {
    return desc == this || (Option.isSome(desc.parent) && this.isAncestorOf(desc.parent.value))
  }

  posFromDOM(dom: DOMNode, offset: number, bias: number): number {
    const from = (scan: DOMNode): number => {
      const desc = this.getDesc(scan)
      if (Option.isSome(desc)) return desc.value.localPosFromDOM(dom, offset, bias)
      return scan.parentNode ? from(scan.parentNode) : -1
    }
    return from(dom)
  }

  // Find the desc for the node after the given pos, if any. (When a
  // parent node overrode rendering, there might not be one.)
  descAt(pos: number): Option.Option<ViewDesc> {
    // Scans the children with a running offset, which callbacks make slower.
    // oxlint-disable-next-line effect/imperative-loops
    for (let i = 0, offset = 0; i < this.children.length; i++) {
      let child = this.children[i]
      const end = offset + child.size
      if (offset == pos && end != offset) {
        // oxlint-disable-next-line effect/imperative-loops
        while (!child.border && child.children.length) {
          // oxlint-disable-next-line effect/imperative-loops
          for (let j = 0; j < child.children.length; j++) {
            const inner = child.children[j]
            if (inner.size) {
              child = inner
              break
            }
          }
        }
        return Option.some(child)
      }
      if (pos < end) return child.descAt(pos - offset - child.border)
      offset = end
    }
    return Option.none()
  }

  domFromPos(pos: number, side: number): DOMFromPos {
    if (Option.isNone(this.contentDOM)) return { node: this.dom, offset: 0, atom: pos + 1 }
    const contentDOM = this.contentDOM.value
    // First find the position in the child array
    let i = 0,
      offset = 0
    // Scans the children with a running offset, which callbacks make slower.
    // oxlint-disable-next-line effect/imperative-loops
    for (let curPos = 0; i < this.children.length; i++) {
      const child = this.children[i],
        end = curPos + child.size
      if (end > pos) {
        offset = pos - curPos
        break
      }
      curPos = end
    }
    // If this points into the middle of a child, call through
    if (offset) return this.children[i].domFromPos(offset - this.children[i].border, side)
    // Go back if there were any zero-length widgets with side >= 0 before this point
    // (or buffer hack nodes)
    // oxlint-disable-next-line effect/imperative-loops
    while (i > 0 && skippableBefore(this.children, i)) i--
    // Scan towards the first useable node
    if (side <= 0) {
      let prev,
        enter = true
      // oxlint-disable-next-line effect/imperative-loops
      for (; ; i--, enter = false) {
        prev = i ? this.children[i - 1] : undefined
        if (!prev || prev.dom.parentNode == contentDOM) break
      }
      if (prev && side && enter && !prev.border && !prev.domAtom) return prev.domFromPos(prev.size, side)
      return { node: contentDOM, offset: prev ? domIndex(prev.dom) + 1 : 0 }
    } else {
      let next,
        enter = true
      // oxlint-disable-next-line effect/imperative-loops
      for (; ; i++, enter = false) {
        next = i < this.children.length ? this.children[i] : undefined
        if (!next || next.dom.parentNode == contentDOM) break
      }
      if (next && enter && !next.border && !next.domAtom) return next.domFromPos(0, side)
      return { node: contentDOM, offset: next ? domIndex(next.dom) : contentDOM.childNodes.length }
    }
  }

  // Used to find a DOM range in a single parent for a given changed
  // range.
  parseRange(from: number, to: number, base = 0): ParsedRange {
    if (Option.isNone(this.contentDOM))
      throw new ViewError({ message: "Can't parse a range in a node without content" })
    const contentDOM = this.contentDOM.value
    if (Arr.isReadonlyArrayEmpty(this.children)) {
      return { node: contentDOM, from, to, fromOffset: 0, toOffset: contentDOM.childNodes.length }
    }

    let fromOffset = -1,
      toOffset = -1
    // Scans the children with a running offset, which callbacks make slower.
    // oxlint-disable-next-line effect/imperative-loops
    for (let offset = base, i = 0; ; i++) {
      const child = this.children[i],
        end = offset + child.size
      if (fromOffset == -1 && from <= end) {
        const childBase = offset + child.border
        // FIXME maybe descend mark views to parse a narrower range?
        if (
          from >= childBase &&
          to <= end - child.border &&
          child.isNode() &&
          Option.isSome(child.contentDOM) &&
          contentDOM.contains(child.contentDOM.value)
        ) {
          return child.parseRange(from, to, childBase)
        }

        from = offset
        // oxlint-disable-next-line effect/imperative-loops
        for (let j = i; j > 0; j--) {
          const prev = this.children[j - 1]
          if (prev.size && prev.dom.parentNode == contentDOM && !prev.emptyChildAt(1)) {
            fromOffset = domIndex(prev.dom) + 1
            break
          }
          from -= prev.size
        }
        if (fromOffset == -1) fromOffset = 0
      }
      if (fromOffset > -1 && (end > to || i == this.children.length - 1)) {
        to = end
        // oxlint-disable-next-line effect/imperative-loops
        for (let j = i + 1; j < this.children.length; j++) {
          const next = this.children[j]
          if (next.size && next.dom.parentNode == contentDOM && !next.emptyChildAt(-1)) {
            toOffset = domIndex(next.dom)
            break
          }
          to += next.size
        }
        if (toOffset == -1) toOffset = contentDOM.childNodes.length
        break
      }
      offset = end
    }
    return { node: contentDOM, from, to, fromOffset, toOffset }
  }

  emptyChildAt(side: number): boolean {
    if (this.border || Option.isNone(this.contentDOM) || !this.children.length) return false
    const child = this.children[side < 0 ? 0 : this.children.length - 1]
    return child.size == 0 || child.emptyChildAt(side)
  }

  domAfterPos(pos: number): DOMNode {
    const { node, offset } = this.domFromPos(pos, 0)
    if (node.nodeType != 1 || offset == node.childNodes.length) {
      throw new RangeError("No node after pos " + pos)
    }
    return node.childNodes[offset]
  }

  // View descs are responsible for setting any selection that falls
  // entirely inside of them, so that custom implementations can do
  // custom things with the selection. Note that this falls apart when
  // a selection starts in such a node and ends in another, in which
  // case we just use whatever domFromPos produces as a best effort.
  setSelection(anchor: number, head: number, view: AnyView, force = false): void {
    // If the selection falls entirely in a child, give it to that child
    const from = Math.min(anchor, head),
      to = Math.max(anchor, head)
    // Scans the children with a running offset, which callbacks make slower.
    // oxlint-disable-next-line effect/imperative-loops
    for (let i = 0, offset = 0; i < this.children.length; i++) {
      const child = this.children[i],
        end = offset + child.size
      if (from > offset && to < end) {
        return child.setSelection(anchor - offset - child.border, head - offset - child.border, view, force)
      }
      offset = end
    }

    let anchorDOM = this.domFromPos(anchor, anchor ? -1 : 1)
    let headDOM = head == anchor ? anchorDOM : this.domFromPos(head, head ? -1 : 1)
    const foundSel = selectionOf(view.root)
    if (Option.isNone(foundSel)) return
    const domSel = foundSel.value
    const selRange = view.domSelectionRange()

    let brKludge = false
    // On Firefox, using Selection.collapse to put the cursor after a
    // BR node for some reason doesn't always work. On Safari,
    // the cursor sometimes inexplicable visually lags behind its
    // reported position in such situations.
    if ((browser.gecko || browser.safari) && anchor == head) {
      const { node, offset } = anchorDOM
      if (node.nodeType == 3) {
        const text = node.nodeValue ?? ""
        brKludge = !!(offset && text[offset - 1] == "\n")
        if (brKludge && offset == text.length) {
          const after = Option.getOrUndefined(siblingAfterInBlock(node))
          if (after && after.nodeName == "BR" && after.parentNode) {
            anchorDOM = headDOM = { node: after.parentNode, offset: domIndex(after) + 1 }
          }
        }
      } else {
        const prev = node.childNodes[offset - 1]
        brKludge = !!prev && (prev.nodeName == "BR" || (isElt(prev) && prev.contentEditable == "false"))
      }
    }
    // Firefox can act strangely when the selection is in front of an
    // uneditable node. See https://bugzilla.mozilla.org/show_bug.cgi?id=1709536
    if (browser.gecko && selRange.focusNode && selRange.focusNode != headDOM.node && selRange.focusNode.nodeType == 1) {
      const after = selRange.focusNode.childNodes[selRange.focusOffset]
      if (after && isElt(after) && after.contentEditable == "false") force = true
    }

    if (
      !(force || (brKludge && browser.safari)) &&
      !!selRange.anchorNode &&
      !!selRange.focusNode &&
      isEquivalentPosition(anchorDOM.node, anchorDOM.offset, selRange.anchorNode, selRange.anchorOffset) &&
      isEquivalentPosition(headDOM.node, headDOM.offset, selRange.focusNode, selRange.focusOffset)
    ) {
      return
    }

    // Selection.extend can be used to create an 'inverted' selection
    // (one where the focus is before the anchor), but not all
    // browsers support it yet.
    let domSelExtended = false
    if ((domSel.extend || anchor == head) && !(brKludge && browser.gecko)) {
      domSel.collapse(anchorDOM.node, anchorDOM.offset)
      try {
        if (anchor != head) {
          domSel.extend(headDOM.node, headDOM.offset)
        }
        domSelExtended = true
      } catch {
        // In some cases with Chrome the selection is empty after calling
        // collapse, even when it should be valid. This appears to be a bug, but
        // it is difficult to isolate. If this happens fallback to the old path
        // without using extend.
        // Similarly, this could crash on Safari if the editor is hidden, and
        // there was no selection.
      }
    }
    if (!domSelExtended) {
      if (anchor > head) {
        const tmp = anchorDOM
        anchorDOM = headDOM
        headDOM = tmp
      }
      const range = document.createRange()
      range.setEnd(headDOM.node, headDOM.offset)
      range.setStart(anchorDOM.node, anchorDOM.offset)
      domSel.removeAllRanges()
      domSel.addRange(range)
    }
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    return Option.isNone(this.contentDOM) && mutation.type != "selection"
  }

  get contentLost(): boolean {
    if (Option.isNone(this.contentDOM)) return false
    const contentDOM = this.contentDOM.value
    return contentDOM != this.dom && !this.dom.contains(contentDOM)
  }

  // Remove a subtree of the element tree that has been touched
  // by a DOM change, so that the next update will redraw it.
  markDirty(from: number, to: number): void {
    // Scans the children with a running offset, which callbacks make slower.
    const contentDOM = Option.getOrUndefined(this.contentDOM)
    // oxlint-disable-next-line effect/imperative-loops
    for (let offset = 0, i = 0; i < this.children.length; i++) {
      const child = this.children[i],
        end = offset + child.size
      if (offset == end ? from <= end && to >= offset : from < end && to > offset) {
        const startInside = offset + child.border,
          endInside = end - child.border
        if (from >= startInside && to <= endInside) {
          this.dirty = from == offset || to == end ? CONTENT_DIRTY : CHILD_DIRTY
          if (from == startInside && to == endInside && (child.contentLost || child.dom.parentNode != contentDOM))
            child.dirty = NODE_DIRTY
          else child.markDirty(from - startInside, to - startInside)
          return
        } else {
          child.dirty =
            Option.exists(child.contentDOM, (inner) => inner == child.dom) &&
            child.dom.parentNode == contentDOM &&
            !child.children.length
              ? CONTENT_DIRTY
              : NODE_DIRTY
        }
      }
      offset = end
    }
    this.dirty = CONTENT_DIRTY
  }

  markParentsDirty(): void {
    if (Option.isSome(this.parent)) markDirtyUp(this.parent.value, CONTENT_DIRTY)
  }

  get domAtom(): boolean {
    return false
  }

  get ignoreForCoords(): boolean {
    return false
  }

  get ignoreForSelection(): boolean {
    return false
  }

  isText(_text: string): boolean {
    return false
  }
}

// Holds a desc once its constructor has run, for a `getPos` called
// before that.
interface DescCell<D extends ViewDesc> {
  desc?: D
}

// A `getPos` for a desc that may not exist yet: `pos` until it does,
// then its current position (none once it is detached).
const cellPos = (cell: DescCell<ViewDesc>, pos: number) => (): Option.Option<number> => {
  const desc = cell.desc
  if (!desc) return Option.some(pos)
  return Option.map(desc.parent, (up) => up.posBeforeChild(desc))
}

// A widget desc represents a widget decoration, which is a DOM node
// drawn between the document nodes.
class WidgetViewDesc extends ViewDesc {
  constructor(
    parent: ViewDesc,
    readonly widget: Decoration,
    view: AnyView,
    pos: number
  ) {
    // The widget's `getPos` can be called before `super` returns, so it
    // reads the desc through a cell that is filled in once it exists.
    const cell: DescCell<WidgetViewDesc> = {}
    let dom = widgetType(widget).toDOM
    if (Predicate.isFunction(dom)) {
      dom = dom(view, cellPos(cell, pos))
    }
    if (!widget.type.spec.raw) {
      const elt = isElt(dom) ? dom : document.createElement("span")
      if (elt != dom) {
        elt.appendChild(dom)
        dom = elt
      }
      // Keep a contenteditable attribute the widget set itself (prosemirror-view 1.42.3).
      if (!elt.hasAttribute("contenteditable")) elt.contentEditable = "false"
      elt.classList.add("ProseMirror-widget")
    }
    super(Option.some(parent), [], dom, Option.none())
    cell.desc = this
  }

  override matchesWidget(widget: Decoration) {
    return this.dirty == NOT_DIRTY && widget.type.eq(this.widget.type)
  }

  override parseRule() {
    return Option.some({ ignore: true })
  }

  override stopEvent(event: Event) {
    const stop = this.widget.spec.stopEvent
    return stop ? stop(event) : false
  }

  override ignoreMutation(mutation: ViewMutationRecord) {
    return mutation.type != "selection" || this.widget.spec.ignoreSelection
  }

  override destroy() {
    this.widget.type.destroy(this.dom)
    super.destroy()
  }

  override get domAtom() {
    return true
  }

  override get ignoreForSelection() {
    return !!this.widget.type.spec.relaxedSide
  }

  get side() {
    return widgetType(this.widget).side
  }
}

/** @internal */
export class CompositionViewDesc extends ViewDesc {
  constructor(
    parent: ViewDesc,
    dom: DOMNode,
    readonly textDOM: Text,
    readonly text: string
  ) {
    super(Option.some(parent), [], dom, Option.none())
  }

  override get size() {
    return this.text.length
  }

  override localPosFromDOM(dom: DOMNode, offset: number) {
    if (dom != this.textDOM) return this.posAtStart + (offset ? this.size : 0)
    return this.posAtStart + offset
  }

  override domFromPos(pos: number) {
    return { node: this.textDOM, offset: pos }
  }

  override ignoreMutation(mut: ViewMutationRecord) {
    return mut.type === "characterData" && mut.target.nodeValue == mut.oldValue
  }
}

// A mark desc represents a mark. May have multiple children,
// depending on how the mark is split. Note that marks are drawn using
// a fixed nesting order, for simplicity and predictability, so in
// some cases they will be split more often than would appear
// necessary.
class MarkViewDesc extends ViewDesc {
  constructor(
    parent: ViewDesc,
    public mark: Mark<any, any>,
    dom: DOMNode,
    contentDOM: HTMLElement,
    readonly spec: Partial<MarkView>
  ) {
    super(Option.some(parent), [], dom, Option.some(contentDOM))
  }

  static create(parent: ViewDesc, mark: Mark<any, any>, inline: boolean, view: AnyView) {
    const custom = view.nodeViews[mark.type.name]
    let spec: { dom: DOMNode; contentDOM?: HTMLElement } =
      // SAFETY: a node view registered under a mark's name is a mark view constructor.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      custom && (custom as MarkViewConstructor<any, any>)(mark, view, inline)
    if (!spec || !spec.dom) {
      const toDOM = mark.type.spec.toDOM
      if (!toDOM) throw new ViewError({ message: "Mark type " + mark.type.name + " has no toDOM method" })
      spec = DOMSerializer.renderSpecUnsafe(document, toDOM(mark, inline), undefined, mark.attrs)
    }
    // SAFETY: as in ProseMirror, a mark view renders to an element, and `spec` is a `MarkView` or a rendered spec.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return new MarkViewDesc(parent, mark, spec.dom, spec.contentDOM || (spec.dom as HTMLElement), spec as MarkView)
  }

  override parseRule() {
    if (this.dirty & NODE_DIRTY || this.mark.type.spec.reparseInView || Option.isNone(this.contentDOM))
      return Option.none()
    return Option.some({ mark: this.mark.type.name, attrs: this.mark.attrs, contentElement: this.contentDOM.value })
  }

  override matchesMark(mark: Mark<any, any>) {
    return this.dirty != NODE_DIRTY && this.mark.eq(mark)
  }

  override markDirty(from: number, to: number) {
    super.markDirty(from, to)
    // Move dirty info to nearest node view
    if (this.dirty != NOT_DIRTY) {
      const parent = Option.getOrUndefined(Option.flatMap(this.parent, withNodeDesc))
      if (parent && parent.dirty < this.dirty) parent.dirty = this.dirty
      this.dirty = NOT_DIRTY
    }
  }

  slice(from: number, to: number, view: AnyView) {
    if (Option.isNone(this.parent)) throw new ViewError({ message: "Can't slice a detached mark view" })
    const copy = MarkViewDesc.create(this.parent.value, this.mark, true, view)
    let nodes = this.children
    const size = this.size
    if (to < size) nodes = replaceNodes(nodes, to, size, view)
    if (from > 0) nodes = replaceNodes(nodes, 0, from, view)
    const copyParent = Option.some(copy)
    nodes.forEach((child) => (child.parent = copyParent))
    copy.children = nodes
    return copy
  }

  override ignoreMutation(mutation: ViewMutationRecord) {
    return this.spec.ignoreMutation ? this.spec.ignoreMutation(mutation) : super.ignoreMutation(mutation)
  }

  override destroy() {
    if (this.spec.destroy) this.spec.destroy()
    super.destroy()
  }
}

// Node view descs are the main, most common type of view desc, and
// correspond to an actual node in the document. Unlike mark descs,
// they populate their child array themselves.
/** @internal */
export class NodeViewDesc extends ViewDesc {
  constructor(
    parent: Option.Option<ViewDesc>,
    public node: Node<any, any>,
    public outerDeco: ReadonlyArray<Decoration>,
    public innerDeco: DecorationSource,
    dom: DOMNode,
    contentDOM: Option.Option<HTMLElement>,
    readonly nodeDOM: DOMNode,
    _view: AnyView,
    _pos: number
  ) {
    super(parent, [], dom, contentDOM)
  }

  override isNode(): this is NodeViewDesc {
    return true
  }

  // By default, a node is rendered using the `toDOM` method from the
  // node type spec. But client code can use the `nodeViews` spec to
  // supply a custom node view, which can influence various aspects of
  // the way the node works.
  //
  // (Using subclassing for this was intentionally decided against,
  // since it'd require exposing a whole slew of finicky
  // implementation details to the user code that they probably will
  // never need.)
  static create(
    parent: Option.Option<ViewDesc>,
    node: Node<any, any>,
    outerDeco: ReadonlyArray<Decoration>,
    innerDeco: DecorationSource,
    view: AnyView,
    pos: number
  ): NodeViewDesc {
    const custom = view.nodeViews[node.type.name]
    // Holds the desc once it exists, for the custom view's `getPos`.
    const cell: DescCell<ViewDesc> = {}
    const spec =
      custom &&
      // SAFETY: a node view registered under a node's name is a node view constructor.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      (custom as NodeViewConstructor<any, any>)(node, view, cellPos(cell, pos), outerDeco, innerDeco)

    let dom = spec ? spec.dom : undefined,
      contentDOM = spec ? spec.contentDOM : undefined
    if (node.isText) {
      if (!dom) dom = document.createTextNode(textOf(node))
      else if (dom.nodeType != 3) throw new RangeError("Text must be rendered as a DOM text node")
    } else if (!dom) {
      const toDOM = node.type.spec.toDOM
      if (!toDOM) throw new ViewError({ message: "Node type " + node.type.name + " has no toDOM method" })
      const rendered = DOMSerializer.renderSpecUnsafe(document, toDOM(node), undefined, node.attrs)
      ;({ dom, contentDOM } = rendered)
    }
    if (!contentDOM && !node.isText && dom.nodeName != "BR") {
      // Chrome gets confused by <br contenteditable=false>
      if (isElt(dom)) {
        if (!dom.hasAttribute("contenteditable")) dom.contentEditable = "false"
        if (node.type.spec.draggable) dom.draggable = true
      }
    }

    const nodeDOM = dom
    dom = applyOuterDeco(dom, outerDeco, node)

    if (spec) {
      // SAFETY: as in ProseMirror, a custom node view renders to an element.
      return (cell.desc = new CustomNodeViewDesc(
        parent,
        node,
        outerDeco,
        innerDeco,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        dom as HTMLElement,
        Option.fromNullishOr(contentDOM),
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        nodeDOM as HTMLElement,
        spec,
        view,
        pos + 1
      ))
    } else if (node.isText) {
      return new TextViewDesc(parent, node, outerDeco, innerDeco, dom, nodeDOM, view)
    } else {
      const content = Option.fromNullishOr(contentDOM)
      return new NodeViewDesc(parent, node, outerDeco, innerDeco, dom, content, nodeDOM, view, pos + 1)
    }
  }

  override parseRule(addedNodes?: ReadonlyArray<DOMNode>): Option.Option<ParseRuleLike> {
    // Experimental kludge to allow opt-in re-parsing of nodes
    if (this.node.type.spec.reparseInView) return Option.none()
    // FIXME the assumption that this can always return the current
    // attrs means that if the user somehow manages to change the
    // attrs in the dom, that won't be picked up. Not entirely sure
    // whether this is a problem
    const rule: MutableParseRule = { node: this.node.type.name, attrs: this.node.attrs }
    if (this.node.type.whitespace == "pre") rule.preserveWhitespace = "full"
    if (Option.isNone(this.contentDOM)) {
      rule.getContent = () => this.node.content
    } else if (!this.contentLost) {
      rule.contentElement = this.contentDOM.value
    } else {
      // Chrome likes to randomly recreate parent nodes when
      // backspacing things. When that happens, this tries to find the
      // new parent.
      const moved = Arr.findLast(this.children, (child) => {
        const parent = child.dom.parentElement
        return parent && this.dom.contains(parent) ? Option.some(parent) : Option.none()
      })
      if (Option.isSome(moved)) rule.contentElement = moved.value
      if (!rule.contentElement) {
        // Chrome/WebKit may also swap the content DOM for a completely
        // new element (prosemirror-view 1.42.2).
        const found = addedNodes?.find(
          (n): n is HTMLElement =>
            isElt(n) && (!n.parentNode || addedNodes.indexOf(n.parentNode) < 0) && this.dom.contains(n)
        )
        if (found) rule.contentElement = found
        else rule.getContent = () => Fragment.empty
      }
    }
    return Option.some(rule)
  }

  override matchesNode(node: Node<any, any>, outerDeco: ReadonlyArray<Decoration>, innerDeco: DecorationSource) {
    return (
      this.dirty == NOT_DIRTY &&
      node.eq(this.node) &&
      sameOuterDeco(outerDeco, this.outerDeco) &&
      innerDeco.eq(this.innerDeco)
    )
  }

  override get size() {
    return this.node.nodeSize
  }

  override get border() {
    return this.node.isLeaf ? 0 : 1
  }

  // Syncs `this.children` to match `this.node.content` and the local
  // decorations, possibly introducing nesting for marks. Then, in a
  // separate step, syncs the DOM inside `this.contentDOM` to
  // `this.children`.
  updateChildren(view: AnyView, pos: number): void {
    const inline = this.node.inlineContent
    let off = pos
    const composition = view.composing ? this.localCompositionInfo(view, pos) : Option.none()
    const localComposition = Option.filter(composition, (info) => info.pos > -1)
    const compositionInChild = Option.isSome(composition) && composition.value.pos < 0
    const updater = new ViewTreeUpdater(
      this,
      Option.map(localComposition, (info) => info.node),
      view
    )
    // Put a buffer node in front of inline atoms at the start of a block
    // or right after another atom, so browsers have a cursor position
    // there (prosemirror-view 1.42.6).
    const addBuffers = this.node.inlineContent
    let atBufferPos = addBuffers && this.node.isBlock
    iterDeco(
      this.node,
      this.innerDeco,
      (widget, i, insideNode) => {
        if (widget.spec.marks) {
          updater.syncToMarks(widget.spec.marks, inline, view, i)
        } else if (widgetType(widget).side >= 0 && !insideNode) {
          updater.syncToMarks(
            i == this.node.childCount ? Mark.none : this.node.content.content[i].marks,
            inline,
            view,
            i
          )
        }
        // If the next node is a desc matching this widget, reuse it,
        // otherwise insert the widget as a new view desc.
        updater.placeWidget(widget, view, off)
      },
      (child, outerDeco, innerDeco, i) => {
        // Make sure the wrapping mark descs match the node's marks.
        updater.syncToMarks(child.marks, inline, view, i)
        if (atBufferPos && child.isAtom && !child.isText) updater.addHackNode("IMG", updater.top)
        // Try several strategies for drawing this node
        let compIndex
        if (updater.findNodeMatch(child, outerDeco, innerDeco, i)) {
          // Found precise match with existing node view
        } else if (
          compositionInChild &&
          view.state.selection.from > off &&
          view.state.selection.to < off + child.nodeSize &&
          (compIndex = updater.findIndexWithChild(composition.value.node)) > -1 &&
          updater.updateNodeAt(child, outerDeco, innerDeco, compIndex, view)
        ) {
          // Updated the specific node that holds the composition
        } else if (updater.updateNextNode(child, outerDeco, innerDeco, view, i, off)) {
          // Could update an existing node to reflect this node
        } else {
          // Add it as a new view
          updater.addNode(child, outerDeco, innerDeco, view, off)
        }
        off += child.nodeSize
        if (addBuffers) atBufferPos = child.isAtom && !child.isText
      }
    )
    // Drop all remaining descs after the current position.
    updater.syncToMarks([], inline, view, 0)
    if (this.node.isTextblock) updater.addTextblockHacks()
    updater.destroyRest()

    // Sync the DOM if anything changed
    if (updater.changed || this.dirty == CONTENT_DIRTY) {
      // May have to protect focused DOM from being changed if a composition is active
      if (Option.isSome(localComposition)) this.protectLocalComposition(view, localComposition.value)
      if (Option.isSome(this.contentDOM)) renderDescs(this.contentDOM.value, this.children, view)
      if (browser.ios && isElt(this.dom)) iosHacks(this.dom)
    }
  }

  localCompositionInfo(view: AnyView, pos: number): Option.Option<CompositionInfo> {
    // Only do something if both the selection and a focused text node
    // are inside of this node
    const { from, to } = view.state.selection
    if (!(view.state.selection instanceof TextSelection) || from < pos || to > pos + this.node.content.size) {
      return Option.none()
    }
    if (Option.isNone(view.input.compositionNode)) return Option.none()
    const textNode = view.input.compositionNode.value
    if (!this.dom.contains(textNode.parentNode)) return Option.none()

    if (this.node.inlineContent) {
      // Find the text in the focused node in the node, stop if it's not
      // there (may have been modified through other means, in which
      // case it should overwritten)
      const text = textNode.data
      const textPos = findTextInFragment(this.node.content, text, from - pos, to - pos)
      return textPos < 0 ? Option.none() : Option.some({ node: textNode, pos: textPos, text })
    } else {
      return Option.some({ node: textNode, pos: -1, text: "" })
    }
  }

  protectLocalComposition(view: AnyView, { node, pos, text }: CompositionInfo): void {
    // The node is already part of a local view desc, leave it there
    if (Option.isSome(this.getDesc(node))) return
    const contentDOM = Option.getOrUndefined(this.contentDOM)

    // Create a composition view for the orphaned nodes
    // Strip the siblings of `node` and of each ancestor below the content DOM.
    const isolate = (dom: DOMNode): DOMNode => {
      const parent = dom.parentNode
      if (!parent || parent == contentDOM) return dom
      Array.from(parent.childNodes).forEach((sibling) => {
        if (sibling != dom) parent.removeChild(sibling)
      })
      delete dom.pmViewDesc
      return isolate(parent)
    }
    const topNode = isolate(node)
    const desc = new CompositionViewDesc(this, topNode, node, text)
    view.input.compositionNodes.push(desc)

    // Patch up this.children to contain the composition view
    this.children = replaceNodes(this.children, pos, pos + text.length, view, desc)
  }

  // If this desc must be updated to match the given node decoration,
  // do so and return true.
  update(
    node: Node<any, any>,
    outerDeco: ReadonlyArray<Decoration>,
    innerDeco: DecorationSource,
    view: AnyView
  ): boolean {
    if (this.dirty == NODE_DIRTY || !node.sameMarkup(this.node)) return false
    this.updateInner(node, outerDeco, innerDeco, view)
    return true
  }

  updateInner(node: Node<any, any>, outerDeco: ReadonlyArray<Decoration>, innerDeco: DecorationSource, view: AnyView) {
    this.updateOuterDeco(outerDeco)
    this.node = node
    this.innerDeco = innerDeco
    if (Option.isSome(this.contentDOM)) this.updateChildren(view, this.posAtStart)
    this.dirty = NOT_DIRTY
  }

  updateOuterDeco(outerDeco: ReadonlyArray<Decoration>): void {
    if (sameOuterDeco(outerDeco, this.outerDeco)) return
    const needsWrap = this.nodeDOM.nodeType != 1
    const oldDOM = this.dom
    this.dom = patchOuterDeco(
      this.dom,
      this.nodeDOM,
      computeOuterDeco(this.outerDeco, this.node, needsWrap),
      computeOuterDeco(outerDeco, this.node, needsWrap)
    )
    if (this.dom != oldDOM) {
      delete oldDOM.pmViewDesc
      this.dom.pmViewDesc = this
    }
    this.outerDeco = outerDeco
  }

  // Mark this node as being the selected node.
  selectNode(): void {
    const dom = this.nodeDOM
    if (isElt(dom)) {
      dom.classList.add("ProseMirror-selectednode")
      if (Option.isSome(this.contentDOM) || !this.node.type.spec.draggable) dom.draggable = true
    }
  }

  // Remove selected node marking from this node.
  deselectNode(): void {
    const dom = this.nodeDOM
    if (isElt(dom)) {
      dom.classList.remove("ProseMirror-selectednode")
      if (Option.isSome(this.contentDOM) || !this.node.type.spec.draggable) {
        dom.removeAttribute("draggable")
      }
    }
  }

  override get domAtom() {
    return this.node.isAtom
  }
}

/**
 * Create a view desc for the top-level document node, to be exported
 * and used by the view class.
 *
 * @internal
 */
export function docViewDesc(
  doc: Node<any, any>,
  outerDeco: ReadonlyArray<Decoration>,
  innerDeco: DecorationSource,
  dom: HTMLElement,
  view: AnyView
): NodeViewDesc {
  applyOuterDeco(dom, outerDeco, doc)
  const docView = new NodeViewDesc(Option.none(), doc, outerDeco, innerDeco, dom, Option.some(dom), dom, view, 0)
  docView.updateChildren(view, 0)
  return docView
}

class TextViewDesc extends NodeViewDesc {
  constructor(
    parent: Option.Option<ViewDesc>,
    node: Node<any, any>,
    outerDeco: ReadonlyArray<Decoration>,
    innerDeco: DecorationSource,
    dom: DOMNode,
    nodeDOM: DOMNode,
    view: AnyView
  ) {
    super(parent, node, outerDeco, innerDeco, dom, Option.none(), nodeDOM, view, 0)
  }

  override parseRule() {
    const parent = this.nodeDOM.parentNode
    const skip = parent ? wrapperFrom(parent, this.dom) : Option.none()
    return Option.some({ skip: Option.getOrElse(skip, (): true => true) })
  }

  override update(
    node: Node<any, any>,
    outerDeco: ReadonlyArray<Decoration>,
    _innerDeco: DecorationSource,
    view: AnyView
  ) {
    if (this.dirty == NODE_DIRTY || (this.dirty != NOT_DIRTY && !this.inParent()) || !node.sameMarkup(this.node))
      return false
    this.updateOuterDeco(outerDeco)
    if ((this.dirty != NOT_DIRTY || textOf(node) != textOf(this.node)) && textOf(node) != this.nodeDOM.nodeValue) {
      this.nodeDOM.nodeValue = textOf(node)
      if (Option.exists(view.trackWrites, (dom) => dom == this.nodeDOM)) view.trackWrites = Option.none()
    }
    this.node = node
    this.dirty = NOT_DIRTY
    return true
  }

  inParent() {
    if (Option.isNone(this.parent)) return false
    const parentDOM = Option.getOrUndefined(this.parent.value.contentDOM)
    const within = (dom: DOMNode): boolean => dom == parentDOM || (!!dom.parentNode && within(dom.parentNode))
    return within(this.nodeDOM)
  }

  override domFromPos(pos: number) {
    return { node: this.nodeDOM, offset: pos }
  }

  override localPosFromDOM(dom: DOMNode, offset: number, bias: number) {
    if (dom == this.nodeDOM) return this.posAtStart + Math.min(offset, textOf(this.node).length)
    return super.localPosFromDOM(dom, offset, bias)
  }

  override ignoreMutation(mutation: ViewMutationRecord) {
    return mutation.type != "characterData" && mutation.type != "selection"
  }

  slice(from: number, to: number, view: AnyView) {
    const node = this.node.cut(from, to),
      dom = document.createTextNode(textOf(node))
    return new TextViewDesc(this.parent, node, this.outerDeco, this.innerDeco, dom, dom, view)
  }

  override markDirty(from: number, to: number) {
    super.markDirty(from, to)
    if (this.dom != this.nodeDOM && (from == 0 || to == (this.nodeDOM.nodeValue ?? "").length)) {
      this.dirty = NODE_DIRTY
    }
  }

  override get domAtom() {
    return false
  }

  override isText(text: string) {
    return textOf(this.node) == text
  }
}

// A dummy desc used to tag extra BR or IMG nodes created to work
// around contentEditable terribleness.
class BufferHackViewDesc extends ViewDesc {
  override parseRule() {
    return Option.some({ ignore: true })
  }
  override matchesHack(nodeName: string) {
    return this.dirty == NOT_DIRTY && this.dom.nodeName == nodeName
  }
  override get domAtom() {
    return true
  }
  override get ignoreForCoords() {
    return this.dom.nodeName == "IMG"
  }
}

// Zero-size descs that domFromPos steps back over: widgets with side >= 0
// and buffer hack nodes (prosemirror-view 1.42.6).
function skippableBefore(children: ReadonlyArray<ViewDesc>, index: number): boolean {
  const desc = children[index - 1]
  if (!desc || desc.size) return false
  return desc instanceof BufferHackViewDesc || (desc instanceof WidgetViewDesc && desc.side >= 0)
}

// A separate subclass is used for customized node views, so that the
// extra checks only have to be made for nodes that are actually
// customized.
class CustomNodeViewDesc extends NodeViewDesc {
  constructor(
    parent: Option.Option<ViewDesc>,
    node: Node<any, any>,
    outerDeco: ReadonlyArray<Decoration>,
    innerDeco: DecorationSource,
    dom: HTMLElement,
    contentDOM: Option.Option<HTMLElement>,
    nodeDOM: HTMLElement,
    readonly spec: NodeView<any>,
    view: AnyView,
    pos: number
  ) {
    super(parent, node, outerDeco, innerDeco, dom, contentDOM, nodeDOM, view, pos)
  }

  // A custom `update` method gets to decide whether the update goes
  // through. If it does, and there's a `contentDOM` node, our logic
  // updates the children.
  override update(
    node: Node<any, any>,
    outerDeco: ReadonlyArray<Decoration>,
    innerDeco: DecorationSource,
    view: AnyView
  ) {
    if (this.dirty == NODE_DIRTY) return false
    if (this.spec.update && (this.node.type == node.type || this.spec.multiType)) {
      const result = this.spec.update(node, outerDeco, innerDeco)
      if (result) this.updateInner(node, outerDeco, innerDeco, view)
      return result
    } else if (Option.isNone(this.contentDOM) && !node.isLeaf) {
      return false
    } else {
      return super.update(node, outerDeco, innerDeco, view)
    }
  }

  override selectNode() {
    if (this.spec.selectNode) this.spec.selectNode()
    else super.selectNode()
  }

  override deselectNode() {
    if (this.spec.deselectNode) this.spec.deselectNode()
    else super.deselectNode()
  }

  override setSelection(anchor: number, head: number, view: AnyView, force: boolean) {
    if (this.spec.setSelection) this.spec.setSelection(anchor, head, view.root)
    else super.setSelection(anchor, head, view, force)
  }

  override destroy() {
    if (this.spec.destroy) this.spec.destroy()
    super.destroy()
  }

  override stopEvent(event: Event) {
    return this.spec.stopEvent ? this.spec.stopEvent(event) : false
  }

  override ignoreMutation(mutation: ViewMutationRecord) {
    return this.spec.ignoreMutation ? this.spec.ignoreMutation(mutation) : super.ignoreMutation(mutation)
  }
}

// Sync the content of the given DOM node with the nodes associated
// with the given array of view descs, recursing into mark descs
// because this should sync the subtree for a whole node at a time.
function renderDescs(parentDOM: HTMLElement, descs: ReadonlyArray<ViewDesc>, view: AnyView) {
  let dom = parentDOM.firstChild,
    written = false
  // Runs for each child on every render, so it stays a plain loop.
  // oxlint-disable-next-line effect/imperative-loops
  for (let i = 0; i < descs.length; i++) {
    const desc = descs[i],
      childDOM = desc.dom
    if (childDOM.parentNode == parentDOM) {
      // oxlint-disable-next-line effect/imperative-loops
      while (dom && childDOM != dom) {
        dom = rm(dom)
        written = true
      }
      dom = childDOM.nextSibling
    } else {
      written = true
      parentDOM.insertBefore(childDOM, dom)
    }
    if (desc instanceof MarkViewDesc && Option.isSome(desc.contentDOM)) {
      const pos = dom ? dom.previousSibling : parentDOM.lastChild
      renderDescs(desc.contentDOM.value, desc.children, view)
      dom = pos ? pos.nextSibling : parentDOM.firstChild
    }
  }
  // oxlint-disable-next-line effect/imperative-loops
  while (dom) {
    dom = rm(dom)
    written = true
  }
  if (written && Option.exists(view.trackWrites, (tracked) => tracked == parentDOM)) view.trackWrites = Option.none()
}

type OuterDecoLevel = { [attr: string]: string }

// Without a prototype, so that any attribute name reads as unset.
const outerDecoLevel = (nodeName?: string): OuterDecoLevel => {
  const level: OuterDecoLevel = Object.create(null)
  if (nodeName) level.nodeName = nodeName
  return level
}

// Whether a widget's DOM is not in the document (or is built on demand).
const isDetachedWidget = (widget: Decoration): boolean => {
  const toDOM: unknown = Predicate.hasProperty(widget.type, "toDOM") ? widget.type.toDOM : undefined
  return !(Predicate.hasProperty(toDOM, "parentNode") && toDOM.parentNode)
}

// Elements wrapping a node for its outer decorations are flagged.
type DecoWrapper = DOMNode & { pmIsDeco?: boolean }

const isDecoWrapper = (node: DecoWrapper): boolean => node.pmIsDeco === true

const noDeco = [outerDecoLevel()]

function computeOuterDeco(outerDeco: ReadonlyArray<Decoration>, node: Node<any, any>, needsWrap: boolean) {
  if (Arr.isReadonlyArrayEmpty(outerDeco)) return noDeco

  let top = needsWrap ? noDeco[0] : outerDecoLevel()
  const result = [top]

  outerDeco.forEach((deco) => {
    // SAFETY: outer decorations are node decorations, whose type is a `NodeType`.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const attrs = (deco.type as NodeType).attrs
    if (!attrs) return
    if (attrs.nodeName) {
      result.push((top = outerDecoLevel(attrs.nodeName)))
    }

    Rec.toEntries(attrs).forEach(([name, val]) => {
      if (val == null) return
      if (needsWrap && result.length == 1) {
        result.push((top = outerDecoLevel(node.isInline ? "span" : "div")))
      }
      if (name == "class") top.class = (top.class ? top.class + " " : "") + val
      else if (name == "style") top.style = (top.style ? top.style + ";" : "") + val
      else if (name != "nodeName") top[name] = val
    })
  })

  return result
}

function patchOuterDeco(
  outerDOM: DOMNode,
  nodeDOM: DOMNode,
  prevComputed: ReadonlyArray<OuterDecoLevel>,
  curComputed: ReadonlyArray<OuterDecoLevel>
) {
  // Shortcut for trivial case
  if (prevComputed == noDeco && curComputed == noDeco) return nodeDOM

  return curComputed.reduce((dom, deco, i) => {
    let prev = prevComputed[i],
      curDOM = dom
    if (i) {
      const parent = curDOM != outerDOM ? curDOM.parentNode : undefined
      if (prev && prev.nodeName == deco.nodeName && parent && parent.nodeName.toLowerCase() == deco.nodeName) {
        curDOM = parent
      } else {
        const wrapper: HTMLElement & DecoWrapper = document.createElement(deco.nodeName)
        wrapper.pmIsDeco = true
        wrapper.appendChild(curDOM)
        prev = noDeco[0]
        curDOM = wrapper
      }
    }
    if (isElt(curDOM)) patchAttributes(curDOM, prev || noDeco[0], deco)
    return curDOM
  }, nodeDOM)
}

function patchAttributes(dom: HTMLElement, prev: { [name: string]: string }, cur: { [name: string]: string }) {
  Rec.keys(prev).forEach((name) => {
    if (name != "class" && name != "style" && name != "nodeName" && !(name in cur)) {
      dom.removeAttribute(name)
    }
  })
  Rec.keys(cur).forEach((name) => {
    if (name != "class" && name != "style" && name != "nodeName" && cur[name] != prev[name]) {
      dom.setAttribute(name, cur[name])
    }
  })
  if (prev.class != cur.class) {
    const prevList = prev.class ? prev.class.split(" ").filter(Boolean) : []
    const curList = cur.class ? cur.class.split(" ").filter(Boolean) : []
    prevList.forEach((name) => {
      if (curList.indexOf(name) == -1) dom.classList.remove(name)
    })
    curList.forEach((name) => {
      if (prevList.indexOf(name) == -1) dom.classList.add(name)
    })
    if (dom.classList.item(0) === null) {
      dom.removeAttribute("class")
    }
  }
  if (prev.style != cur.style) {
    if (prev.style) {
      const prop = /\s*([\w\-\xa1-￿]+)\s*:(?:"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|\(.*?\)|[^;])*/g
      Array.from(prev.style.matchAll(prop)).forEach((m) => dom.style.removeProperty(m[1]))
    }
    if (cur.style) {
      dom.style.cssText += cur.style
    }
  }
}

function applyOuterDeco(dom: DOMNode, deco: ReadonlyArray<Decoration>, node: Node<any, any>) {
  return patchOuterDeco(dom, dom, noDeco, computeOuterDeco(deco, node, dom.nodeType != 1))
}

function sameOuterDeco(a: ReadonlyArray<Decoration>, b: ReadonlyArray<Decoration>) {
  return a.length == b.length && a.every((deco, i) => deco.type.eq(b[i].type))
}

// Remove a DOM node and return its next sibling.
function rm(dom: DOMNode) {
  const next = dom.nextSibling
  dom.parentNode?.removeChild(dom)
  return next
}

// Helper class for incrementally updating a tree of mark descs and
// the widget and node descs inside of them.
class ViewTreeUpdater {
  // Index into `this.top`'s child array, represents the current
  // update position.
  index = 0
  // When entering a mark, the current top and index are pushed
  // onto this.
  stack: Array<ViewDesc | number> = []
  // Tracks whether anything was changed
  changed = false
  preMatch: { index: number; matched: WeakMap<ViewDesc, number>; matches: ReadonlyArray<ViewDesc> }
  top: ViewDesc

  constructor(
    top: NodeViewDesc,
    readonly lock: Option.Option<DOMNode>,
    private readonly view: AnyView
  ) {
    this.top = top
    this.preMatch = preMatch(top.node.content, top)
  }

  // Destroy and remove the children between the given indices in
  // `this.top`.
  destroyBetween(start: number, end: number) {
    if (start == end) return
    this.top.children.splice(start, end - start).forEach((child) => child.destroy())
    this.changed = true
  }

  // Destroy all remaining children in `this.top`.
  destroyRest() {
    this.destroyBetween(this.index, this.top.children.length)
  }

  // Sync the current stack of mark descs with the given array of
  // marks, reusing existing mark descs when possible.
  syncToMarks(marks: ReadonlyArray<Mark<any, any>>, inline: boolean, view: AnyView, parentIndex: number) {
    let keep = 0,
      depth = this.stack.length >> 1
    const maxKeep = Math.min(depth, marks.length)
    // Runs for each child on every render, so it stays a plain loop.
    // oxlint-disable-next-line effect/imperative-loops
    while (
      keep < maxKeep &&
      // SAFETY: `stack` alternates descs (even indices) and child indices (odd).
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      (keep == depth - 1 ? this.top : (this.stack[(keep + 1) << 1] as ViewDesc)).matchesMark(marks[keep]) &&
      marks[keep].type.spec.spanning !== false
    ) {
      keep++
    }

    // oxlint-disable-next-line effect/imperative-loops
    while (keep < depth) {
      this.destroyRest()
      this.top.dirty = NOT_DIRTY
      // SAFETY: `stack` holds (desc, index) pairs, pushed desc first.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      this.index = this.stack.pop() as number
      // SAFETY: as above.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      this.top = this.stack.pop() as ViewDesc
      depth--
    }
    // oxlint-disable-next-line effect/imperative-loops
    while (depth < marks.length) {
      this.stack.push(this.top, this.index + 1)
      let found = -1,
        scanTo = this.top.children.length
      if (parentIndex < this.preMatch.index) scanTo = Math.min(this.index + 3, scanTo)
      // oxlint-disable-next-line effect/imperative-loops
      for (let i = this.index; i < scanTo; i++) {
        const next = this.top.children[i]
        if (next.matchesMark(marks[depth]) && !this.isLocked(next.dom)) {
          found = i
          break
        }
      }
      // When nothing matches, try to update the mark view at this position
      // in place, so a custom mark view can adapt to a changed mark without
      // re-creating its DOM (prosemirror-view 1.42.0).
      const cur = this.top.children.at(this.index),
        want = marks.at(depth)
      if (found < 0 && want) {
        if (
          cur instanceof MarkViewDesc &&
          cur.dirty != NODE_DIRTY &&
          cur.mark.type == want.type &&
          cur.spec.update &&
          !this.isLocked(cur.dom) &&
          cur.spec.update(want)
        ) {
          cur.mark = want
          found = this.index
          this.changed = true
        }
      }
      if (found > -1) {
        if (found > this.index) {
          this.changed = true
          this.destroyBetween(this.index, found)
        }
        this.top = this.top.children[this.index]
      } else {
        const markDesc = MarkViewDesc.create(this.top, marks[depth], inline, view)
        this.top.children.splice(this.index, 0, markDesc)
        this.top = markDesc
        this.changed = true
      }
      this.index = 0
      depth++
    }
  }

  // Try to find a node desc matching the given data. Skip over it and
  // return true when successful.
  findNodeMatch(
    node: Node<any, any>,
    outerDeco: ReadonlyArray<Decoration>,
    innerDeco: DecorationSource,
    index: number
  ): boolean {
    let found = -1,
      targetDesc
    if (
      index >= this.preMatch.index &&
      Option.exists((targetDesc = this.preMatch.matches[index - this.preMatch.index]).parent, (p) => p == this.top) &&
      targetDesc.matchesNode(node, outerDeco, innerDeco)
    ) {
      found = this.top.children.indexOf(targetDesc, this.index)
    } else {
      // Runs for each child on every render, so it stays a plain loop.
      // oxlint-disable-next-line effect/imperative-loops
      for (let i = this.index, e = Math.min(this.top.children.length, i + 5); i < e; i++) {
        const child = this.top.children[i]
        if (child.matchesNode(node, outerDeco, innerDeco) && !this.preMatch.matched.has(child)) {
          found = i
          break
        }
      }
    }
    if (found < 0) return false
    this.destroyBetween(this.index, found)
    this.index++
    return true
  }

  updateNodeAt(
    node: Node<any, any>,
    outerDeco: ReadonlyArray<Decoration>,
    innerDeco: DecorationSource,
    index: number,
    view: AnyView
  ) {
    // SAFETY: callers pass the index of a node desc found by `findNodeMatch`.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const child = this.top.children[index] as NodeViewDesc
    if (child.dirty == NODE_DIRTY && Option.exists(child.contentDOM, (dom) => dom == child.dom))
      child.dirty = CONTENT_DIRTY
    if (!child.update(node, outerDeco, innerDeco, view)) return false
    this.destroyBetween(this.index, index)
    this.index++
    return true
  }

  findIndexWithChild(domNode: DOMNode): number {
    const parent = domNode.parentNode
    if (!parent) return -1
    if (!Option.exists(this.top.contentDOM, (dom) => dom == parent)) return this.findIndexWithChild(parent)
    const desc = domNode.pmViewDesc
    return desc ? this.top.children.indexOf(desc, this.index) : -1
  }

  // Try to update the next node, if any, to the given data. Checks
  // pre-matches to avoid overwriting nodes that could still be used.
  updateNextNode(
    node: Node<any, any>,
    outerDeco: ReadonlyArray<Decoration>,
    innerDeco: DecorationSource,
    view: AnyView,
    index: number,
    pos: number
  ): boolean {
    // Runs for each child on every render, so it stays a plain loop.
    // oxlint-disable-next-line effect/imperative-loops
    for (let i = this.index; i < this.top.children.length; i++) {
      const next = this.top.children[i]
      if (next instanceof NodeViewDesc) {
        const matchedIndex = this.preMatch.matched.get(next)
        if (matchedIndex != null && matchedIndex != index) return false
        const nextDOM = next.dom
        let updated

        // Can't update if nextDOM is or contains this.lock, except if
        // it's a text node whose content already matches the new text
        // and whose decorations match the new ones.
        const locked =
          this.isLocked(nextDOM) &&
          !(
            node.isText &&
            next.node.isText &&
            next.nodeDOM.nodeValue == textOf(node) &&
            next.dirty != NODE_DIRTY &&
            sameOuterDeco(outerDeco, next.outerDeco)
          )
        if (!locked && next.update(node, outerDeco, innerDeco, view)) {
          this.destroyBetween(this.index, i)
          if (next.dom != nextDOM) this.changed = true
          this.index++
          return true
        } else if (
          !locked &&
          Option.isSome((updated = this.recreateWrapper(next, node, outerDeco, innerDeco, view, pos)))
        ) {
          const wrapper = updated.value
          this.destroyBetween(this.index, i)
          this.top.children[this.index] = wrapper
          if (Option.isSome(wrapper.contentDOM)) {
            wrapper.dirty = CONTENT_DIRTY
            wrapper.updateChildren(view, pos + 1)
            wrapper.dirty = NOT_DIRTY
          }
          this.changed = true
          this.index++
          return true
        }
        break
      }
    }
    return false
  }

  // When a node with content is replaced by a different node with
  // identical content, move over its children.
  recreateWrapper(
    next: NodeViewDesc,
    node: Node<any, any>,
    outerDeco: ReadonlyArray<Decoration>,
    innerDeco: DecorationSource,
    view: AnyView,
    pos: number
  ): Option.Option<NodeViewDesc> {
    if (
      next.dirty ||
      node.isAtom ||
      !next.children.length ||
      !next.node.content.eq(node.content) ||
      !sameOuterDeco(outerDeco, next.outerDeco) ||
      !innerDeco.eq(next.innerDeco)
    )
      return Option.none()
    const wrapper = NodeViewDesc.create(Option.some(this.top), node, outerDeco, innerDeco, view, pos)
    if (Option.isSome(wrapper.contentDOM)) {
      wrapper.children = next.children
      next.children = []
      const parent = Option.some(wrapper)
      wrapper.children.forEach((ch) => (ch.parent = parent))
    }
    next.destroy()
    return Option.some(wrapper)
  }

  // Insert the node as a newly created node desc.
  addNode(
    node: Node<any, any>,
    outerDeco: ReadonlyArray<Decoration>,
    innerDeco: DecorationSource,
    view: AnyView,
    pos: number
  ) {
    const desc = NodeViewDesc.create(Option.some(this.top), node, outerDeco, innerDeco, view, pos)
    if (Option.isSome(desc.contentDOM)) desc.updateChildren(view, pos + 1)
    this.top.children.splice(this.index++, 0, desc)
    this.changed = true
  }

  placeWidget(widget: Decoration, view: AnyView, pos: number) {
    const next = this.index < this.top.children.length ? this.top.children[this.index] : undefined
    if (
      next instanceof WidgetViewDesc &&
      next.matchesWidget(widget) &&
      (widget == next.widget || isDetachedWidget(next.widget))
    ) {
      this.index++
    } else {
      const desc = new WidgetViewDesc(this.top, widget, view, pos)
      this.top.children.splice(this.index++, 0, desc)
      this.changed = true
    }
  }

  // Make sure a textblock looks and behaves correctly in
  // contentEditable.
  addTextblockHacks() {
    const [parent, last] = lastInMarks(this.top, Arr.get(this.top.children, this.index - 1))
    const lastChild = Option.getOrUndefined(last)

    if (
      !lastChild || // Empty textblock
      !(lastChild instanceof TextViewDesc) ||
      textOf(lastChild.node).endsWith("\n") ||
      (this.view.requiresGeckoHackNode && /\s$/.test(textOf(lastChild.node)))
    ) {
      // Avoid bugs in Safari's cursor drawing and Chrome's mouse selection
      if (
        (browser.safari || browser.chrome) &&
        lastChild &&
        isElt(lastChild.dom) &&
        lastChild.dom.contentEditable == "false"
      ) {
        this.addHackNode("IMG", parent)
      }
      this.addHackNode("BR", this.top)
    }
  }

  addHackNode(nodeName: string, parent: ViewDesc) {
    if (
      parent == this.top &&
      this.index < parent.children.length &&
      parent.children[this.index].matchesHack(nodeName)
    ) {
      this.index++
    } else {
      const dom = document.createElement(nodeName)
      if (nodeName == "IMG") {
        dom.className = "ProseMirror-separator"
        dom.setAttribute("alt", "")
      }
      if (nodeName == "BR") dom.className = "ProseMirror-trailingBreak"
      const hack = new BufferHackViewDesc(Option.some(this.top), [], dom, Option.none())
      if (parent != this.top) parent.children.push(hack)
      else parent.children.splice(this.index++, 0, hack)
      this.changed = true
    }
  }

  isLocked(node: DOMNode): boolean {
    if (Option.isNone(this.lock)) return false
    const lock = this.lock.value
    return node == lock || (node.nodeType == 1 && node.contains(lock.parentNode))
  }
}

// Iterate from the end of the fragment and array of descs to find
// directly matching ones, in order to avoid overeagerly reusing those
// for other nodes.
interface PreMatch {
  // The fragment index of the first node that is part of the sequence
  // of matched nodes at the end of the fragment.
  readonly index: number
  // A map from matched descs to fragment indices.
  readonly matched: WeakMap<ViewDesc, number>
  // The matched descs.
  readonly matches: ReadonlyArray<ViewDesc>
}

function preMatch(frag: Fragment<any, any>, parentDesc: ViewDesc): PreMatch {
  let curDesc = parentDesc,
    descI = curDesc.children.length
  let fI = frag.childCount
  const matched = new WeakMap<ViewDesc, number>(),
    matches: Array<ViewDesc> = []
  // Runs for each child on every render, so it stays a plain loop.
  // oxlint-disable-next-line effect/imperative-loops
  outer: while (fI > 0) {
    let desc: ViewDesc
    // oxlint-disable-next-line effect/imperative-loops
    for (;;) {
      if (descI) {
        const next = curDesc.children[descI - 1]
        if (next instanceof MarkViewDesc) {
          curDesc = next
          descI = next.children.length
        } else {
          desc = next
          descI--
          break
        }
      } else if (curDesc == parentDesc) {
        break outer
      } else {
        if (Option.isNone(curDesc.parent)) break outer
        const parent = curDesc.parent.value
        descI = parent.children.indexOf(curDesc)
        curDesc = parent
      }
    }
    if (!desc.isNode()) continue
    if (desc.node != frag.content[fI - 1]) break
    --fI
    matched.set(desc, fI)
    matches.push(desc)
  }
  return { index: fI, matched, matches: matches.reverse() }
}

const bySide: Order.Order<Decoration> = (a, b) => Order.Number(widgetType(a).side, widgetType(b).side)

// This function abstracts iterating over the nodes and decorations in
// a fragment. Calls `onNode` for each node, with its local and child
// decorations. Splits text nodes when there is a decoration starting
// or ending inside of them. Calls `onWidget` for each widget.
function iterDeco(
  parent: Node<any, any>,
  deco: DecorationSource,
  onWidget: (widget: Decoration, index: number, insideNode: boolean) => void,
  onNode: (
    node: Node<any, any>,
    outerDeco: ReadonlyArray<Decoration>,
    innerDeco: DecorationSource,
    index: number
  ) => void
) {
  const locals = deco.locals(parent)
  let offset = 0
  // Simple, cheap variant for when there are no local decorations
  if (Arr.isReadonlyArrayEmpty(locals)) {
    // Runs for each child on every render, so it stays a plain loop.
    // oxlint-disable-next-line effect/imperative-loops
    for (let i = 0; i < parent.childCount; i++) {
      const child = parent.content.content[i]
      onNode(child, locals, deco.forChild(offset, child), i)
      offset += child.nodeSize
    }
    return
  }

  let decoIndex = 0,
    // The rest of a text node cut at a decoration boundary, still to be drawn.
    restNode = Option.none<Node<any, any>>()
  const active: Array<Decoration> = []
  const widgets: Array<Decoration> = []
  // oxlint-disable-next-line effect/imperative-loops
  for (let parentIndex = 0; ;) {
    // oxlint-disable-next-line effect/imperative-loops
    while (decoIndex < locals.length && locals[decoIndex].to == offset) {
      const next = locals[decoIndex++]
      if (next.widget) widgets.push(next)
    }
    if (widgets.length) {
      const insideNode = Option.isSome(restNode)
      if (widgets.length > 1) {
        const sorted = Arr.sort(widgets, bySide)
        // oxlint-disable-next-line effect/imperative-loops
        for (let i = 0; i < sorted.length; i++) onWidget(sorted[i], parentIndex, insideNode)
      } else {
        onWidget(widgets[0], parentIndex, insideNode)
      }
      widgets.length = 0
    }

    let child: Node<any, any>, index
    if (Option.isSome(restNode)) {
      index = -1
      child = restNode.value
      restNode = Option.none()
    } else if (parentIndex < parent.childCount) {
      index = parentIndex
      child = parent.content.content[parentIndex++]
    } else {
      break
    }

    // oxlint-disable-next-line effect/imperative-loops
    for (let i = 0; i < active.length; i++) if (active[i].to <= offset) active.splice(i--, 1)
    // oxlint-disable-next-line effect/imperative-loops
    while (decoIndex < locals.length && locals[decoIndex].from <= offset && locals[decoIndex].to > offset) {
      active.push(locals[decoIndex++])
    }

    let end = offset + child.nodeSize
    if (child.isText) {
      let cutAt = end
      if (decoIndex < locals.length && locals[decoIndex].from < cutAt) cutAt = locals[decoIndex].from
      // oxlint-disable-next-line effect/imperative-loops
      for (let i = 0; i < active.length; i++) if (active[i].to < cutAt) cutAt = active[i].to
      if (cutAt < end) {
        restNode = Option.some(child.cut(cutAt - offset))
        child = child.cut(0, cutAt - offset)
        end = cutAt
        index = -1
      }
    } else {
      // oxlint-disable-next-line effect/imperative-loops
      while (decoIndex < locals.length && locals[decoIndex].to < end) decoIndex++
    }

    const outerDeco = child.isInline && !child.isLeaf ? active.filter((d) => !d.inline) : active.slice()
    onNode(child, outerDeco, deco.forChild(offset, child), index)
    offset = end
  }
}

// List markers in Mobile Safari will mysteriously disappear
// sometimes. This works around that.
function iosHacks(dom: HTMLElement) {
  if (dom.nodeName == "UL" || dom.nodeName == "OL") {
    const oldCSS = dom.style.cssText
    dom.style.cssText = oldCSS + "; list-style: square !important"
    void window.getComputedStyle(dom).listStyle
    dom.style.cssText = oldCSS
  }
}

// Find a piece of text in an inline fragment, overlapping from-to
function findTextInFragment(frag: Fragment<any, any>, text: string, from: number, to: number): number {
  return findTextFrom(frag, text, from, to, 0, 0)
}

function findTextFrom(
  frag: Fragment<any, any>,
  text: string,
  from: number,
  to: number,
  i: number,
  start: number
): number {
  if (i >= frag.childCount || start > to) return -1
  const child = frag.content[i],
    childStart = start
  if (!child.isText) return findTextFrom(frag, text, from, to, i + 1, start + child.nodeSize)
  // Join the run of text nodes starting at `child`, stepping past the node that ends it.
  const [next, pos, str] = textRun(frag, i + 1, start + child.nodeSize, textOf(child))
  if (pos >= from) {
    if (pos >= to && str.slice(to - text.length - childStart, to - childStart) == text) {
      return to - text.length
    }
    const found = childStart < to ? str.lastIndexOf(text, to - childStart - 1) : -1
    if (found >= 0 && found + text.length + childStart >= from) {
      return childStart + found
    }
    if (
      from == to &&
      str.length >= to + text.length - childStart &&
      str.slice(to - childStart, to - childStart + text.length) == text
    ) {
      return to
    }
  }
  return findTextFrom(frag, text, from, to, next, pos)
}

function textRun(frag: Fragment<any, any>, i: number, pos: number, str: string): readonly [number, number, string] {
  if (i >= frag.childCount) return [i, pos, str]
  const next = frag.content[i]
  const end = pos + next.nodeSize
  return next.isText ? textRun(frag, i + 1, end, str + textOf(next)) : [i + 1, end, str]
}

// Replace range from-to in an array of view descs with replacement
// (may be null to just delete). This goes very much against the grain
// of the rest of this code, which tends to create nodes with the
// right shape in one go, rather than messing with them after
// creation, but is necessary in the composition hack.
function replaceNodes(nodes: ReadonlyArray<ViewDesc>, from: number, to: number, view: AnyView, replacement?: ViewDesc) {
  const result: Array<ViewDesc> = []
  let off = 0
  nodes.forEach((child) => {
    const start = off,
      end = (off += child.size)
    if (start >= to || end <= from) {
      result.push(child)
    } else {
      if (start < from) {
        // SAFETY: only composition text, inside mark and text descs, is replaced, so only those are cut.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        result.push((child as MarkViewDesc | TextViewDesc).slice(0, from - start, view))
      }
      if (replacement) {
        result.push(replacement)
        replacement = undefined
      }
      if (end > to) {
        // SAFETY: as above.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        result.push((child as MarkViewDesc | TextViewDesc).slice(to - start, child.size, view))
      }
    }
  })
  return result
}

// Whether `node` reaches `top` by climbing through nodes with no sibling on `side`.
function reachesAlongEdge(node: DOMNode, top: DOMNode, side: number): boolean {
  if (node == top) return true
  if (side < 0 ? node.previousSibling : node.nextSibling) return false
  return !!node.parentNode && reachesAlongEdge(node.parentNode, top, side)
}

// The next sibling of `node` or of its nearest ancestor that has one, inside its block.
function siblingAfterInBlock(node: DOMNode): Option.Option<ChildNode> {
  if (node.nextSibling) return Option.some(node.nextSibling)
  const desc = node.pmViewDesc
  if (desc && desc.isNode() && desc.node.isBlock) return Option.none()
  return node.parentNode ? siblingAfterInBlock(node.parentNode) : Option.none()
}

function markDirtyUp(desc: ViewDesc, dirty: number): void {
  if (desc.dirty < dirty) desc.dirty = dirty
  if (Option.isSome(desc.parent)) markDirtyUp(desc.parent.value, CHILD_DIRTY)
}

// The nearest of `desc` and its ancestors that describes a node.
function withNodeDesc(desc: ViewDesc): Option.Option<NodeViewDesc> {
  if (desc.isNode()) return Option.some(desc)
  return Option.flatMap(desc.parent, withNodeDesc)
}

// The nearest of `node` and its ancestors that is `stop` or a decoration wrapper.
function wrapperFrom(node: ParentNode, stop: DOMNode): Option.Option<ParentNode> {
  if (node == stop || isDecoWrapper(node)) return Option.some(node)
  return node.parentNode ? wrapperFrom(node.parentNode, stop) : Option.none()
}

// Descend through trailing mark descs to the desc they end with, and its parent.
function lastInMarks(parent: ViewDesc, child: Option.Option<ViewDesc>): readonly [ViewDesc, Option.Option<ViewDesc>] {
  return Option.isSome(child) && child.value instanceof MarkViewDesc
    ? lastInMarks(child.value, Arr.last(child.value.children))
    : [parent, child]
}
