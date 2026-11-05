// Ported from prosemirror-view (MIT, Marijn Haverbeke and others)
/**
 * DOM event handling.
 *
 * @internal
 */
import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Result from "effect/Result"
import { type Node, Slice } from "../model.ts"
import { NodeSelection, Selection, TextSelection } from "../state.ts"
import { dropPoint } from "../transform.ts"
import * as browser from "./browser.ts"
import { captureKeyDown } from "./capturekeys.ts"
import { parseFromClipboard, serializeForClipboard } from "./clipboard.ts"
import { type DOMNode, keyEvent, textNodeAfter, textNodeBefore } from "./dom.ts"
import { selectionBetween, selectionFromDOM, selectionToDOM } from "./selection.ts"
import type { EditorView } from "./view.ts"
import type { ViewDesc } from "./viewdesc.ts"

type AnyView = EditorView<any, any, any>

// A collection of DOM events that occur within the editor, and callback functions
// to invoke when the event fires.
const handlers: { [event: string]: (view: AnyView, event: Event) => void } = {}
const editHandlers: { [event: string]: (view: AnyView, event: Event) => void } = {}
const isPassiveEvent = (event: string): boolean => event === "touchstart" || event === "touchmove"

/** @internal */
export class InputState {
  shiftKey = false
  mouseDown: MouseDown | null = null
  lastKeyCode: number | null = null
  lastKeyCodeTime = 0
  lastKeyDispatched = false
  lastClick = { time: 0, x: 0, y: 0, type: "", button: 0 }
  lastSelectionOrigin: string | null = null
  lastSelectionTime = 0
  lastIOSEnter = 0
  lastIOSEnterFallbackTimeout: any = -1
  lastFocus = 0
  lastTouch = 0
  lastChromeDelete = 0
  composing = false
  compositionNode: Text | null = null
  composingTimeout: any = -1
  compositionNodes: Array<ViewDesc> = []
  compositionEndedAt = -2e8
  compositionID = 1
  badSafariComposition = false
  // Set to a composition ID when there are pending changes at compositionend
  compositionPendingChanges = 0
  domChangeCount = 0
  eventHandlers: { [event: string]: (event: Event) => void } = Object.create(null)
  hideSelectionGuard: (() => void) | null = null
}

/** @internal */
export function initInput(view: AnyView): void {
  for (const event in handlers) {
    const handler = handlers[event]!
    view.dom.addEventListener(
      event,
      (view.input.eventHandlers[event] = (event: Event) => {
        if (
          eventBelongsToView(view, event) &&
          !runCustomHandler(view, event) &&
          (view.editable || !(event.type in editHandlers))
        ) {
          handler(view, event)
        }
      }),
      isPassiveEvent(event) ? { passive: true } : undefined
    )
  }
  // On Safari, for reasons beyond my understanding, adding an input
  // event handler makes an issue where the composition vanishes when
  // you press enter go away.
  if (browser.safari) view.dom.addEventListener("input", () => null)

  ensureListeners(view)
}

function setSelectionOrigin(view: AnyView, origin: string) {
  view.input.lastSelectionOrigin = origin
  view.input.lastSelectionTime = Date.now()
}

/** @internal */
export function destroyInput(view: AnyView): void {
  if (view.input.mouseDown) view.input.mouseDown.done()
  view.domObserver.stop()
  for (const type in view.input.eventHandlers) {
    view.dom.removeEventListener(type, view.input.eventHandlers[type]!)
  }
  clearTimeout(view.input.composingTimeout)
  clearTimeout(view.input.lastIOSEnterFallbackTimeout)
}

/** @internal */
export function ensureListeners(view: AnyView): void {
  view.someProp("handleDOMEvents", (currentHandlers) => {
    for (const type in currentHandlers) {
      if (!view.input.eventHandlers[type]) {
        view.dom.addEventListener(type, (view.input.eventHandlers[type] = (event) => runCustomHandler(view, event)))
      }
    }
  })
}

function runCustomHandler(view: AnyView, event: Event) {
  return view.someProp("handleDOMEvents", (handlers) => {
    const handler = (handlers as any)[event.type]
    return handler ? view.runHandler(handler(view, event)) || event.defaultPrevented : false
  })
}

function eventBelongsToView(view: AnyView, event: Event) {
  if (!event.bubbles) return true
  if (event.defaultPrevented) return false
  for (let node = event.target as DOMNode; node != view.dom; node = node.parentNode!) {
    if (!node || node.nodeType == 11 || (node.pmViewDesc && node.pmViewDesc.stopEvent(event))) {
      return false
    }
  }
  return true
}

/** @internal */
export function dispatchEvent(view: AnyView, event: Event): void {
  if (!runCustomHandler(view, event) && handlers[event.type] && (view.editable || !(event.type in editHandlers))) {
    handlers[event.type]!(view, event)
  }
}

/**
 * Run `handleKeyDown` for `event` (or a synthesized Backspace / Enter key
 * event), at most once per physical key press and never during
 * composition (prosemirror-view 1.42.9).
 *
 * @internal
 */
