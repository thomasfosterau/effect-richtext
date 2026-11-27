// Ported from prosemirror-view (MIT, Marijn Haverbeke and others)
/**
 * Coordinate and scrolling helpers.
 *
 * @internal
 */
import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import type { EditorState } from "../State.ts"
import * as browser from "./browser.ts"
import { ancestors, caretFromPoint, type DOMNode, isElt, isText, nodeSize, parentNode, textRange } from "./dom.ts"
import { ViewError } from "./errors.ts"
import type { EditorView } from "./view.ts"

type AnyView = EditorView<any, any, any>

/**
 * A rectangle in viewport coordinates.
 *
 * @since 0.1.0
 * @category models
 */
export type Rect = { left: number; right: number; top: number; bottom: number }

function windowRect(doc: Document): Rect {
  const vp = doc.defaultView && doc.defaultView.visualViewport
  if (vp) {
    return {
      left: 0,
      right: vp.width,
      top: 0,
      bottom: vp.height
    }
  }
  return {
    left: 0,
    right: doc.documentElement.clientWidth,
    top: 0,
    bottom: doc.documentElement.clientHeight
  }
}

function getSide(value: number | Rect, side: keyof Rect): number {
  return Predicate.isNumber(value) ? value : value[side]
}

function clientRect(node: HTMLElement): Rect {
  const rect = node.getBoundingClientRect()
  // Adjust for elements with style "transform: scale()"
  const scaleX = rect.width / node.offsetWidth || 1
  const scaleY = rect.height / node.offsetHeight || 1
  // Make sure scrollbar width isn't included in the rectangle
  return {
    left: rect.left,
    right: rect.left + node.clientWidth * scaleX,
    top: rect.top,
    bottom: rect.top + node.clientHeight * scaleY
  }
}

/** @internal */
export function scrollRectIntoView(view: AnyView, startRect: Rect, startDOM: DOMNode): void {
  // Skip empty rects with all sides at 0, for example when the element
  // has no CSS box (display: none) (prosemirror-view 1.42.1).
  if (!nonZero(startRect) && startRect.left == 0) return

  const scrollThreshold = view.someProp("scrollThreshold") || 0,
    scrollMargin = view.someProp("scrollMargin") || 5
  const doc = view.dom.ownerDocument
  // Scroll each scrollable ancestor in turn, stopping at a fixed or sticky one.
  const scrollFrom = (parent: DOMNode | null, rect: Rect): void => {
    if (!parent) return
    if (!isElt(parent)) return scrollFrom(parentNode(parent), rect)
    const elt: HTMLElement = parent
    const atTop = elt == doc.body
    const bounding = atTop ? windowRect(doc) : clientRect(elt)
    let moveX = 0,
      moveY = 0
    if (rect.top < bounding.top + getSide(scrollThreshold, "top")) {
      moveY = -(bounding.top - rect.top + getSide(scrollMargin, "top"))
    } else if (rect.bottom > bounding.bottom - getSide(scrollThreshold, "bottom")) {
      moveY =
        rect.bottom - rect.top > bounding.bottom - bounding.top
          ? rect.top + getSide(scrollMargin, "top") - bounding.top
          : rect.bottom - bounding.bottom + getSide(scrollMargin, "bottom")
    }
    if (rect.left < bounding.left + getSide(scrollThreshold, "left")) {
      moveX = -(bounding.left - rect.left + getSide(scrollMargin, "left"))
    } else if (rect.right > bounding.right - getSide(scrollThreshold, "right")) {
      moveX = rect.right - bounding.right + getSide(scrollMargin, "right")
    }
    let next = rect
    if (moveX || moveY) {
      if (atTop) {
        doc.defaultView?.scrollBy(moveX, moveY)
      } else {
        const startX = elt.scrollLeft,
          startY = elt.scrollTop
        if (moveY) elt.scrollTop += moveY
        if (moveX) elt.scrollLeft += moveX
        const dX = elt.scrollLeft - startX,
          dY = elt.scrollTop - startY
        next = { left: rect.left - dX, top: rect.top - dY, right: rect.right - dX, bottom: rect.bottom - dY }
      }
    }
    const pos: string = atTop ? "fixed" : getComputedStyle(elt).position
    if (/^(fixed|sticky)$/.test(pos)) return
    scrollFrom(pos == "absolute" ? elt.offsetParent : parentNode(elt), next)
  }
  scrollFrom(startDOM || view.dom, startRect)
}

