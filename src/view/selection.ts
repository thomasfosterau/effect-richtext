// Ported from prosemirror-view (MIT, Marijn Haverbeke and others)
/**
 * Syncing between the editor selection and the DOM selection.
 *
 * @internal
 */
import * as Option from "effect/Option"
import type { ResolvedPos } from "../Model.ts"
import { NodeSelection, Selection, TextSelection } from "../State.ts"
import * as browser from "./browser.ts"
import {
  domIndex,
  type DOMNode,
  type DOMSelectionRange,
  isElt,
  isEquivalentPosition,
  isOnEdge,
  selectionCollapsed
} from "./dom.ts"
import type { EditorView } from "./view.ts"
import { NodeViewDesc, type ViewDesc } from "./viewdesc.ts"

type AnyView = EditorView<any, any, any>

// The selection to use instead of the DOM's after Firefox keyboard
// motion, if any.
const geckoKeySelection = (
  view: AnyView,
  domSel: DOMSelectionRange,
  head: number,
  nearestDesc: Option.Option<ViewDesc>,
  byKey: boolean
) =>
  browser.gecko && byKey
    ? Option.flatMap(nearestDesc, (desc) => skippedScrollWrapper(view, domSel, head, desc))
    : Option.none()

// Firefox will jump across scrollable wrapper nodes on keyboard cursor
// motion. Detect a cursor that landed past such a wrapper and put
// it at the start of the node it skipped (prosemirror-view 1.42.6).
function skippedScrollWrapper(
  view: AnyView,
  domSel: DOMSelectionRange,
  head: number,
  nearestDesc: ViewDesc
): Option.Option<Selection<any>> {
  const to = view.state.selection.to
  if (head <= to || nearestDesc.posAtStart <= to) return Option.none()
  const focus = domSel.focusNode
  if (!focus || !focusAtElementEnd(domSel) || !inScrollableWrapper(focus, nearestDesc.dom)) return Option.none()
  return Selection.findFrom(view.state.doc.resolveUnsafe(nearestDesc.posAtStart), 1)
}

const focusAtElementEnd = ({ focusNode, focusOffset }: DOMSelectionRange): boolean =>
  !!focusNode && isElt(focusNode) && focusOffset == focusNode.childNodes.length

const isScrollable = (node: globalThis.Node): boolean => isElt(node) && getComputedStyle(node).overflow != "visible"

// The parent to keep scanning from: only through last children, up to `stop`.
const climb = (scan: globalThis.Node, stop: globalThis.Node): Option.Option<globalThis.Node> => {
  const parent = scan.parentNode
  return scan == stop || scan.nextSibling || !parent || !isElt(parent) ? Option.none() : Option.some(parent)
}

// Whether `scan`, or an ancestor reached through last children up to
// `stop`, scrolls its overflow.
const inScrollableWrapper = (scan: globalThis.Node, stop: globalThis.Node): boolean =>
  isScrollable(scan) ||
  Option.match(climb(scan, stop), { onNone: () => false, onSome: (up) => inScrollableWrapper(up, stop) })

/** @internal */
export function selectionFromDOM(view: AnyView, origin?: string): Option.Option<Selection<any>> {
  const domSel = view.domSelectionRange(),
    doc = view.state.doc
  if (!domSel.focusNode) return Option.none()
  const focusDesc = view.docView.nearestDesc(domSel.focusNode)
  const inWidget = Option.exists(focusDesc, (desc) => desc.size == 0)
  let head = view.docView.posFromDOM(domSel.focusNode, domSel.focusOffset, 1)
  if (head < 0) return Option.none()
  let $head = doc.resolveUnsafe(head),
    anchor,
    selection = Option.none<Selection<any>>()
  if (selectionCollapsed(domSel)) {
    anchor = head
    const nodeDesc = Option.flatMap(focusDesc, withNode)
    const desc = Option.getOrUndefined(nodeDesc)
    if (
      desc &&
      desc.node.isAtom &&
      NodeSelection.isSelectable(desc.node) &&
      Option.isSome(desc.parent) &&
      !(desc.node.isInline && isOnEdge(domSel.focusNode, domSel.focusOffset, desc.dom))
    ) {
      const pos = desc.posBefore
      selection = Option.some(new NodeSelection(head == pos ? $head : doc.resolveUnsafe(pos)))
    } else {
      selection = geckoKeySelection(view, domSel, head, nodeDesc, origin == "key")
    }
  } else {
    const win = view.dom.ownerDocument.defaultView
    if (win && domSel instanceof win.Selection && domSel.rangeCount > 1) {
      let min = head,
        max = head
      Array.from({ length: domSel.rangeCount }, (_, i) => domSel.getRangeAt(i)).forEach((range) => {
        min = Math.min(min, view.docView.posFromDOM(range.startContainer, range.startOffset, 1))
        max = Math.max(max, view.docView.posFromDOM(range.endContainer, range.endOffset, -1))
      })
      if (min < 0) return Option.none()
      ;[anchor, head] = max == view.state.selection.anchor ? [max, min] : [min, max]
      $head = doc.resolveUnsafe(head)
    } else {
      if (!domSel.anchorNode) return Option.none()
      anchor = view.docView.posFromDOM(domSel.anchorNode, domSel.anchorOffset, 1)
    }
    if (anchor < 0) return Option.none()
  }
  if (Option.isSome(selection)) return selection
  const $anchor = doc.resolveUnsafe(anchor)
  const bias = origin == "pointer" || (view.state.selection.head < $head.pos && !inWidget) ? 1 : -1
  return Option.some(selectionBetween(view, $anchor, $head, bias))
}