export function dispatchKey(view: AnyView, event: KeyboardEvent | "Backspace" | "Enter"): boolean {
  if (view.input.lastKeyDispatched || view.composing) return false
  view.input.lastKeyDispatched = true
  const key = Predicate.isString(event) ? keyEvent(event == "Backspace" ? 8 : 13, event) : event
  return view.someHandler("handleKeyDown", (f) => f(view, key))
}

editHandlers.keydown = (view: AnyView, _event: Event) => {
  const event = _event as KeyboardEvent
  view.input.shiftKey = event.keyCode == 16 || event.shiftKey
  if (inOrNearComposition(view, event)) return
  view.input.lastKeyCode = event.keyCode
  view.input.lastKeyCodeTime = Date.now()
  view.input.lastKeyDispatched = false
  // Suppress enter key events on Chrome Android, because those tend
  // to be part of a confused sequence of composition events fired,
  // and handling them eagerly tends to corrupt the input.
  if (browser.android && browser.chrome && event.keyCode == 13) return
  if (event.keyCode != 229) view.domObserver.forceFlush()

  // On iOS, if we preventDefault enter key presses, the virtual
  // keyboard gets confused. So the hack here is to set a flag that
  // makes the DOM change code recognize that what just happens should
  // be replaced by whatever the Enter key handlers do.
  if (browser.ios && event.keyCode == 13 && !event.ctrlKey && !event.altKey && !event.metaKey) {
    const now = Date.now()
    view.input.lastIOSEnter = now
    view.input.lastIOSEnterFallbackTimeout = setTimeout(() => {
      if (view.input.lastIOSEnter == now) {
        dispatchKey(view, "Enter")
        view.input.lastIOSEnter = 0
      }
    }, 200)
  } else if (dispatchKey(view, event) || captureKeyDown(view, event)) {
    event.preventDefault()
  } else {
    setSelectionOrigin(view, "key")
  }
}

editHandlers.keyup = (view, event) => {
  if ((event as KeyboardEvent).keyCode == 16) view.input.shiftKey = false
}

editHandlers.keypress = (view, _event) => {
  const event = _event as KeyboardEvent
  if (
    inOrNearComposition(view, event) ||
    !event.charCode ||
    (event.ctrlKey && !event.altKey) ||
    (browser.mac && event.metaKey)
  )
    return

  if (view.someHandler("handleKeyPress", (f) => f(view, event))) {
    event.preventDefault()
    return
  }

  const sel = view.state.selection
  if (!(sel instanceof TextSelection) || !sel.$from.sameParent(sel.$to)) {
    const text = String.fromCharCode(event.charCode)
    const deflt = () => view.state.tr.insertTextUnsafe(text).scrollIntoView()
    if (
      !/[\r\n]/.test(text) &&
      !view.someHandler("handleTextInput", (f) => f(view, sel.$from.pos, sel.$to.pos, text, deflt))
    ) {
      view.dispatchInternal(deflt())
    }
    event.preventDefault()
  }
}

function eventCoords(event: MouseEvent) {
  return { left: event.clientX, top: event.clientY }
}

function isNear(event: MouseEvent, click: { x: number; y: number }) {
  const dx = click.x - event.clientX,
    dy = click.y - event.clientY
  return dx * dx + dy * dy < 100
}

function runHandlerOnContext(
  view: AnyView,
  propName: "handleClickOn" | "handleDoubleClickOn" | "handleTripleClickOn",
  pos: number,
  inside: number,
  event: MouseEvent
) {
  if (inside == -1) return false
  const $pos = view.state.doc.resolveUnsafe(inside)
  for (let i = $pos.depth + 1; i > 0; i--) {
    if (
      view.someHandler(propName, (f) =>
        i > $pos.depth
          ? f(view, pos, $pos.nodeAfterOrNull!, $pos.beforeUnsafe(i), event, true)
          : f(view, pos, $pos.node(i), $pos.beforeUnsafe(i), event, false)
      )
    ) {
      return true
    }
  }
  return false
}

function updateSelection(view: AnyView, selection: Selection<any>, origin: string) {
  if (!view.focused) view.focus()
  if (view.state.selection.eq(selection)) return
  const tr = view.state.tr.setSelectionUnsafe(selection)
  if (origin == "pointer") tr.setMeta("pointer", true)
  view.dispatchInternal(tr)
}

function selectClickedLeaf(view: AnyView, inside: number) {
  if (inside == -1) return false
  const $pos = view.state.doc.resolveUnsafe(inside),
    node = $pos.nodeAfterOrNull
  if (node && node.isAtom && NodeSelection.isSelectable(node)) {
    updateSelection(view, new NodeSelection($pos), "pointer")
    return true
  }
  return false
}

