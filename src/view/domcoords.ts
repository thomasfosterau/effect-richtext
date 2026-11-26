// Ported from prosemirror-view (MIT, Marijn Haverbeke and others)
/**
 * Coordinate and scrolling helpers.
 *
 * @internal
 */
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import type { EditorState } from "../State.ts"
import * as browser from "./browser.ts"
import { caretFromPoint, type DOMNode, isElt, isText, nodeSize, parentNode, textRange } from "./dom.ts"
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
export function scrollRectIntoView(view: AnyView, rect: Rect, startDOM: DOMNode): void {
  // Skip empty rects with all sides at 0, for example when the element
  // has no CSS box (display: none) (prosemirror-view 1.42.1).
  if (!nonZero(rect) && rect.left == 0) return

  const scrollThreshold = view.someProp("scrollThreshold") || 0,
    scrollMargin = view.someProp("scrollMargin") || 5
  const doc = view.dom.ownerDocument
  for (let parent: DOMNode | null = startDOM || view.dom; ;) {
    if (!parent) break
    if (!isElt(parent)) {
      parent = parentNode(parent)
      continue
    }
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
        rect = { left: rect.left - dX, top: rect.top - dY, right: rect.right - dX, bottom: rect.bottom - dY }
      }
    }
    const pos: string = atTop ? "fixed" : getComputedStyle(elt).position
    if (/^(fixed|sticky)$/.test(pos)) break
    parent = pos == "absolute" ? elt.offsetParent : parentNode(elt)
  }
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
  let ref: ScrollPos["ref"] = Option.none()
  for (let x = (rect.left + rect.right) / 2, y = startY + 1; y < Math.min(innerHeight, rect.bottom); y += 5) {
    const dom = view.root.elementFromPoint(x, y)
    if (!dom || dom == view.dom || !view.dom.contains(dom)) continue
    const localRect = dom.getBoundingClientRect()
    if (localRect.top >= startY - 20) {
      ref = Option.some({ dom, top: localRect.top })
      break
    }
  }
  return { ref, stack: scrollStack(view.dom) }
}