/** @internal */
export type ScrollPos = {
  ref: Option.Option<{ readonly dom: Element; readonly top: number }>
  stack: Array<{ dom: HTMLElement; top: number; left: number }>
}

// Store the scroll position of the editor's parent nodes, along with
// the top position of an element near the top of the editor, which
// will be used to make sure the visible viewport remains stable even
// when the size of the content above changes.
/** @internal */
export function storeScrollPos(view: AnyView): ScrollPos {
  const rect = view.dom.getBoundingClientRect(),
    startY = Math.max(0, rect.top)
  const x = (rect.left + rect.right) / 2
  // Probe every 5 pixels down the middle of the editor.
  const probes = Array.from(
    { length: Math.max(0, Math.ceil((Math.min(innerHeight, rect.bottom) - startY - 1) / 5)) },
    (_, k) => startY + 1 + k * 5
  )
  const ref: ScrollPos["ref"] = Arr.findFirst(probes, (y) => {
    const dom = view.root.elementFromPoint(x, y)
    if (!dom || dom == view.dom || !view.dom.contains(dom)) return Option.none()
    const localRect = dom.getBoundingClientRect()
    return localRect.top >= startY - 20 ? Option.some({ dom, top: localRect.top }) : Option.none()
  })
  return { ref, stack: scrollStack(view.dom) }
}

function scrollStack(dom: DOMNode): Array<{ dom: HTMLElement; top: number; left: number }> {
  // Only elements scroll; the document and shadow roots have no scroll offsets of their own.
  return (dom == dom.ownerDocument ? [] : ancestors(dom))
    .filter(isElt)
    .map((elt) => ({ dom: elt, top: elt.scrollTop, left: elt.scrollLeft }))
}

// Reset the scroll position of the editor's parent nodes to that what
// it was before, when storeScrollPos was called.
/** @internal */
export function resetScrollPos({ ref, stack }: ScrollPos): void {
  const shift = Option.match(ref, {
    onNone: () => 0,
    onSome: ({ dom, top }) => {
      const newTop = dom.getBoundingClientRect().top
      return newTop == 0 ? 0 : newTop - top
    }
  })
  restoreScrollStack(stack, shift)
}

function restoreScrollStack(stack: Array<{ dom: HTMLElement; top: number; left: number }>, dTop: number) {
  stack.forEach(({ dom, left, top }) => {
    if (dom.scrollTop != top + dTop) dom.scrollTop = top + dTop
    if (dom.scrollLeft != left) dom.scrollLeft = left
  })
}

let preventScrollSupported: false | null | { preventScroll: boolean } = null
// Feature-detects support for .focus({preventScroll: true}), and uses
// a fallback kludge when not supported.
/** @internal */
export function focusPreventScroll(dom: HTMLElement): void {
  const ieDom: HTMLElement & { setActive?: () => void } = dom
  if (ieDom.setActive) return ieDom.setActive() // in IE
  if (preventScrollSupported) return dom.focus(preventScrollSupported)

  const stored = scrollStack(dom)
  dom.focus(
    preventScrollSupported == null
      ? {
          get preventScroll() {
            preventScrollSupported = { preventScroll: true }
            return true
          }
        }
      : undefined
  )
  if (!preventScrollSupported) {
    preventScrollSupported = false
    restoreScrollStack(stored, 0)
  }
}

