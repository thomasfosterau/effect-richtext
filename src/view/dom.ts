// Ported from prosemirror-view (MIT, Marijn Haverbeke and others)
/**
 * DOM helpers.
 *
 * @internal
 */
import * as Option from "effect/Option"
import type { ViewDesc } from "./viewdesc.ts"

declare global {
  interface Node {
    /** @internal */
    pmViewDesc?: ViewDesc
  }
}

/** @internal */
export type DOMNode = globalThis.Node
/** @internal */
export type DOMSelection = globalThis.Selection
/** @internal */
export type DOMSelectionRange = Pick<DOMSelection, "focusNode" | "focusOffset" | "anchorNode" | "anchorOffset">

/** @internal */
export const domIndex = function (node: DOMNode): number {
  const parent = node.parentNode
  return parent ? Array.prototype.indexOf.call(parent.childNodes, node) : 0
}

/** @internal */
export const parentNode = function (node: DOMNode): Option.Option<DOMNode> {
  // Elements and text nodes are the slottable ones.
  const slot = isElt(node) || isText(node) ? node.assignedSlot : null
  const parent = slot || node.parentNode
  if (!parent) return Option.none()
  if (parent.nodeType != 11) return Option.some(parent)
  return isShadowRoot(parent) ? Option.some(parent.host) : Option.none()
}

/**
 * `node` and its ancestors (crossing shadow roots), innermost first.
 *
 * @internal
 */
export function ancestors(node: DOMNode): Array<DOMNode> {
  const parent = parentNode(node)
  return Option.isSome(parent) ? [node, ...ancestors(parent.value)] : [node]
}

let reusedRange: Option.Option<Range> = Option.none()

// Note that this will always return the same range, because DOM range
// objects are every expensive, and keep slowing down subsequent DOM
// updates, for some reason.
/** @internal */
export const textRange = function (node: Text, from?: number, to?: number): Range {
  const range = Option.getOrElse(reusedRange, () => {
    const created = document.createRange()
    reusedRange = Option.some(created)
    return created
  })
  range.setEnd(node, to == null ? node.data.length : to)
  range.setStart(node, from || 0)
  return range
}

/** @internal */
export const clearReusedRange = function (): void {
  reusedRange = Option.none()
}

// Scans forward and backward through DOM positions equivalent to the
// given one to see if the two are in the same place (i.e. after a
// text node vs at the end of that text node)
/** @internal */
export const isEquivalentPosition = function (
  node: DOMNode,
  off: number,
  targetNode: DOMNode,
  targetOff: number
): boolean {
  return !!targetNode && (scanFor(node, off, targetNode, targetOff, -1) || scanFor(node, off, targetNode, targetOff, 1))
}

const atomElements = /^(img|br|input|textarea|hr)$/i

function scanFor(node: DOMNode, off: number, targetNode: DOMNode, targetOff: number, dir: number): boolean {
  if (node == targetNode && off == targetOff) return true
  if (off == (dir < 0 ? 0 : nodeSize(node))) {
    const parent = node.parentNode
    if (
      !parent ||
      parent.nodeType != 1 ||
      hasBlockDesc(node) ||
      atomElements.test(node.nodeName) ||
      (isElt(node) && node.contentEditable == "false")
    ) {
      return false
    }
    return scanFor(parent, domIndex(node) + (dir < 0 ? 0 : 1), targetNode, targetOff, dir)
  }
  if (node.nodeType != 1) return false
  const child = node.childNodes[off + (dir < 0 ? -1 : 0)]
  if (isElt(child) && child.contentEditable == "false") {
    return !!child.pmViewDesc?.ignoreForSelection && scanFor(node, off + dir, targetNode, targetOff, dir)
  }
  return scanFor(child, dir < 0 ? nodeSize(child) : 0, targetNode, targetOff, dir)
}

/** @internal */
export function nodeSize(node: DOMNode): number {
  return node.nodeType == 3 ? (node.nodeValue ?? "").length : node.childNodes.length
}

/** @internal */
export function isElt(node: DOMNode): node is HTMLElement {
  return node.nodeType == 1
}

/** @internal */
export function isDOMNode(target: EventTarget): target is DOMNode {
  return "nodeType" in target
}

/** @internal */
export function isDocument(node: DOMNode): node is Document {
  return node.nodeType == 9
}

// `EditorView.root` gives a shadow root `getSelection` when it lacks one.
/** @internal */
export function selectionOf(root: Document | ShadowRoot): Option.Option<DOMSelection> {
  return "getSelection" in root ? Option.fromNullOr(root.getSelection()) : Option.none()
}