function selectClickedNode(view: AnyView, inside: number) {
  if (inside == -1) return false
  const sel = view.state.selection
  let selectedNode, selectAt
  if (sel instanceof NodeSelection) selectedNode = sel.node

  const $pos = view.state.doc.resolveUnsafe(inside)
  for (let i = $pos.depth + 1; i > 0; i--) {
    const node = i > $pos.depth ? $pos.nodeAfterOrNull! : $pos.node(i)
    if (NodeSelection.isSelectable(node)) {
      if (
        selectedNode &&
        sel.$from.depth > 0 &&
        i >= sel.$from.depth &&
        $pos.beforeUnsafe(sel.$from.depth + 1) == sel.$from.pos
      ) {
        selectAt = $pos.beforeUnsafe(sel.$from.depth)
      } else {
        selectAt = $pos.beforeUnsafe(i)
      }
      break
    }
  }

  if (selectAt != null) {
    updateSelection(view, NodeSelection.createUnsafe(view.state.doc, selectAt), "pointer")
    return true
  } else {
    return false
  }
}

function handleSingleClick(view: AnyView, pos: number, inside: number, event: MouseEvent, selectNode: boolean) {
  return (
    runHandlerOnContext(view, "handleClickOn", pos, inside, event) ||
    view.someHandler("handleClick", (f) => f(view, pos, event)) ||
    (selectNode ? selectClickedNode(view, inside) : selectClickedLeaf(view, inside))
  )
}

function handleDoubleClick(view: AnyView, pos: number, inside: number, event: MouseEvent) {
  return (
    runHandlerOnContext(view, "handleDoubleClickOn", pos, inside, event) ||
    view.someHandler("handleDoubleClick", (f) => f(view, pos, event))
  )
}

function handleTripleClick(view: AnyView, pos: number, inside: number, event: MouseEvent) {
  return (
    runHandlerOnContext(view, "handleTripleClickOn", pos, inside, event) ||
    view.someHandler("handleTripleClick", (f) => f(view, pos, event)) ||
    defaultTripleClick(view, inside, event)
  )
}

function defaultTripleClick(view: AnyView, inside: number, event: MouseEvent) {
  if (event.button != 0) return false
  const found = selectionForTripleClick(view, inside, true),
    doc = view.state.doc
  if (Option.isNone(found)) return false
  const selection = found.value
  updateSelection(view, selection, "pointer")
  // Dragging after a triple click extends the selection by whole blocks
  // (prosemirror-view 1.41.9).
  if (selection instanceof TextSelection && doc.eq(view.state.doc)) {
    view.input.mouseDown = new TripleClickDrag(view, selection)
  }
  return true
}

function selectionForTripleClick(view: AnyView, inside: number, selectNodes: boolean): Option.Option<Selection<any>> {
  const doc = view.state.doc
  if (inside == -1) {
    return doc.inlineContent ? Option.some(TextSelection.createUnsafe(doc, 0, doc.content.size)) : Option.none()
  }

  const $pos = doc.resolveUnsafe(inside)
  for (let i = $pos.depth + 1; i > 0; i--) {
    const node = i > $pos.depth ? $pos.nodeAfterOrNull! : $pos.node(i)
    const nodePos = $pos.beforeUnsafe(i)
    if (node.inlineContent) {
      return Option.some(TextSelection.createUnsafe(doc, nodePos + 1, nodePos + 1 + node.content.size))
    } else if (selectNodes && NodeSelection.isSelectable(node)) {
      return Option.some(NodeSelection.createUnsafe(doc, nodePos))
    }
  }
  return Option.none()
}

function forceDOMFlush(view: AnyView) {
  return endComposition(view)
}

const selectNodeModifier: "metaKey" | "ctrlKey" = browser.mac ? "metaKey" : "ctrlKey"

handlers.mousedown = (view, _event) => {
  const event = _event as MouseEvent
  view.input.shiftKey = event.shiftKey
  const flushed = forceDOMFlush(view)
  const now = Date.now()
  let type = "singleClick"
  if (
    now - view.input.lastClick.time < 500 &&
    isNear(event, view.input.lastClick) &&
    !event[selectNodeModifier] &&
    view.input.lastClick.button == event.button
  ) {
    if (view.input.lastClick.type == "singleClick") type = "doubleClick"
    else if (view.input.lastClick.type == "doubleClick") type = "tripleClick"
  }
  view.input.lastClick = { time: now, x: event.clientX, y: event.clientY, type, button: event.button }

  if (view.input.mouseDown) view.input.mouseDown.done()

  const pos = Option.getOrNull(view.posAtCoords(eventCoords(event)))
  if (!pos) return

  if (type == "singleClick") {
    view.input.mouseDown = new LeftMouseDown(view, pos, event, flushed)
  } else if ((type == "doubleClick" ? handleDoubleClick : handleTripleClick)(view, pos.pos, pos.inside, event)) {
    event.preventDefault()
  } else {
    setSelectionOrigin(view, "pointer")
  }
}

// A pointer interaction in progress: listens for mouse moves and the
// release on the view's root until done.
abstract class MouseDown {
  mightDrag: { node: Node<any, any>; pos: number; addAttr: boolean; setUneditable: boolean } | null = null

  constructor(readonly view: AnyView) {
    view.root.addEventListener("mouseup", (this.up = this.up.bind(this) as any))
    view.root.addEventListener("mousemove", (this.move = this.move.bind(this) as any))
  }

  up(_event: MouseEvent): void {
    this.done()
  }

  move(event: MouseEvent): void {
    if (event.buttons == 0) this.done()
  }