// A DOM position: a node and an offset into it.
interface DOMOffset {
  readonly node: DOMNode
  readonly offset: number
}

function findOffsetInNode(node: Element, coords: { top: number; left: number }): DOMOffset {
  let closest: DOMNode | undefined,
    dxClosest = 2e8,
    coordsClosest: { left: number; top: number } | undefined
  let offset = 0
  let rowBot = coords.top,
    rowTop = coords.top
  let firstBelow: DOMNode | undefined, coordsBelow: { left: number; top: number } | undefined
  Array.from(node.childNodes).forEach((child, childIndex) => {
    childRects(child).forEach((rect) => {
      if (rect.top <= rowBot && rect.bottom >= rowTop) {
        rowBot = Math.max(rect.bottom, rowBot)
        rowTop = Math.min(rect.top, rowTop)
        const dx =
          rect.left > coords.left ? rect.left - coords.left : rect.right < coords.left ? coords.left - rect.right : 0
        if (dx < dxClosest) {
          closest = child
          dxClosest = dx
          coordsClosest =
            dx && closest.nodeType == 3
              ? {
                  left: rect.right < coords.left ? rect.right : rect.left,
                  top: coords.top
                }
              : coords
          if (child.nodeType == 1 && dx) {
            offset = childIndex + (coords.left >= (rect.left + rect.right) / 2 ? 1 : 0)
          }
          return
        }
      } else if (rect.top > coords.top && !firstBelow && rect.left <= coords.left && rect.right >= coords.left) {
        firstBelow = child
        coordsBelow = { left: Math.max(rect.left, Math.min(rect.right, coords.left)), top: rect.top }
      }
      if (
        !closest &&
        ((coords.left >= rect.right && coords.top >= rect.top) ||
          (coords.left >= rect.left && coords.top >= rect.bottom))
      ) {
        offset = childIndex + 1
      }
    })
  })
  if (!closest && firstBelow) {
    closest = firstBelow
    coordsClosest = coordsBelow
    dxClosest = 0
  }
  if (!closest || !coordsClosest) return { node, offset }
  if (isText(closest)) return findOffsetInText(closest, coordsClosest)
  if (!isElt(closest) || dxClosest) return { node, offset }
  return findOffsetInNode(closest, coordsClosest)
}

// The client rectangles of an element or text node.
function childRects(child: ChildNode): ReadonlyArray<DOMRect> {
  if (isElt(child)) return Array.from(child.getClientRects())
  return isText(child) ? Array.from(textRange(child).getClientRects()) : []
}

function findOffsetInText(node: Text, coords: { top: number; left: number }): DOMOffset {
  const range = document.createRange()
  const offset = Arr.findFirst(
    Array.from({ length: node.data.length }, (_, i) => i),
    (i) => {
      range.setEnd(node, i + 1)
      range.setStart(node, i)
      const rect = singleRect(range, 1)
      return rect.top != rect.bottom && inRect(coords, rect)
        ? Option.some(i + (coords.left >= (rect.left + rect.right) / 2 ? 1 : 0))
        : Option.none()
    }
  )
  range.detach()
  return { node, offset: Option.getOrElse(offset, () => 0) }
}

function inRect(coords: { top: number; left: number }, rect: Rect) {
  return (
    coords.left >= rect.left - 1 &&
    coords.left <= rect.right + 1 &&
    coords.top >= rect.top - 1 &&
    coords.top <= rect.bottom + 1
  )
}

function targetKludge(dom: Element, coords: { top: number; left: number }): Element {
  const parent = dom.parentElement
  if (parent && /^li$/i.test(parent.nodeName) && coords.left < dom.getBoundingClientRect().left) return parent
  return dom
}

function posFromElement(view: AnyView, elt: Element, coords: { top: number; left: number }) {
  const { node, offset } = findOffsetInNode(elt, coords)
  let bias = -1
  if (isElt(node) && !node.firstChild) {
    const rect = node.getBoundingClientRect()
    bias = rect.left != rect.right && coords.left > (rect.left + rect.right) / 2 ? 1 : -1
  }
  return view.docView.posFromDOM(node, offset, bias)
}

