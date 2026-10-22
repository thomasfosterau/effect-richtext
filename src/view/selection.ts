// Ported from prosemirror-view (MIT, Marijn Haverbeke and others)
/**
 * Syncing between the editor selection and the DOM selection.
 *
 * @internal
 */
import type { ResolvedPos } from "../model.ts"
import { NodeSelection, type Selection, TextSelection } from "../state.ts"
import * as browser from "./browser.ts"
import { domIndex, isEquivalentPosition, isOnEdge, selectionCollapsed } from "./dom.ts"
import type { EditorView } from "./view.ts"
import type { NodeViewDesc, ViewDesc } from "./viewdesc.ts"

type AnyView = EditorView<any, any, any>

/** @internal */
export function selectionFromDOM(view: AnyView, origin: string | null = null): Selection<any> | null {
  const domSel = view.domSelectionRange(),
    doc = view.state.doc
  if (!domSel.focusNode) return null
  let nearestDesc: ViewDesc | undefined = view.docView.nearestDesc(domSel.focusNode)
  const inWidget = nearestDesc && nearestDesc.size == 0
  let head = view.docView.posFromDOM(domSel.focusNode, domSel.focusOffset, 1)
  if (head < 0) return null
  let $head = doc.resolveUnsafe(head),
    anchor,
    selection: Selection<any> | undefined
  if (selectionCollapsed(domSel)) {
    anchor = head
    while (nearestDesc && !nearestDesc.node) nearestDesc = nearestDesc.parent
    const nearestDescNode = (nearestDesc as NodeViewDesc | undefined)?.node
    if (
      nearestDesc &&
      nearestDescNode!.isAtom &&
      NodeSelection.isSelectable(nearestDescNode!) &&
      nearestDesc.parent &&
      !(nearestDescNode!.isInline && isOnEdge(domSel.focusNode, domSel.focusOffset, nearestDesc.dom))
    ) {
      const pos = nearestDesc.posBefore
      selection = new NodeSelection(head == pos ? $head : doc.resolveUnsafe(pos))
    }
  } else {
    if (domSel instanceof view.dom.ownerDocument.defaultView!.Selection && domSel.rangeCount > 1) {
      let min = head,
        max = head
      for (let i = 0; i < domSel.rangeCount; i++) {
        const range = domSel.getRangeAt(i)
        min = Math.min(min, view.docView.posFromDOM(range.startContainer, range.startOffset, 1))
        max = Math.max(max, view.docView.posFromDOM(range.endContainer, range.endOffset, -1))
      }
      if (min < 0) return null
      ;[anchor, head] = max == view.state.selection.anchor ? [max, min] : [min, max]
      $head = doc.resolveUnsafe(head)
    } else {
      anchor = view.docView.posFromDOM(domSel.anchorNode!, domSel.anchorOffset, 1)
    }
    if (anchor < 0) return null
  }
  const $anchor = doc.resolveUnsafe(anchor)

  if (!selection) {
    const bias = origin == "pointer" || (view.state.selection.head < $head.pos && !inWidget) ? 1 : -1
    selection = selectionBetween(view, $anchor, $head, bias)
  }
  return selection
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

  // The delayed drag selection causes issues with Cell Selections
  // in Safari. And the drag selection delay is to workarond issues
  // which only present in Chrome.
  if (!force && view.input.mouseDown && view.input.mouseDown.allowDefault && browser.chrome) {
    const domSel = view.domSelectionRange(),
      curSel = view.domObserver.currentSelection
    if (
      domSel.anchorNode &&
      curSel.anchorNode &&
      isEquivalentPosition(domSel.anchorNode, domSel.anchorOffset, curSel.anchorNode, curSel.anchorOffset)
    ) {
      view.input.mouseDown.delayedSelectionSync = true
      view.domObserver.setCurSelection()
      return
    }
  }

  view.domObserver.disconnectSelection()

  if (view.cursorWrapper) {
    selectCursorWrapper(view)
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

function temporarilyEditableNear(view: AnyView, pos: number) {
  const { node, offset } = view.docView.domFromPos(pos, 0)
  const after = offset < node.childNodes.length ? node.childNodes[offset]! : null
  const before = offset ? node.childNodes[offset - 1]! : null
  if (browser.safari && after && (after as HTMLElement).contentEditable == "false") {
    return setEditable(after as HTMLElement)
  }
  if (
    (!after || (after as HTMLElement).contentEditable == "false") &&
    (!before || (before as HTMLElement).contentEditable == "false")
  ) {
    if (after) return setEditable(after as HTMLElement)
    else if (before) return setEditable(before as HTMLElement)
  }
  return undefined
}

function setEditable(element: HTMLElement) {
  element.contentEditable = "true"
  if (browser.safari && element.draggable) {
    element.draggable = false
    ;(element as any).wasDraggable = true
  }
  return element
}

function resetEditable(element: HTMLElement) {
  element.contentEditable = "false"
  if ((element as any).wasDraggable) {
    element.draggable = true
    ;(element as any).wasDraggable = null
  }
}

function removeClassOnSelectionChange(view: AnyView) {
  const doc = view.dom.ownerDocument
  doc.removeEventListener("selectionchange", view.input.hideSelectionGuard!)
  const domSel = view.domSelectionRange()
  const node = domSel.anchorNode,
    offset = domSel.anchorOffset
  doc.addEventListener(
    "selectionchange",
    (view.input.hideSelectionGuard = () => {
      if (domSel.anchorNode != node || domSel.anchorOffset != offset) {
        doc.removeEventListener("selectionchange", view.input.hideSelectionGuard!)
        setTimeout(() => {
          if (!editorOwnsSelection(view) || view.state.selection.visible) {
            view.dom.classList.remove("ProseMirror-hideselection")
          }
        }, 20)
      }
    })
  )
}

function selectCursorWrapper(view: AnyView) {
  const domSel = view.domSelection()
  if (!domSel) return
  const node = view.cursorWrapper!.dom,
    img = node.nodeName == "IMG"
  if (img) domSel.collapse(node.parentNode!, domIndex(node) + 1)
  else domSel.collapse(node, 0)
  // Kludge to kill 'control selection' in IE11 when selecting an
  // invisible cursor wrapper, since that would result in those weird
  // resize handles and a selection that considers the absolutely
  // positioned wrapper, rather than the root editable node, the
  // focused element.
  if (!img && !view.state.selection.visible && browser.ie && browser.ie_version <= 11) {
    ;(node as any).disabled = true
    ;(node as any).disabled = false
  }
}

/** @internal */
export function syncNodeSelection(view: AnyView, sel: Selection<any>): void {
  if (sel instanceof NodeSelection) {
    const desc = view.docView.descAt(sel.from)
    if (desc != view.lastSelectedViewDesc) {
      clearNodeSelection(view)
      if (desc) (desc as NodeViewDesc).selectNode()
      view.lastSelectedViewDesc = desc
    }
  } else {
    clearNodeSelection(view)
  }
}

// Clear all DOM statefulness of the last node selection.
function clearNodeSelection(view: AnyView) {
  if (view.lastSelectedViewDesc) {
    if (view.lastSelectedViewDesc.parent) {
      ;(view.lastSelectedViewDesc as NodeViewDesc).deselectNode()
    }
    view.lastSelectedViewDesc = undefined
  }
}

/** @internal */
export function selectionBetween(
  view: AnyView,
  $anchor: ResolvedPos<any>,
  $head: ResolvedPos<any>,
  bias?: number
): Selection<any> {
  return (
    view.someProp("createSelectionBetween", (f) => f(view, $anchor, $head)) ||
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
      (view.editable || view.dom.contains(sel.focusNode!.nodeType == 3 ? sel.focusNode!.parentNode : sel.focusNode))
    )
  } catch {
    return false
  }
}

/** @internal */
export function anchorInRightPlace(view: AnyView): boolean {
  const anchorDOM = view.docView.domFromPos(view.state.selection.anchor, 0)
  const domSel = view.domSelectionRange()
  return isEquivalentPosition(anchorDOM.node, anchorDOM.offset, domSel.anchorNode!, domSel.anchorOffset)
}