  done(): void {
    this.view.root.removeEventListener("mouseup", this.up as any)
    this.view.root.removeEventListener("mousemove", this.move as any)
    if (this.view.input.mouseDown == this) this.view.input.mouseDown = null
  }

  // Asks a pending default pointer selection to sync the DOM selection
  // once the interaction ends; true when it will.
  delaySelUpdate(): boolean {
    return false
  }
}

class LeftMouseDown extends MouseDown {
  startDoc: Node<any, any>
  selectNode: boolean
  allowDefault: boolean
  delayedSelectionSync = false
  target: HTMLElement | null

  constructor(
    view: AnyView,
    readonly pos: { pos: number; inside: number },
    readonly event: MouseEvent,
    readonly flushed: boolean
  ) {
    super(view)
    this.startDoc = view.state.doc
    this.selectNode = event[selectNodeModifier]
    this.allowDefault = event.shiftKey

    let targetNode: Node<any, any>, targetPos
    if (pos.inside > -1) {
      targetNode = view.state.doc.nodeAtOrNull(pos.inside)!
      targetPos = pos.inside
    } else {
      const $pos = view.state.doc.resolveUnsafe(pos.pos)
      targetNode = $pos.parent
      targetPos = $pos.depth ? $pos.beforeUnsafe() : 0
    }

    const target = flushed ? null : (event.target as HTMLElement)
    const targetDesc = target ? view.docView.nearestDesc(target, true) : null
    this.target = targetDesc && targetDesc.nodeDOM.nodeType == 1 ? (targetDesc.nodeDOM as HTMLElement) : null

    const { selection } = view.state
    if (
      event.button == 0 &&
      ((targetNode.type.spec.draggable && targetNode.type.spec.selectable !== false) ||
        (selection instanceof NodeSelection && selection.from <= targetPos && selection.to > targetPos))
    ) {
      this.mightDrag = {
        node: targetNode,
        pos: targetPos,
        addAttr: !!(this.target && !this.target.draggable),
        setUneditable: !!(this.target && browser.gecko && !this.target.hasAttribute("contentEditable"))
      }
    }

    if (this.target && this.mightDrag && (this.mightDrag.addAttr || this.mightDrag.setUneditable)) {
      this.view.domObserver.stop()
      if (this.mightDrag.addAttr) this.target.draggable = true
      if (this.mightDrag.setUneditable) {
        setTimeout(() => {
          if (this.view.input.mouseDown == this) this.target!.setAttribute("contentEditable", "false")
        }, 20)
      }
      this.view.domObserver.start()
    }

    setSelectionOrigin(view, "pointer")
  }

  override done() {
    super.done()
    if (this.mightDrag && this.target) {
      this.view.domObserver.stop()
      if (this.mightDrag.addAttr) this.target.removeAttribute("draggable")
      if (this.mightDrag.setUneditable) this.target.removeAttribute("contentEditable")
      this.view.domObserver.start()
    }
    if (this.delayedSelectionSync) {
      setTimeout(() => {
        if (!this.view.isDestroyed) selectionToDOM(this.view)
      })
    }
  }

  override up(event: MouseEvent) {
    this.done()

    if (!this.view.dom.contains(event.target as HTMLElement)) {
      return
    }

    let pos: { pos: number; inside: number } | null = this.pos
    if (this.view.state.doc != this.startDoc) pos = Option.getOrNull(this.view.posAtCoords(eventCoords(event)))

    this.updateAllowDefault(event)
    if (this.allowDefault || !pos) {
      setSelectionOrigin(this.view, "pointer")
    } else if (handleSingleClick(this.view, pos.pos, pos.inside, event, this.selectNode)) {
      event.preventDefault()
    } else if (
      event.button == 0 &&
      (this.flushed ||
        // Safari ignores clicks on draggable elements
        (browser.safari && this.mightDrag && !this.mightDrag.node.isAtom) ||
        // Chrome will sometimes treat a node selection as a
        // cursor, but still report that the node is selected
        // when asked through getSelection. You'll then get a
        // situation where clicking at the point where that
        // (hidden) cursor is doesn't change the selection, and
        // thus doesn't get a reaction from ProseMirror. This
        // works around that.
        (browser.chrome &&
          !this.view.state.selection.visible &&
          Math.min(
            Math.abs(pos.pos - this.view.state.selection.from),
            Math.abs(pos.pos - this.view.state.selection.to)
          ) <= 2))
    ) {
      updateSelection(this.view, Selection.near(this.view.state.doc.resolveUnsafe(pos.pos)), "pointer")
      event.preventDefault()
    } else {
      setSelectionOrigin(this.view, "pointer")
    }
  }

  override move(event: MouseEvent) {
    this.updateAllowDefault(event)
    setSelectionOrigin(this.view, "pointer")
    super.move(event)
  }

  updateAllowDefault(event: MouseEvent) {
    if (
      !this.allowDefault &&
      (Math.abs(this.event.x - event.clientX) > 4 || Math.abs(this.event.y - event.clientY) > 4)
    ) {
      this.allowDefault = true
    }
  }