function posFromCaret(view: AnyView, node: DOMNode, offset: number, coords: { top: number; left: number }) {
  // Browser (in caretPosition/RangeFromPoint) will agressively
  // normalize towards nearby inline nodes. Since we are interested in
  // positions between block nodes too, we first walk up the hierarchy
  // of nodes to see if there are block nodes that the coordinates
  // fall outside of. If so, we take the position before/after that
  // block. If not, we call `posFromDOM` on the raw node/offset.
  let outsideBlock = -1
  const atEnd = () => Option.some(outsideBlock > -1 ? outsideBlock : view.docView.posFromDOM(node, offset, -1))
  const climb = (cur: DOMNode, sawBlock: boolean): Option.Option<number> => {
    if (cur == view.dom) return atEnd()
    const desc = view.docView.nearestDesc(cur, true)
    let rect,
      saw = sawBlock
    if (!desc) return Option.none()
    if (
      isElt(desc.dom) &&
      ((desc.node.isBlock && desc.parent) || !desc.contentDOM) &&
      // Ignore elements with zero-size bounding rectangles
      ((rect = desc.dom.getBoundingClientRect()).width || rect.height)
    ) {
      if (desc.node.isBlock && desc.parent && !/^T(R|BODY|HEAD|FOOT)$/.test(desc.dom.nodeName)) {
        // Only apply the horizontal test to the innermost block. Vertical for any parent.
        if ((!saw && rect.left > coords.left) || rect.top > coords.top) outsideBlock = desc.posBefore
        else if ((!saw && rect.right < coords.left) || rect.bottom < coords.top) outsideBlock = desc.posAfter
        saw = true
      }
      if (!desc.contentDOM && outsideBlock < 0 && !desc.node.isText) {
        // If we are inside a leaf, return the side of the leaf closer to the coords
        const before = desc.node.isBlock
          ? coords.top < (rect.top + rect.bottom) / 2
          : coords.left < (rect.left + rect.right) / 2
        return Option.some(before ? desc.posBefore : desc.posAfter)
      }
    }
    const up = desc.dom.parentNode
    return up ? climb(up, saw) : atEnd()
  }
  return climb(node, false)
}

function elementFromPoint(element: Element, coords: { top: number; left: number }, box: Rect): Element {
  const len = element.childNodes.length
  if (!len || box.top >= box.bottom) return element
  // Start near the child the point is proportionally at, and wrap around.
  const startI = Math.max(0, Math.min(len - 1, Math.floor((len * (coords.top - box.top)) / (box.bottom - box.top)) - 2))
  const found = Arr.findFirst(
    Arr.makeBy(len, (k) => element.childNodes[(startI + k) % len]),
    (child) =>
      isElt(child)
        ? Option.map(
            Arr.findFirst(Array.from(child.getClientRects()), (rect) => inRect(coords, rect)),
            (rect) => elementFromPoint(child, coords, rect)
          )
        : Option.none()
  )
  return Option.getOrElse(found, () => element)
}