// The nearest of `desc` and its ancestors that describes a node.
function withNode(desc: ViewDesc): Option.Option<NodeViewDesc> {
  if (desc.isNode()) return Option.some(desc)
  return Option.flatMap(desc.parent, withNode)
}

function editorOwnsSelection(view: AnyView) {
  return view.editable
    ? view.hasFocus()
    : hasSelection(view) && document.activeElement && document.activeElement.contains(view.dom)
}

/** @internal */
export function selectionToDOM(view: AnyView, force = false): void {
  const sel = view.state.selection
  syncNodeSelection(view, sel)

  if (!editorOwnsSelection(view)) return

  // Need to delay selection normalization during a native selection
  // drag on Chrome, or it will cause further dragging to glitch.
  const mouseDown = view.input.mouseDown
  if (!force && browser.chrome && Option.isSome(mouseDown)) {
    const domSel = view.domSelectionRange(),
      curSel = view.domObserver.currentSelection.range
    if (
      domSel.anchorNode &&
      curSel.anchorNode &&
      isEquivalentPosition(domSel.anchorNode, domSel.anchorOffset, curSel.anchorNode, curSel.anchorOffset) &&
      mouseDown.value.delaySelUpdate()
    ) {
      view.domObserver.setCurSelection()
      return
    }
  }

  view.domObserver.disconnectSelection()

  if (Option.isSome(view.cursorWrapper)) {
    selectCursorWrapper(view, view.cursorWrapper.value.dom)
  } else {
    const { anchor, head } = sel
    let resetEditableFrom, resetEditableTo
    if (brokenSelectBetweenUneditable && !(sel instanceof TextSelection)) {
      if (!sel.$from.parent.inlineContent) {
        resetEditableFrom = temporarilyEditableNear(view, sel.from)
      }
      if (!sel.empty && !sel.$from.parent.inlineContent) {
        resetEditableTo = temporarilyEditableNear(view, sel.to)
      }
    }
    view.docView.setSelection(anchor, head, view, force)
    if (brokenSelectBetweenUneditable) {
      if (resetEditableFrom) resetEditable(resetEditableFrom)
      if (resetEditableTo) resetEditable(resetEditableTo)
    }
    if (sel.visible) {
      view.dom.classList.remove("ProseMirror-hideselection")
    } else {
      view.dom.classList.add("ProseMirror-hideselection")
      if ("onselectionchange" in document) removeClassOnSelectionChange(view)
    }
  }

  view.domObserver.setCurSelection()
  view.domObserver.connectSelection()
}

// Kludge to work around Webkit not allowing a selection to start/end
// between non-editable block nodes. We briefly make something
// editable, set the selection, then set it uneditable again.

const brokenSelectBetweenUneditable = browser.safari || (browser.chrome && browser.chrome_version < 63)

const uneditable = (node?: DOMNode): node is HTMLElement => !!node && isElt(node) && node.contentEditable == "false"

function temporarilyEditableNear(view: AnyView, pos: number) {
  const { node, offset } = view.docView.domFromPos(pos, 0)
  const after = offset < node.childNodes.length ? node.childNodes[offset] : undefined
  const before = offset ? node.childNodes[offset - 1] : undefined
  if (browser.safari && uneditable(after)) return setEditable(after)
  if ((!after || uneditable(after)) && (!before || uneditable(before))) {
    if (uneditable(after)) return setEditable(after)
    else if (uneditable(before)) return setEditable(before)
  }
  return undefined
}

// Safari can't select into draggable elements, so they are made
// undraggable while selected.
type EditableElement = HTMLElement & { wasDraggable?: boolean }