  override delaySelUpdate(): boolean {
    if (!this.allowDefault) return false
    this.delayedSelectionSync = true
    return true
  }
}

// Dragging after a triple click: extend the selection by whole textblocks.
class TripleClickDrag extends MouseDown {
  startDoc: Node<any, any>

  constructor(
    view: AnyView,
    readonly startSelection: TextSelection<any>
  ) {
    super(view)
    this.startDoc = view.state.doc
  }

  override move(event: MouseEvent) {
    if (event.buttons == 0 || this.view.isDestroyed || !this.view.state.doc.eq(this.startDoc)) {
      this.done()
      return
    }

    event.preventDefault()
    setSelectionOrigin(this.view, "pointer")

    const found = Option.flatMap(this.view.posAtCoords(eventCoords(event)), (pos) =>
      selectionForTripleClick(this.view, pos.inside, false)
    )
    if (Option.isNone(found)) return
    const target = found.value

    const { doc } = this.view.state,
      start = this.startSelection
    const [anchor, head] = target.from < start.from ? [start.to, target.from] : [start.from, target.to]
    updateSelection(this.view, TextSelection.createUnsafe(doc, anchor, head), "pointer")
  }
}

handlers.touchstart = (view) => {
  view.input.lastTouch = Date.now()
  forceDOMFlush(view)
  setSelectionOrigin(view, "pointer")
}

handlers.touchmove = (view) => {
  view.input.lastTouch = Date.now()
  setSelectionOrigin(view, "pointer")
}

handlers.contextmenu = (view) => forceDOMFlush(view)

function inOrNearComposition(view: AnyView, _event: Event) {
  if (view.composing) return true
  // See https://www.stum.de/2016/06/24/handling-ime-events-in-javascript/.
  // On Japanese input method editors (IMEs), the Enter key is used to confirm character
  // selection. On Safari, when Enter is pressed, compositionend and keydown events are
  // emitted. The keydown event triggers newline insertion, which we don't want.
  // This method returns true if the keydown event should be ignored.
  // We only ignore it once, as pressing Enter a second time *should* insert a newline.
  // Furthermore, the keydown event timestamp must be close to the compositionEndedAt timestamp.
  // This guards against the case where compositionend is triggered without the keyboard
  // (e.g. character confirmation may be done with the mouse), and keydown is triggered
  // afterwards- we wouldn't want to ignore the keydown event in this case.
  if (browser.safari && Math.abs(Date.now() - view.input.compositionEndedAt) < 500) {
    view.input.compositionEndedAt = -2e8
    return true
  }
  return false
}

// Drop active composition after 5 seconds of inactivity on Android
const timeoutComposition = browser.android ? 5000 : -1

// Whether composition at an empty text cursor must wrap the cursor in
// mark nodes different from the ones in the DOM context (#1500).
function needsMarkCursor(view: AnyView): boolean {
  const { state } = view,
    $pos = state.selection.$to
  if (!(state.selection instanceof TextSelection) || !state.selection.empty) return false
  return !!(
    state.storedMarksOrNull ||
    (!$pos.textOffset &&
      $pos.parentOffset &&
      $pos.nodeBeforeOrNull!.marks.some((m) => m.type.spec.inclusive === false)) ||
    (browser.chrome && browser.windows && selectionBeforeUneditable(view))
  )
}

editHandlers.compositionstart = editHandlers.compositionupdate = (view) => {
  if (!view.composing) {
    view.domObserver.flush()
    const { state } = view,
      $pos = state.selection.$to
    if (needsMarkCursor(view)) {
      // Issue #1500
      // Need to wrap the cursor in mark nodes different from the ones in the DOM context
      view.markCursor = view.state.storedMarksOrNull || $pos.marks()
      endComposition(view, true)
      view.markCursor = null
    } else {
      endComposition(view, !state.selection.empty)
      // In firefox, if the cursor is after but outside a marked node,
      // the inserted text won't inherit the marks. So this moves it
      // inside if necessary.
      if (
        browser.gecko &&
        state.selection.empty &&
        $pos.parentOffset &&
        !$pos.textOffset &&
        $pos.nodeBeforeOrNull!.marks.length
      ) {
        const sel = view.domSelectionRange()
        for (let node = sel.focusNode, offset = sel.focusOffset; node && node.nodeType == 1 && offset != 0;) {
          const before = offset < 0 ? node.lastChild : node.childNodes[offset - 1]
          if (!before) break
          if (before.nodeType == 3) {
            const sel = view.domSelection()
            if (sel) sel.collapse(before, before.nodeValue!.length)
            break
          } else {
            node = before
            offset = -1
          }
        }
      }
    }
    view.input.composing = true
  }
  scheduleComposeEnd(view, timeoutComposition)
}

function selectionBeforeUneditable(view: AnyView) {
  const { focusNode, focusOffset } = view.domSelectionRange()
  if (!focusNode || focusNode.nodeType != 1 || focusOffset >= focusNode.childNodes.length) return false
  const next = focusNode.childNodes[focusOffset]!
  return next.nodeType == 1 && (next as HTMLElement).contentEditable == "false"
}