// Given an x,y position on the editor, get the position in the document.
/** @internal */
export function posAtCoords(
  view: AnyView,
  coords: { top: number; left: number }
): { pos: number; inside: number } | null {
  const doc = view.dom.ownerDocument
  let node: DOMNode | undefined,
    offset = 0
  const caret = caretFromPoint(doc, coords.left, coords.top)
  if (caret) ({ node, offset } = caret)

  let elt = ("elementFromPoint" in view.root ? view.root : doc).elementFromPoint(coords.left, coords.top)
  let pos
  if (!elt || !view.dom.contains(elt.nodeType != 1 ? elt.parentNode : elt)) {
    const box = view.dom.getBoundingClientRect()
    if (!inRect(coords, box)) return null
    elt = elementFromPoint(view.dom, coords, box)
    if (!elt) return null
  }
  // Safari's caretRangeFromPoint returns nonsense when on a draggable element
  if (browser.safari) {
    if (ancestors(elt).some((p) => isElt(p) && p.draggable)) node = undefined
  }
  elt = targetKludge(elt, coords)
  if (node) {
    if (browser.gecko && node.nodeType == 1) {
      // Firefox will sometimes return offsets into <input> nodes, which
      // have no actual children, from caretPositionFromPoint
      offset = Math.min(offset, node.childNodes.length)
      // It'll also move the returned position before image nodes,
      // even if those are behind it.
      if (offset < node.childNodes.length) {
        const next = node.childNodes[offset]
        let box
        if (
          next.nodeName == "IMG" &&
          isElt(next) &&
          (box = next.getBoundingClientRect()).right <= coords.left &&
          box.bottom > coords.top
        ) {
          offset++
        }
      }
    }
    let prev
    // When clicking above the right side of an uneditable node, Chrome will report a cursor position after that node.
    if (
      browser.webkit &&
      offset &&
      node.nodeType == 1 &&
      isElt((prev = node.childNodes[offset - 1])) &&
      prev.contentEditable == "false" &&
      prev.getBoundingClientRect().top >= coords.top
    ) {
      offset--
    }
    // Suspiciously specific kludge to work around caret*FromPoint
    // never returning a position at the end of the document
    if (
      node == view.dom &&
      offset == node.childNodes.length - 1 &&
      node.lastChild &&
      isElt(node.lastChild) &&
      coords.top > node.lastChild.getBoundingClientRect().bottom
    ) {
      pos = view.state.doc.content.size
    } // Ignore positions directly after a BR, since caret*FromPoint
    // 'round up' positions that would be more accurately placed
    // before the BR node.
    else if (offset == 0 || node.nodeType != 1 || node.childNodes[offset - 1].nodeName != "BR") {
      pos = Option.getOrUndefined(posFromCaret(view, node, offset, coords))
    }
  }
  if (pos == null) pos = posFromElement(view, elt, coords)

  const desc = view.docView.nearestDesc(elt, true)
  return { pos, inside: desc ? desc.posAtStart - desc.border : -1 }
}

function nonZero(rect: Rect) {
  return rect.top < rect.bottom || rect.left < rect.right
}

function singleRect(target: Element | Range, bias: number): DOMRect {
  const rects = target.getClientRects()
  if (rects.length) {
    const first = rects[bias < 0 ? 0 : rects.length - 1]
    if (nonZero(first)) return first
  }
  return Array.prototype.find.call(rects, nonZero) || target.getBoundingClientRect()
}

const BIDI = /[֐-״؀-ۿ܀-ࢬ]/