/** @internal */
export function isShadowRoot(node: DOMNode): node is ShadowRoot {
  return node.nodeType == 11 && "host" in node
}

/** @internal */
export function isText(node: DOMNode): node is Text {
  return node.nodeType == 3
}

/** @internal */
export function textNodeBefore(node: DOMNode, offset: number): Option.Option<Text> {
  if (isText(node) && offset) return Option.some(node)
  if (isElt(node) && offset > 0) {
    if (node.contentEditable == "false") return Option.none()
    const child = node.childNodes[offset - 1]
    return textNodeBefore(child, nodeSize(child))
  }
  if (node.parentNode && !hasBlockDesc(node)) return textNodeBefore(node.parentNode, domIndex(node))
  return Option.none()
}

/** @internal */
export function textNodeAfter(node: DOMNode, offset: number): Option.Option<Text> {
  if (isText(node) && offset < node.data.length) return Option.some(node)
  if (isElt(node) && offset < node.childNodes.length) {
    if (node.contentEditable == "false") return Option.none()
    return textNodeAfter(node.childNodes[offset], 0)
  }
  if (node.parentNode && !hasBlockDesc(node)) return textNodeAfter(node.parentNode, domIndex(node) + 1)
  return Option.none()
}

/** @internal */
export function isOnEdge(node: DOMNode, offset: number, parent: DOMNode): boolean {
  return onEdgeOf(node, offset == 0, offset == nodeSize(node), parent)
}

// Whether `node` is `parent`, or the start (end) of an ancestor chain up
// to it, keeping whichever of `atStart` and `atEnd` still holds.
function onEdgeOf(node: DOMNode, atStart: boolean, atEnd: boolean, parent: DOMNode): boolean {
  if (!atStart && !atEnd) return false
  if (node == parent) return true
  const index = domIndex(node)
  const up = node.parentNode
  if (!up) return false
  return onEdgeOf(up, atStart && index == 0, atEnd && index == nodeSize(up), parent)
}

/** @internal */
export function hasBlockDesc(dom: DOMNode): boolean {
  const desc = Option.getOrUndefined(closestDesc(dom))
  return (
    !!desc &&
    desc.isNode() &&
    desc.node.isBlock &&
    (desc.dom == dom || Option.exists(desc.contentDOM, (content) => content == dom))
  )
}

// Work around Chrome issue https://bugs.chromium.org/p/chromium/issues/detail?id=447523
// (isCollapsed inappropriately returns true in shadow dom)
/** @internal */
export const selectionCollapsed = function (domSel: DOMSelectionRange): boolean {
  return (
    !!domSel.focusNode &&
    !!domSel.anchorNode &&
    isEquivalentPosition(domSel.focusNode, domSel.focusOffset, domSel.anchorNode, domSel.anchorOffset)
  )
}

/** @internal */
export function keyEvent(keyCode: number, key: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key, code: key, keyCode })
  // Not every engine takes `keyCode` from the init dictionary.
  if (event.keyCode !== keyCode) Object.defineProperty(event, "keyCode", { value: keyCode })
  return event
}

/** @internal */
export function deepActiveElement(doc: Document): Option.Option<Element> {
  const elt = doc.activeElement
  return elt ? activeIn(elt) : Option.none()
}

function activeIn(elt: Element): Option.Option<Element> {
  if (!elt.shadowRoot) return Option.some(elt)
  const inner = elt.shadowRoot.activeElement
  return inner ? activeIn(inner) : Option.none()
}

// The view description of `dom` or its nearest ancestor that has one.
function closestDesc(dom: DOMNode): Option.Option<ViewDesc> {
  if (dom.pmViewDesc) return Option.some(dom.pmViewDesc)
  return dom.parentNode ? closestDesc(dom.parentNode) : Option.none()
}

/** @internal */
export function caretFromPoint(
  doc: Document,
  x: number,
  y: number
): Option.Option<{ readonly node: DOMNode; readonly offset: number }> {
  if (doc.caretPositionFromPoint) {
    try {
      // Firefox throws for this call in hard-to-predict circumstances
      const pos = doc.caretPositionFromPoint(x, y)
      // Clip the offset, because Chrome will return a text offset
      // into <input> nodes, which can't be treated as a regular DOM
      // offset
      if (pos) return Option.some({ node: pos.offsetNode, offset: Math.min(nodeSize(pos.offsetNode), pos.offset) })
    } catch {
      // ignore
    }
  }
  if (doc.caretRangeFromPoint) {
    const range = doc.caretRangeFromPoint(x, y)
    if (range) {
      return Option.some({
        node: range.startContainer,
        offset: Math.min(nodeSize(range.startContainer), range.startOffset)
      })
    }
  }
  return Option.none()
}