editHandlers.compositionend = (view, _event) => {
  if (view.composing) {
    view.input.composing = false
    view.input.compositionEndedAt = Date.now()
    view.input.compositionPendingChanges = view.domObserver.pendingRecords().length ? view.input.compositionID : 0
    view.input.compositionNode = null
    if (view.input.badSafariComposition) view.domObserver.forceFlush()
    else if (view.input.compositionPendingChanges) void Promise.resolve().then(() => view.domObserver.flush())
    view.input.compositionID++
    scheduleComposeEnd(view, 20)
  }
}

function scheduleComposeEnd(view: AnyView, delay: number) {
  clearTimeout(view.input.composingTimeout)
  if (delay > -1) view.input.composingTimeout = setTimeout(() => endComposition(view), delay)
}

/** @internal */
export function clearComposition(view: AnyView): void {
  if (view.composing) {
    view.input.composing = false
    view.input.compositionEndedAt = Date.now()
  }
  while (Arr.isArrayNonEmpty(view.input.compositionNodes)) view.input.compositionNodes.pop()!.markParentsDirty()
}

/** @internal */
export function findCompositionNode(view: AnyView): Text | null {
  const sel = view.domSelectionRange()
  if (!sel.focusNode) return null
  const textBefore = textNodeBefore(sel.focusNode, sel.focusOffset)
  const textAfter = textNodeAfter(sel.focusNode, sel.focusOffset)
  if (textBefore && textAfter && textBefore != textAfter) {
    const descAfter = textAfter.pmViewDesc,
      lastChanged = view.domObserver.lastChangedTextNode
    if (textBefore == lastChanged || textAfter == lastChanged) return lastChanged
    if (!descAfter || !descAfter.isText(textAfter.nodeValue!)) {
      return textAfter
    } else if (view.input.compositionNode == textAfter) {
      const descBefore = textBefore.pmViewDesc
      if (!(!descBefore || !descBefore.isText(textBefore.nodeValue!))) {
        return textAfter
      }
    }
  }
  return textBefore || textAfter
}

/** @internal */
export function endComposition(view: AnyView, restarting = false): boolean {
  if (browser.android && view.domObserver.flushingSoon >= 0) return false
  view.domObserver.forceFlush()
  clearComposition(view)
  if (restarting || (view.docView && view.docView.dirty)) {
    const sel = selectionFromDOM(view),
      cur = view.state.selection
    if (sel && !sel.eq(cur)) view.dispatchInternal(view.state.tr.setSelectionUnsafe(sel))
    else if ((view.markCursor || restarting) && !cur.$from.node(cur.$from.sharedDepth(cur.to)).inlineContent) {
      view.dispatchInternal(view.state.tr.deleteSelection())
    } else view.updateState(view.state)
    return true
  }
  return false
}

function captureCopy(view: AnyView, dom: HTMLElement) {
  // The extra wrapper is somehow necessary on IE/Edge to prevent the
  // content from being mangled when it is put onto the clipboard
  if (!view.dom.parentNode) return
  const wrap = view.dom.parentNode.appendChild(document.createElement("div"))
  wrap.appendChild(dom)
  wrap.style.cssText = "position: fixed; left: -10000px; top: 10px"
  const sel = getSelection()!,
    range = document.createRange()
  range.selectNodeContents(dom)
  // Done because IE will fire a selectionchange moving the selection
  // to its start when removeAllRanges is called and the editor still
  // has focus (which will mess up the editor's selection state).
  view.dom.blur()
  sel.removeAllRanges()
  sel.addRange(range)
  setTimeout(() => {
    if (wrap.parentNode) wrap.parentNode.removeChild(wrap)
    view.focus()
  }, 50)
}

// This is very crude, but unfortunately both these browsers _pretend_
// that they have a clipboard API—all the objects and methods are
// there, they just don't work, and they are hard to test.
const brokenClipboardAPI = (browser.ie && browser.ie_version < 15) || (browser.ios && browser.webkit_version < 604)

handlers.copy = editHandlers.cut = (view, _event) => {
  const event = _event as ClipboardEvent
  const sel = view.state.selection,
    cut = event.type == "cut"
  if (sel.empty) return

  // IE and Edge's clipboard interface is completely broken
  const data = brokenClipboardAPI ? null : event.clipboardData
  const slice = sel.content(),
    { dom, text } = serializeForClipboard(view, slice)
  if (data) {
    event.preventDefault()
    data.clearData()
    data.setData("text/html", dom.innerHTML)
    data.setData("text/plain", text)
  } else {
    captureCopy(view, dom)
  }
  if (cut) view.dispatchInternal(view.state.tr.deleteSelection().scrollIntoView().setMeta("uiEvent", "cut"))
}

function sliceSingleNode(slice: Slice<any>) {
  return slice.openStart == 0 && slice.openEnd == 0 && slice.content.childCount == 1 ? slice.content.content[0]! : null
}