// Given a position in the document model, get a bounding box of the
// character at that position, relative to the window.
/** @internal */
export function coordsAtPos(view: AnyView, pos: number, side: number): Rect {
  const { atom, node, offset } = view.docView.domFromPos(pos, side < 0 ? -1 : 1)

  const supportEmptyRange = browser.webkit || browser.gecko
  if (isText(node)) {
    const text = node.data
    // These browsers support querying empty text ranges. Prefer that in
    // bidi context or when at the end of a node.
    if (supportEmptyRange && (BIDI.test(text) || (side < 0 ? !offset : offset == text.length))) {
      const rect = singleRect(textRange(node, offset, offset), side)
      // Firefox returns bad results (the position before the space)
      // when querying a position directly after line-broken
      // whitespace. Detect this situation and and kludge around it
      if (browser.gecko && offset && /\s/.test(text[offset - 1]) && offset < text.length) {
        const rectBefore = singleRect(textRange(node, offset - 1, offset - 1), -1)
        if (rectBefore.top == rect.top) {
          const rectAfter = singleRect(textRange(node, offset, offset + 1), -1)
          if (rectAfter.top != rect.top) {
            return flattenV(rectAfter, rectAfter.left < rectBefore.left)
          }
        }
      }
      return rect
    } else {
      let from = offset,
        to = offset,
        takeSide = side < 0 ? 1 : -1
      if (side < 0 && !offset) {
        to++
        takeSide = -1
      } else if (side >= 0 && offset == text.length) {
        from--
        takeSide = 1
      } else if (side < 0) {
        from--
      } else {
        to++
      }
      return flattenV(singleRect(textRange(node, from, to), takeSide), takeSide < 0)
    }
  }

  const $dom = view.state.doc.resolveUnsafe(pos - (atom || 0))
  // Return a horizontal line in block context
  if (!$dom.parent.inlineContent) {
    if (atom == null && offset && (side < 0 || offset == nodeSize(node))) {
      const before = node.childNodes[offset - 1]
      if (isElt(before)) return flattenH(before.getBoundingClientRect(), false)
    }
    if (atom == null && offset < nodeSize(node)) {
      const after = node.childNodes[offset]
      if (isElt(after)) return flattenH(after.getBoundingClientRect(), true)
    }
    // Outside a text node, `domFromPos` returns a position in an element.
    if (!isElt(node)) throw new ViewError({ message: "Expected an element at position " + pos })
    return flattenH(node.getBoundingClientRect(), side >= 0)
  }

  // Inline, not in text node (this is not Bidi-safe)
  if (atom == null && offset && (side < 0 || offset == nodeSize(node))) {
    const before = node.childNodes[offset - 1]
    const target = isText(before)
      ? textRange(before, nodeSize(before) - (supportEmptyRange ? 0 : 1))
      : // BR nodes tend to only return the rectangle before them.
        // Only use them if they are the last element in their parent
        isElt(before) && (before.nodeName != "BR" || !before.nextSibling)
        ? before
        : null
    if (target) return flattenV(singleRect(target, 1), false)
  }
  if (atom == null && offset < nodeSize(node)) {
    const after = skipIgnoredForCoords(node.childNodes[offset])
    const target = !after
      ? null
      : isText(after)
        ? textRange(after, 0, supportEmptyRange ? 0 : 1)
        : isElt(after)
          ? after
          : null
    if (target) return flattenV(singleRect(target, -1), true)
  }
  // All else failed, just try to get a rectangle for the target node
  // Text nodes were handled above, so `node` is an element.
  if (!isElt(node)) throw new ViewError({ message: "Expected an element at position " + pos })
  return flattenV(singleRect(node, -side), side >= 0)
}

function skipIgnoredForCoords(node: ChildNode | null): ChildNode | null {
  return node && node.pmViewDesc && node.pmViewDesc.ignoreForCoords ? skipIgnoredForCoords(node.nextSibling) : node
}

function flattenV(rect: DOMRect, left: boolean): Rect {
  if (rect.width == 0) return rect
  const x = left ? rect.left : rect.right
  return { top: rect.top, bottom: rect.bottom, left: x, right: x }
}

function flattenH(rect: DOMRect, top: boolean): Rect {
  if (rect.height == 0) return rect
  const y = top ? rect.top : rect.bottom
  return { top: y, bottom: y, left: rect.left, right: rect.right }
}

function withFlushedState<T>(view: AnyView, state: EditorState<any, any, any>, f: () => T): T {
  const viewState = view.state,
    active = view.root.activeElement
  if (viewState != state) view.updateState(state)
  if (active != view.dom) view.focus()
  try {
    return f()
  } finally {
    if (viewState != state) view.updateState(viewState)
    if (active != view.dom && active && isElt(active)) active.focus()
  }
}