function setEditable(element: EditableElement) {
  element.contentEditable = "true"
  if (browser.safari && element.draggable) {
    element.draggable = false
    element.wasDraggable = true
  }
  return element
}

function resetEditable(element: EditableElement) {
  element.contentEditable = "false"
  if (element.wasDraggable) {
    element.draggable = true
    element.wasDraggable = false
  }
}

function removeClassOnSelectionChange(view: AnyView) {
  const doc = view.dom.ownerDocument
  const prevGuard = view.input.hideSelectionGuard
  if (Option.isSome(prevGuard)) doc.removeEventListener("selectionchange", prevGuard.value)
  const domSel = view.domSelectionRange()
  const node = domSel.anchorNode,
    offset = domSel.anchorOffset
  const guard = () => {
    if (domSel.anchorNode != node || domSel.anchorOffset != offset) {
      doc.removeEventListener("selectionchange", guard)
      setTimeout(() => {
        if (!editorOwnsSelection(view) || view.state.selection.visible) {
          view.dom.classList.remove("ProseMirror-hideselection")
        }
      }, 20)
    }
  }
  view.input.hideSelectionGuard = Option.some(guard)
  doc.addEventListener("selectionchange", guard)
}

function selectCursorWrapper(view: AnyView, node: DOMNode) {
  const found = view.domSelection()
  if (Option.isNone(found)) return
  const domSel = found.value
  const img = node.nodeName == "IMG"
  if (img) domSel.collapse(node.parentNode, domIndex(node) + 1)
  else domSel.collapse(node, 0)
  // Kludge to kill 'control selection' in IE11 when selecting an
  // invisible cursor wrapper, since that would result in those weird
  // resize handles and a selection that considers the absolutely
  // positioned wrapper, rather than the root editable node, the
  // focused element.
  if (!img && !view.state.selection.visible && browser.ie && browser.ie_version <= 11) {
    const ieNode: globalThis.Node & { disabled?: boolean } = node
    ieNode.disabled = true
    ieNode.disabled = false
  }
}

/** @internal */
export function syncNodeSelection(view: AnyView, sel: Selection<any>): void {
  if (sel instanceof NodeSelection) {
    const desc = view.docView.descAt(sel.from)
    if (Option.getOrUndefined(desc) != Option.getOrUndefined(view.lastSelectedViewDesc)) {
      clearNodeSelection(view)
      // The desc at a node selection's start is the selected node's desc.
      if (Option.isSome(desc) && desc.value instanceof NodeViewDesc) desc.value.selectNode()
      view.lastSelectedViewDesc = desc
    }
  } else {
    clearNodeSelection(view)
  }
}

// Clear all DOM statefulness of the last node selection.
function clearNodeSelection(view: AnyView) {
  if (Option.isSome(view.lastSelectedViewDesc)) {
    const selected = view.lastSelectedViewDesc.value
    if (Option.isSome(selected.parent) && selected instanceof NodeViewDesc) selected.deselectNode()
    view.lastSelectedViewDesc = Option.none()
  }
}

/** @internal */
export function selectionBetween(
  view: AnyView,
  $anchor: ResolvedPos<any>,
  $head: ResolvedPos<any>,
  bias?: number
): Selection<any> {
  const custom = view.someProp("createSelectionBetween", (f) => Option.getOrUndefined(f(view, $anchor, $head)))
  return Option.getOrElse(Option.flatMap(custom, Option.fromUndefinedOr), () =>
    TextSelection.between($anchor, $head, bias)
  )
}

/** @internal */
export function hasFocusAndSelection(view: AnyView): boolean {
  if (view.editable && !view.hasFocus()) return false
  return hasSelection(view)
}

/** @internal */
export function hasSelection(view: AnyView): boolean {
  const sel = view.domSelectionRange()
  if (!sel.anchorNode) return false
  try {
    // Firefox will raise 'permission denied' errors when accessing
    // properties of `sel.anchorNode` when it's in a generated CSS
    // element.
    return (
      view.dom.contains(sel.anchorNode.nodeType == 3 ? sel.anchorNode.parentNode : sel.anchorNode) &&
      (view.editable ||
        (!!sel.focusNode && view.dom.contains(sel.focusNode.nodeType == 3 ? sel.focusNode.parentNode : sel.focusNode)))
    )
  } catch {
    return false
  }
}

/** @internal */
export function anchorInRightPlace(view: AnyView): boolean {
  const anchorDOM = view.docView.domFromPos(view.state.selection.anchor, 0)
  const domSel = view.domSelectionRange()
  return (
    !!domSel.anchorNode &&
    isEquivalentPosition(anchorDOM.node, anchorDOM.offset, domSel.anchorNode, domSel.anchorOffset)
  )
}