function capturePaste(view: AnyView, event: ClipboardEvent) {
  if (!view.dom.parentNode) return
  const plainText = view.input.shiftKey || view.state.selection.$from.parent.type.spec.code
  const target = view.dom.parentNode.appendChild(document.createElement(plainText ? "textarea" : "div"))
  if (!plainText) target.contentEditable = "true"
  target.style.cssText = "position: fixed; left: -10000px; top: 10px"
  target.focus()
  const plain = view.input.shiftKey && view.input.lastKeyCode != 45
  setTimeout(() => {
    view.focus()
    if (target.parentNode) target.parentNode.removeChild(target)
    if (plainText) doPaste(view, (target as HTMLTextAreaElement).value, null, plain, event)
    else doPaste(view, target.textContent!, target.innerHTML, plain, event)
  }, 50)
}

/** @internal */
export function doPaste(
  view: AnyView,
  text: string,
  html: string | null,
  preferPlain: boolean,
  event: ClipboardEvent
): boolean {
  const slice = parseFromClipboard(view, text, html, preferPlain, view.state.selection.$from)
  if (view.someHandler("handlePaste", (f) => f(view, event, slice || Slice.empty))) return true
  if (!slice) return false

  const singleNode = sliceSingleNode(slice)
  const tr = singleNode
    ? view.state.tr.replaceSelectionWith(singleNode, preferPlain)
    : view.state.tr.replaceSelection(slice)
  view.dispatchInternal(tr.scrollIntoView().setMeta("paste", true).setMeta("uiEvent", "paste"))
  return true
}

function getText(clipboardData: DataTransfer) {
  const text = clipboardData.getData("text/plain") || clipboardData.getData("Text")
  if (text) return text
  const uris = clipboardData.getData("text/uri-list")
  return uris ? uris.replace(/\r?\n/g, " ") : ""
}

editHandlers.paste = (view, _event) => {
  const event = _event as ClipboardEvent
  // Handling paste from JavaScript during composition is very poorly
  // handled by browsers, so as a dodgy but preferable kludge, we just
  // let the browser do its native thing there, except on Android,
  // where the editor is almost always composing.
  if (view.composing && !browser.android) return
  const data = brokenClipboardAPI ? null : event.clipboardData
  const plain = view.input.shiftKey && view.input.lastKeyCode != 45
  if (data && doPaste(view, getText(data), data.getData("text/html"), plain, event)) {
    event.preventDefault()
  } else {
    capturePaste(view, event)
  }
}

/** @internal */
export class Dragging {
  constructor(
    readonly slice: Slice<any>,
    readonly move: boolean,
    readonly node?: NodeSelection<any>
  ) {}
}

const dragCopyModifier: "altKey" | "ctrlKey" = browser.mac ? "altKey" : "ctrlKey"

function dragMoves(view: AnyView, event: DragEvent) {
  // A dragCopies prop returning false must count too (prosemirror-view 1.41.8).
  let asked = false,
    copy = false
  view.someProp("dragCopies", (test) => {
    asked = true
    copy = copy || test(event)
  })
  return asked ? !copy : !event[dragCopyModifier]
}

handlers.dragstart = (view, _event) => {
  const event = _event as DragEvent
  const mouseDown = view.input.mouseDown
  if (mouseDown) mouseDown.done()
  if (!event.dataTransfer) return

  const sel = view.state.selection
  const pos = sel.empty ? null : Option.getOrNull(view.posAtCoords(eventCoords(event)))
  let node: undefined | NodeSelection<any>
  if (pos && pos.pos >= sel.from && pos.pos <= (sel instanceof NodeSelection ? sel.to - 1 : sel.to)) {
    // In selection
  } else if (mouseDown && mouseDown.mightDrag) {
    node = NodeSelection.createUnsafe(view.state.doc, mouseDown.mightDrag.pos)
  } else if (event.target && (event.target as HTMLElement).nodeType == 1) {
    const desc = view.docView.nearestDesc(event.target as HTMLElement, true)
    if (desc && desc.node.type.spec.draggable && desc != view.docView) {
      node = NodeSelection.createUnsafe(view.state.doc, desc.posBefore)
    }
  }
  const draggedSlice = (node || view.state.selection).content()
  const { dom, slice, text } = serializeForClipboard(view, draggedSlice)
  // Pre-120 Chrome versions clear files when calling `clearData` (#1472)
  if (!event.dataTransfer.files.length || !browser.chrome || browser.chrome_version > 120) {
    event.dataTransfer.clearData()
  }
  event.dataTransfer.setData(brokenClipboardAPI ? "Text" : "text/html", dom.innerHTML)
  // See https://code.haverbeke.berlin/prosemirror/prosemirror/issues/1156
  event.dataTransfer.effectAllowed = "copyMove"
  if (!brokenClipboardAPI) event.dataTransfer.setData("text/plain", text)
  view.dragging = new Dragging(slice, dragMoves(view, event), node)
}

handlers.dragend = (view) => {
  const dragging = view.dragging
  window.setTimeout(() => {
    if (view.dragging == dragging) view.dragging = null
  }, 50)
}

editHandlers.dragover = editHandlers.dragenter = (_, e) => e.preventDefault()

editHandlers.drop = (view, event) => {
  // try/finally: clear `dragging` even when handleDrop throws, then rethrow
  const result = Result.try(() => handleDrop(view, event as DragEvent, view.dragging as Dragging | null))
  view.dragging = null
  if (Result.isFailure(result)) throw result.failure
}