function scrollStack(dom: DOMNode): Array<{ dom: HTMLElement; top: number; left: number }> {
  const stack = [],
    doc = dom.ownerDocument
  for (let cur: DOMNode | null = dom; cur; cur = parentNode(cur)) {
    // SAFETY: the editor's ancestors are elements up to the document, whose `scrollTop` and `scrollLeft` read as 0 when unset.
    stack.push({ dom: cur as HTMLElement, top: (cur as HTMLElement).scrollTop, left: (cur as HTMLElement).scrollLeft })
    if (dom == doc) break
  }
  return stack
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
  for (let i = 0; i < stack.length; i++) {
    const { dom, left, top } = stack[i]
    if (dom.scrollTop != top + dTop) dom.scrollTop = top + dTop
    if (dom.scrollLeft != left) dom.scrollLeft = left
  }
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
  for (let child = node.firstChild, childIndex = 0; child; child = child.nextSibling, childIndex++) {
    let rects
    if (isElt(child)) rects = child.getClientRects()
    else if (isText(child)) rects = textRange(child).getClientRects()
    else continue

    for (let i = 0; i < rects.length; i++) {
      const rect = rects[i]
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
          continue
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
    }
  }
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

function findOffsetInText(node: Text, coords: { top: number; left: number }) {
  const len = node.data.length
  const range = document.createRange()
  let result: { node: DOMNode; offset: number } | undefined
  for (let i = 0; i < len; i++) {
    range.setEnd(node, i + 1)
    range.setStart(node, i)
    const rect = singleRect(range, 1)
    if (rect.top == rect.bottom) continue
    if (inRect(coords, rect)) {
      result = { node, offset: i + (coords.left >= (rect.left + rect.right) / 2 ? 1 : 0) }
      break
    }
  }
  range.detach()
  return result || { node, offset: 0 }
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
  for (let cur = node, sawBlock = false; ;) {
    if (cur == view.dom) break
    const desc = view.docView.nearestDesc(cur, true)
    let rect
    if (!desc) return null
    if (
      isElt(desc.dom) &&
      ((desc.node.isBlock && desc.parent) || !desc.contentDOM) &&
      // Ignore elements with zero-size bounding rectangles
      ((rect = desc.dom.getBoundingClientRect()).width || rect.height)
    ) {
      if (desc.node.isBlock && desc.parent && !/^T(R|BODY|HEAD|FOOT)$/.test(desc.dom.nodeName)) {
        // Only apply the horizontal test to the innermost block. Vertical for any parent.
        if ((!sawBlock && rect.left > coords.left) || rect.top > coords.top) outsideBlock = desc.posBefore
        else if ((!sawBlock && rect.right < coords.left) || rect.bottom < coords.top) outsideBlock = desc.posAfter
        sawBlock = true
      }
      if (!desc.contentDOM && outsideBlock < 0 && !desc.node.isText) {
        // If we are inside a leaf, return the side of the leaf closer to the coords
        const before = desc.node.isBlock
          ? coords.top < (rect.top + rect.bottom) / 2
          : coords.left < (rect.left + rect.right) / 2
        return before ? desc.posBefore : desc.posAfter
      }
    }
    const up = desc.dom.parentNode
    if (!up) break
    cur = up
  }
  return outsideBlock > -1 ? outsideBlock : view.docView.posFromDOM(node, offset, -1)
}

function elementFromPoint(element: Element, coords: { top: number; left: number }, box: Rect): Element {
  const len = element.childNodes.length
  if (len && box.top < box.bottom) {
    for (
      let startI = Math.max(
          0,
          Math.min(len - 1, Math.floor((len * (coords.top - box.top)) / (box.bottom - box.top)) - 2)
        ),
        i = startI;
      ;
    ) {
      const child = element.childNodes[i]
      if (isElt(child)) {
        const rects = child.getClientRects()
        for (let j = 0; j < rects.length; j++) {
          const rect = rects[j]
          if (inRect(coords, rect)) return elementFromPoint(child, coords, rect)
        }
      }
      if ((i = (i + 1) % len) == startI) break
    }
  }
  return element
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
    for (let p: DOMNode | null = elt; node && p; p = parentNode(p)) {
      if (isElt(p) && p.draggable) node = undefined
    }
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
      pos = posFromCaret(view, node, offset, coords)
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
    // SAFETY: outside a text node, `domFromPos` returns a position in an element.
    return flattenH((node as HTMLElement).getBoundingClientRect(), side >= 0)
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
    let after: ChildNode | null = node.childNodes[offset]
    while (after && after.pmViewDesc && after.pmViewDesc.ignoreForCoords) after = after.nextSibling
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
  // SAFETY: text nodes were handled above, so `node` is an element.
  return flattenV(singleRect(node as HTMLElement, -side), side >= 0)
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
    let { node: dom } = view.docView.domFromPos($pos.pos, dir == "up" ? -1 : 1)
    for (;;) {
      const nearest = view.docView.nearestDesc(dom, true)
      if (!nearest) break
      if (nearest.node.isBlock) {
        dom = nearest.contentDOM || nearest.dom
        break
      }
      const up = nearest.dom.parentNode
      if (!up) break
      dom = up
    }
    const coords = coordsAtPos(view, $pos.pos, 1)
    for (let child = dom.firstChild; child; child = child.nextSibling) {
      let boxes
      if (isElt(child)) boxes = child.getClientRects()
      else if (isText(child)) boxes = textRange(child, 0, child.data.length).getClientRects()
      else continue
      for (let i = 0; i < boxes.length; i++) {
        const box = boxes[i]
        if (
          box.bottom > box.top + 1 &&
          (dir == "up"
            ? coords.top - box.top > (box.bottom - coords.top) * 2
            : box.bottom - coords.bottom > (coords.bottom - box.top) * 2)
        ) {
          return false
        }
      }
    }
    return true
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