// Whether vertical position motion in a given direction
// from a position would leave a text block.
function endOfTextblockVertical(view: AnyView, state: EditorState<any, any, any>, dir: "up" | "down") {
  const sel = state.selection
  const $pos = dir == "up" ? sel.$from : sel.$to
  return withFlushedState(view, state, () => {
    // The DOM of the innermost block around the position.
    const blockDOM = (dom: DOMNode): DOMNode => {
      const nearest = view.docView.nearestDesc(dom, true)
      if (!nearest) return dom
      if (nearest.node.isBlock) return nearest.contentDOM || nearest.dom
      const up = nearest.dom.parentNode
      return up ? blockDOM(up) : dom
    }
    const dom = blockDOM(view.docView.domFromPos($pos.pos, dir == "up" ? -1 : 1).node)
    const coords = coordsAtPos(view, $pos.pos, 1)
    return !Array.from(dom.childNodes).some((child) =>
      childRects(child).some(
        (box) =>
          box.bottom > box.top + 1 &&
          (dir == "up"
            ? coords.top - box.top > (box.bottom - coords.top) * 2
            : box.bottom - coords.bottom > (coords.bottom - box.top) * 2)
      )
    )
  })
}

const maybeRTL = /[֐-ࢬ]/

function endOfTextblockHorizontal(
  view: AnyView,
  state: EditorState<any, any, any>,
  dir: "left" | "right" | "forward" | "backward"
) {
  const { $head } = state.selection
  if (!$head.parent.isTextblock) return false
  const offset = $head.parentOffset,
    atStart = !offset,
    atEnd = offset == $head.parent.content.size
  const sel = view.domSelection()
  if (!sel) return $head.pos == $head.start() || $head.pos == $head.end()
  // If the textblock is all LTR, or the browser doesn't support
  // Selection.modify (Edge), fall back to a primitive approach
  // `modify` is missing in old Edge; `caretBidiLevel` is Firefox-only.
  const bidiSel: Selection & { caretBidiLevel?: number } = sel
  if (!maybeRTL.test($head.parent.textContent) || !bidiSel.modify) {
    return dir == "left" || dir == "backward" ? atStart : atEnd
  }

  return withFlushedState(view, state, () => {
    // This is a huge hack, but appears to be the best we can
    // currently do: use `Selection.modify` to move the selection by
    // one character, and see if that moves the cursor out of the
    // textblock (or doesn't move it at all, when at the start/end of
    // the document).
    const { anchorNode, anchorOffset, focusNode: oldNode, focusOffset: oldOff } = view.domSelectionRange()
    const oldBidiLevel = bidiSel.caretBidiLevel
    bidiSel.modify("move", dir, "character")
    const parentDOM = $head.depth ? view.docView.domAfterPos($head.beforeUnsafe()) : view.dom
    const { focusNode: newNode, focusOffset: newOff } = view.domSelectionRange()
    const result =
      (newNode && !parentDOM.contains(newNode.nodeType == 1 ? newNode : newNode.parentNode)) ||
      (oldNode == newNode && oldOff == newOff)
    // Restore the previous selection
    try {
      sel.collapse(anchorNode, anchorOffset)
      if (oldNode && (oldNode != anchorNode || oldOff != anchorOffset) && sel.extend) sel.extend(oldNode, oldOff)
    } catch {
      // ignore
    }
    if (oldBidiLevel != null) bidiSel.caretBidiLevel = oldBidiLevel
    return result
  })
}

/**
 * A direction for `EditorView.endOfTextblock`.
 *
 * @since 0.1.0
 * @category models
 */
export type TextblockDir = "up" | "down" | "left" | "right" | "forward" | "backward"

let cachedState: EditorState<any, any, any> | null = null
let cachedDir: TextblockDir | null = null
let cachedResult: boolean = false
/** @internal */
export function endOfTextblock(view: AnyView, state: EditorState<any, any, any>, dir: TextblockDir): boolean {
  if (cachedState == state && cachedDir == dir) return cachedResult
  cachedState = state
  cachedDir = dir
  return (cachedResult =
    dir == "up" || dir == "down"
      ? endOfTextblockVertical(view, state, dir)
      : endOfTextblockHorizontal(view, state, dir))
}