function handleDrop(view: AnyView, event: DragEvent, dragging: Dragging | null) {
  if (!event.dataTransfer) return

  const eventPos = Option.getOrNull(view.posAtCoords(eventCoords(event)))
  if (!eventPos) return
  const $mouse = view.state.doc.resolveUnsafe(eventPos.pos)
  let slice: Slice<any> | null = dragging && dragging.slice
  if (slice) {
    view.someProp("transformPasted", (f) => {
      slice = f(slice!, view, false)
    })
  } else {
    slice = parseFromClipboard(
      view,
      getText(event.dataTransfer),
      brokenClipboardAPI ? null : event.dataTransfer.getData("text/html"),
      false,
      $mouse
    )
  }
  const move = !!(dragging && dragMoves(view, event))
  if (view.someHandler("handleDrop", (f) => f(view, event, slice || Slice.empty, move))) {
    event.preventDefault()
    return
  }
  if (!slice) return

  event.preventDefault()
  let insertPos = slice ? Option.getOrNull(dropPoint(view.state.doc, $mouse.pos, slice)) : $mouse.pos
  if (insertPos == null) insertPos = $mouse.pos

  const tr = view.state.tr
  if (move) {
    const { node } = dragging as Dragging
    if (node) node.replace(tr)
    else tr.deleteSelection()
  }

  const pos = tr.mapping.map(insertPos)
  const isNode = slice.openStart == 0 && slice.openEnd == 0 && slice.content.childCount == 1
  const beforeInsert = tr.doc
  if (isNode) {
    tr.replaceRangeWithUnsafe(pos, pos, slice.content.content[0]!)
  } else {
    tr.replaceRangeUnsafe(pos, pos, slice)
  }
  if (tr.doc.eq(beforeInsert)) return

  const $pos = tr.doc.resolveUnsafe(pos)
  if (
    isNode &&
    NodeSelection.isSelectable(slice.content.content[0]!) &&
    $pos.nodeAfterOrNull &&
    $pos.nodeAfterOrNull.sameMarkup(slice.content.content[0]!)
  ) {
    tr.setSelectionUnsafe(new NodeSelection($pos))
  } else {
    let end = tr.mapping.map(insertPos)
    tr.mapping.maps[tr.mapping.maps.length - 1]!.forEach((_from, _to, _newFrom, newTo) => (end = newTo))
    tr.setSelectionUnsafe(selectionBetween(view, $pos, tr.doc.resolveUnsafe(end)))
  }
  view.focus()
  view.dispatchInternal(tr.setMeta("uiEvent", "drop"))
}

handlers.focus = (view) => {
  view.input.lastFocus = Date.now()
  if (!view.focused) {
    view.domObserver.stop()
    view.dom.classList.add("ProseMirror-focused")
    view.domObserver.start()
    view.focused = true
    // Only restore the selection if nothing moved it after focusing
    // (prosemirror-view 1.42.9).
    const startSel = view.domSelectionRange()
    if (!view.domObserver.currentSelection.eq(startSel)) {
      const { focusNode, focusOffset } = startSel
      setTimeout(() => {
        const newSel = view.domSelectionRange()
        if (newSel.focusNode == focusNode && newSel.focusOffset == focusOffset && view.docView && view.hasFocus()) {
          selectionToDOM(view)
        }
      }, 20)
    }
  }
}

handlers.blur = (view, _event) => {
  const event = _event as FocusEvent
  if (view.focused) {
    view.domObserver.stop()
    view.dom.classList.remove("ProseMirror-focused")
    view.domObserver.start()
    if (event.relatedTarget && view.dom.contains(event.relatedTarget as HTMLElement)) {
      view.domObserver.currentSelection.clear()
    }
    view.focused = false
  }
}

handlers.beforeinput = (view, _event: Event) => {
  const event = _event as InputEvent
  // We should probably do more with beforeinput events, but support
  // is so spotty that I'm still waiting to see where they are going.

  // Very specific hack to deal with backspace sometimes failing on
  // Chrome Android when after an uneditable node.
  // (Chrome and, since prosemirror-view 1.42.2, Firefox on Android.)
  if (browser.android && event.inputType == "deleteContentBackward") {
    view.domObserver.flushSoon()
    const { domChangeCount } = view.input
    setTimeout(() => {
      if (view.input.domChangeCount != domChangeCount || view.domObserver.pendingRecords().length) return // Event already had some effect
      // This bug tends to close the virtual keyboard, so we refocus
      view.dom.blur()
      view.focus()
      if (dispatchKey(view, "Backspace")) return
      const $cursor = (view.state.selection as TextSelection<any>).$cursorOrNull
      // Crude approximation of backspace behavior when no command handled it
      if ($cursor && $cursor.pos > 0) {
        view.dispatchInternal(view.state.tr.deleteUnsafe($cursor.pos - 1, $cursor.pos).scrollIntoView())
      }
    }, 50)
  }
}

// Make sure all handlers get registered
for (const prop in editHandlers) handlers[prop] = editHandlers[prop]!
