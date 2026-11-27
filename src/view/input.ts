// Ported from prosemirror-view (MIT, Marijn Haverbeke and others)
/**
 * DOM event handling.
 *
 * @internal
 */
import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import * as Result from "effect/Result"
import { type Node, type ResolvedPos, Slice } from "../Model.ts"
import { NodeSelection, Selection, TextSelection } from "../State.ts"
import { dropPoint } from "../Transform.ts"
import * as browser from "./browser.ts"
import { captureKeyDown } from "./capturekeys.ts"
import { ViewError } from "./errors.ts"
import { parseFromClipboard, serializeForClipboard } from "./clipboard.ts"
import { type DOMNode, isDOMNode, isElt, keyEvent, textNodeAfter, textNodeBefore } from "./dom.ts"
import { selectionBetween, selectionFromDOM, selectionToDOM } from "./selection.ts"
import type { EditorView, HandlerResult } from "./view.ts"
import type { ViewDesc } from "./viewdesc.ts"

type AnyView = EditorView<any, any, any>

// A collection of DOM events that occur within the editor, and callback functions
// to invoke when the event fires.
type Handlers = { [K in keyof HTMLElementEventMap]?: (view: AnyView, event: HTMLElementEventMap[K]) => void }
const handlers: Handlers = {}
const editHandlers: Handlers = {}

// The handler for events of type `type`.
const handlerFor = (map: Handlers, type: string) =>
  // SAFETY: each handler is stored under its event's type, so it receives that type's events.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  (map as Partial<Readonly<Record<string, (view: AnyView, event: Event) => void>>>)[type]
const isPassiveEvent = (event: string): boolean => event === "touchstart" || event === "touchmove"

/** @internal */
export class InputState {
  shiftKey = false
  mouseDown = Option.none<MouseDown>()
  // The key code of the last keydown, or -1. A plain number, since the
  // compat facade exposes this state to ProseMirror code that sets it.
  lastKeyCode = -1
  lastKeyCodeTime = 0
  lastKeyDispatched = false
  lastClick = { time: 0, x: 0, y: 0, type: "", button: 0 }
  lastSelectionOrigin = Option.none<string>()
  lastSelectionTime = 0
  lastIOSEnter = 0
  lastIOSEnterFallbackTimeout: any = -1
  lastFocus = 0
  lastTouch = 0
  lastChromeDelete = 0
  composing = false
  compositionNode = Option.none<Text>()
  composingTimeout: any = -1
  compositionNodes: Array<ViewDesc> = []
  compositionEndedAt = -2e8
  compositionID = 1
  badSafariComposition = false
  // Set to a composition ID when there are pending changes at compositionend
  compositionPendingChanges = 0
  domChangeCount = 0
  eventHandlers: { [event: string]: (event: Event) => void } = Object.create(null)
  hideSelectionGuard = Option.none<() => void>()
}

/** @internal */
export function initInput(view: AnyView): void {
  Reflect.ownKeys(handlers)
    .filter(Predicate.isString)
    .forEach((eventType) => {
      const handler = handlerFor(handlers, eventType)
      if (!handler) return
      view.dom.addEventListener(
        eventType,
        (view.input.eventHandlers[eventType] = (event: Event) => {
          if (
            eventBelongsToView(view, event) &&
            !runCustomHandler(view, event) &&
            (view.editable || !(event.type in editHandlers))
          ) {
            handler(view, event)
          }
        }),
        isPassiveEvent(eventType) ? { passive: true } : undefined
      )
    })
  // On Safari, for reasons beyond my understanding, adding an input
  // event handler makes an issue where the composition vanishes when
  // you press enter go away.
  if (browser.safari) view.dom.addEventListener("input", () => null)

  ensureListeners(view)
}

function setSelectionOrigin(view: AnyView, origin: string) {
  view.input.lastSelectionOrigin = Option.some(origin)
  view.input.lastSelectionTime = view.state.config.clock()
}

/** @internal */
export function destroyInput(view: AnyView): void {
  if (Option.isSome(view.input.mouseDown)) view.input.mouseDown.value.done()
  view.domObserver.stop()
  Rec.toEntries(view.input.eventHandlers).forEach(([type, handler]) => view.dom.removeEventListener(type, handler))
  clearTimeout(view.input.composingTimeout)
  clearTimeout(view.input.lastIOSEnterFallbackTimeout)
}

/** @internal */
export function ensureListeners(view: AnyView): void {
  view.someProp("handleDOMEvents", (currentHandlers) => {
    Rec.keys(currentHandlers).forEach((type) => {
      if (!view.input.eventHandlers[type]) {
        view.dom.addEventListener(type, (view.input.eventHandlers[type] = (event) => runCustomHandler(view, event)))
      }
    })
  })
}

type DOMEventHandler = (view: AnyView, event: Event) => HandlerResult<any, any>

// A node a pointer press might start dragging, and the DOM changes made to allow it.
interface MightDrag {
  readonly node: Node<any, any>
  readonly pos: number
  readonly addAttr: boolean
  readonly setUneditable: boolean
}

// Apply the `transformPasted` props to a dragged slice.
function transformDragged(view: AnyView, slice: Slice<any>): Slice<any> {
  let dragged = slice
  view.someProp("transformPasted", (f) => {
    dragged = f(dragged, view, false)
  })
  return dragged
}

function runCustomHandler(view: AnyView, event: Event): boolean {
  return Option.isSome(
    view.someProp("handleDOMEvents", (domHandlers) => {
      // SAFETY: `handleDOMEvents` maps each event type to a handler for it.
      const handler = (domHandlers as Partial<Readonly<Record<string, DOMEventHandler>>>)[event.type]
      return handler ? view.runHandler(handler(view, event)) || event.defaultPrevented : false
    })
  )
}

function eventBelongsToView(view: AnyView, event: Event) {
  if (!event.bubbles) return true
  if (event.defaultPrevented) return false
  if (!event.target || !isDOMNode(event.target)) return false
  // Walk up to the view's DOM, unless a shadow root or a node view stops the event.
  const belongs = (node: DOMNode): boolean => {
    if (node == view.dom) return true
    if (node.nodeType == 11 || (node.pmViewDesc && node.pmViewDesc.stopEvent(event))) return false
    return node.parentNode ? belongs(node.parentNode) : false
  }
  return belongs(event.target)
}

// The depths from `$pos.depth + 1` (the node at the position) out to 1.
const depthsAround = ($pos: ResolvedPos<any>): ReadonlyArray<number> =>
  Array.from({ length: $pos.depth + 1 }, (_, k) => $pos.depth + 1 - k)

/** @internal */
export function dispatchEvent(view: AnyView, event: Event): void {
  const handler = handlerFor(handlers, event.type)
  if (!runCustomHandler(view, event) && handler && (view.editable || !(event.type in editHandlers))) {
    handler(view, event)
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

editHandlers.keydown = (view, event) => {
  view.input.shiftKey = event.keyCode == 16 || event.shiftKey
  if (inOrNearComposition(view, event)) return
  view.input.lastKeyCode = event.keyCode
  view.input.lastKeyCodeTime = view.state.config.clock()
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
    const now = view.state.config.clock()
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
  if (event.keyCode == 16) view.input.shiftKey = false
}

editHandlers.keypress = (view, event) => {
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
  return depthsAround($pos).some((i) => {
    const node = nodeAround($pos, i)
    return view.someHandler(propName, (f) => f(view, pos, node, $pos.beforeUnsafe(i), event, i > $pos.depth))
  })
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
  const $pos = view.state.doc.resolveUnsafe(inside)
  if (Option.exists($pos.nodeAfter, (node) => node.isAtom && NodeSelection.isSelectable(node))) {
    updateSelection(view, new NodeSelection($pos), "pointer")
    return true
  }
  return false
}

// The ancestor of `$pos` at depth `depth`, or at `$pos.depth + 1` the
// clicked node directly after it.
function nodeAround($pos: ResolvedPos<any>, depth: number): Node<any, any> {
  if (depth <= $pos.depth) return $pos.node(depth)
  const nodeFound = $pos.nodeAfter
  if (Option.isNone(nodeFound)) throw new ViewError({ message: "No node after position " + $pos.pos })
  const node = nodeFound.value
  return node
}

function selectClickedNode(view: AnyView, inside: number) {
  if (inside == -1) return false
  const sel = view.state.selection
  const selectedNode = sel instanceof NodeSelection

  const $pos = view.state.doc.resolveUnsafe(inside)
  const selectAt = Arr.findFirst(depthsAround($pos), (i) => {
    if (!NodeSelection.isSelectable(nodeAround($pos, i))) return Option.none()
    // Clicking inside a selected node selects its parent.
    const parentOfSelected =
      selectedNode &&
      sel.$from.depth > 0 &&
      i >= sel.$from.depth &&
      $pos.beforeUnsafe(sel.$from.depth + 1) == sel.$from.pos
    return Option.some(parentOfSelected ? $pos.beforeUnsafe(sel.$from.depth) : $pos.beforeUnsafe(i))
  })

  if (Option.isSome(selectAt)) {
    updateSelection(view, NodeSelection.createUnsafe(view.state.doc, selectAt.value), "pointer")
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
    view.input.mouseDown = Option.some(new TripleClickDrag(view, selection))
  }
  return true
}

function selectionForTripleClick(view: AnyView, inside: number, selectNodes: boolean): Option.Option<Selection<any>> {
  const doc = view.state.doc
  if (inside == -1) {
    return doc.inlineContent ? Option.some(TextSelection.createUnsafe(doc, 0, doc.content.size)) : Option.none()
  }

  const $pos = doc.resolveUnsafe(inside)
  return Arr.findFirst(depthsAround($pos), (i): Option.Option<Selection<any>> => {
    const node = nodeAround($pos, i)
    const nodePos = $pos.beforeUnsafe(i)
    if (node.inlineContent) {
      return Option.some(TextSelection.createUnsafe(doc, nodePos + 1, nodePos + 1 + node.content.size))
    } else if (selectNodes && NodeSelection.isSelectable(node)) {
      return Option.some(NodeSelection.createUnsafe(doc, nodePos))
    }
    return Option.none()
  })
}

function forceDOMFlush(view: AnyView) {
  return endComposition(view)
}

const selectNodeModifier: "metaKey" | "ctrlKey" = browser.mac ? "metaKey" : "ctrlKey"

handlers.mousedown = (view, event) => {
  view.input.shiftKey = event.shiftKey
  const flushed = forceDOMFlush(view)
  const now = view.state.config.clock()
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

  if (Option.isSome(view.input.mouseDown)) view.input.mouseDown.value.done()

  const found = view.posAtCoords(eventCoords(event))
  if (Option.isNone(found)) return
  const pos = found.value

  if (type == "singleClick") {
    view.input.mouseDown = Option.some(new LeftMouseDown(view, pos, event, flushed))
  } else if ((type == "doubleClick" ? handleDoubleClick : handleTripleClick)(view, pos.pos, pos.inside, event)) {
    event.preventDefault()
  } else {
    setSelectionOrigin(view, "pointer")
  }
}

// Checked by shape, since events from another window's realm fail `instanceof`.
const isMouseEvent = (event: Event): event is MouseEvent => "clientX" in event && "button" in event

// A pointer interaction in progress: listens for mouse moves and the
// release on the view's root until done.
abstract class MouseDown {
  mightDrag = Option.none<MightDrag>()
  // These listen for `mouseup` and `mousemove`, which are mouse events.
  private readonly onUp = (event: Event) => {
    if (isMouseEvent(event)) this.up(event)
  }
  private readonly onMove = (event: Event) => {
    if (isMouseEvent(event)) this.move(event)
  }

  constructor(readonly view: AnyView) {
    view.root.addEventListener("mouseup", this.onUp)
    view.root.addEventListener("mousemove", this.onMove)
  }

  up(_event: MouseEvent): void {
    this.done()
  }

  move(event: MouseEvent): void {
    if (event.buttons == 0) this.done()
  }

  done(): void {
    this.view.root.removeEventListener("mouseup", this.onUp)
    this.view.root.removeEventListener("mousemove", this.onMove)
    if (this.isCurrent()) this.view.input.mouseDown = Option.none()
  }

  // Whether this is the view's current pointer interaction.
  isCurrent(): boolean {
    return Option.exists(this.view.input.mouseDown, (current) => current == this)
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
  target: Option.Option<HTMLElement>

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
    const clicked = pos.inside > -1 ? view.state.doc.nodeAt(pos.inside) : Option.none()
    if (Option.isSome(clicked)) {
      targetNode = clicked.value
      targetPos = pos.inside
    } else {
      const $pos = view.state.doc.resolveUnsafe(pos.pos)
      targetNode = $pos.parent
      targetPos = $pos.depth ? $pos.beforeUnsafe() : 0
    }

    const target = flushed || !event.target || !isDOMNode(event.target) ? undefined : event.target
    const targetDesc = target ? view.docView.nearestDesc(target, true) : Option.none()
    this.target = Option.flatMap(targetDesc, (desc) =>
      isElt(desc.nodeDOM) ? Option.some(desc.nodeDOM) : Option.none()
    )
    const targetElt = Option.getOrUndefined(this.target)

    const { selection } = view.state
    if (
      event.button == 0 &&
      ((targetNode.type.spec.draggable && targetNode.type.spec.selectable !== false) ||
        (selection instanceof NodeSelection && selection.from <= targetPos && selection.to > targetPos))
    ) {
      this.mightDrag = Option.some({
        node: targetNode,
        pos: targetPos,
        addAttr: !!(targetElt && !targetElt.draggable),
        setUneditable: !!(targetElt && browser.gecko && !targetElt.hasAttribute("contentEditable"))
      })
    }

    const drag = Option.getOrUndefined(this.mightDrag)
    if (targetElt && drag && (drag.addAttr || drag.setUneditable)) {
      this.view.domObserver.stop()
      if (drag.addAttr) targetElt.draggable = true
      if (drag.setUneditable) {
        setTimeout(() => {
          if (this.isCurrent()) targetElt.setAttribute("contentEditable", "false")
        }, 20)
      }
      this.view.domObserver.start()
    }

    setSelectionOrigin(view, "pointer")
  }

  override done() {
    super.done()
    if (Option.isSome(this.mightDrag) && Option.isSome(this.target)) {
      const drag = this.mightDrag.value,
        target = this.target.value
      this.view.domObserver.stop()
      if (drag.addAttr) target.removeAttribute("draggable")
      if (drag.setUneditable) target.removeAttribute("contentEditable")
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

    if (!event.target || !isDOMNode(event.target) || !this.view.dom.contains(event.target)) {
      return
    }

    const found =
      this.view.state.doc != this.startDoc ? this.view.posAtCoords(eventCoords(event)) : Option.some(this.pos)

    this.updateAllowDefault(event)
    if (this.allowDefault || Option.isNone(found)) {
      setSelectionOrigin(this.view, "pointer")
      return
    }
    const pos = found.value
    if (handleSingleClick(this.view, pos.pos, pos.inside, event, this.selectNode)) {
      event.preventDefault()
    } else if (
      event.button == 0 &&
      (this.flushed ||
        // Safari ignores clicks on draggable elements
        (browser.safari && Option.exists(this.mightDrag, (drag) => !drag.node.isAtom)) ||
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
  view.input.lastTouch = view.state.config.clock()
  forceDOMFlush(view)
  setSelectionOrigin(view, "pointer")
}

handlers.touchmove = (view) => {
  view.input.lastTouch = view.state.config.clock()
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
  if (browser.safari && Math.abs(view.state.config.clock() - view.input.compositionEndedAt) < 500) {
    view.input.compositionEndedAt = -2e8
    return true
  }
  return false
}

// Drop active composition after 5 seconds of inactivity on Android
const timeoutComposition = browser.android ? 5000 : -1

// Whether composition at an empty text cursor must wrap the cursor in
// mark nodes different from the ones in the DOM context.
function needsMarkCursor(view: AnyView): boolean {
  const { state } = view,
    $pos = state.selection.$to
  if (!(state.selection instanceof TextSelection) || !state.selection.empty) return false
  return (
    Option.isSome(state.storedMarks) ||
    (!$pos.textOffset &&
      $pos.parentOffset > 0 &&
      Option.exists($pos.nodeBefore, (node) => node.marks.some((m) => m.type.spec.inclusive === false))) ||
    (browser.chrome && browser.windows && selectionBeforeUneditable(view))
  )
}

editHandlers.compositionstart = editHandlers.compositionupdate = (view) => {
  if (!view.composing) {
    view.domObserver.flush()
    const { state } = view,
      $pos = state.selection.$to
    if (needsMarkCursor(view)) {
      // Need to wrap the cursor in mark nodes different from the ones in the DOM context
      view.markCursor = Option.some(Option.getOrElse(view.state.storedMarks, () => $pos.marks()))
      endComposition(view, true)
      view.markCursor = Option.none()
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
        Option.exists($pos.nodeBefore, (node) => Arr.isReadonlyArrayNonEmpty(node.marks))
      ) {
        const sel = view.domSelectionRange()
        // Find the text node before the cursor, and put the DOM selection at its end.
        const collapseIntoText = (node: DOMNode, offset: number): void => {
          if (node.nodeType != 1 || offset == 0) return
          const before = offset < 0 ? node.lastChild : node.childNodes[offset - 1]
          if (!before) return
          if (before.nodeType != 3) return collapseIntoText(before, -1)
          const domSel = view.domSelection()
          if (Option.isSome(domSel)) domSel.value.collapse(before, (before.nodeValue ?? "").length)
        }
        if (sel.focusNode) collapseIntoText(sel.focusNode, sel.focusOffset)
      }
    }
    view.input.composing = true
  }
  scheduleComposeEnd(view, timeoutComposition)
}

function selectionBeforeUneditable(view: AnyView) {
  const { focusNode, focusOffset } = view.domSelectionRange()
  if (!focusNode || focusNode.nodeType != 1 || focusOffset >= focusNode.childNodes.length) return false
  const next = focusNode.childNodes[focusOffset]
  return isElt(next) && next.contentEditable == "false"
}

editHandlers.compositionend = (view, _event) => {
  if (view.composing) {
    view.input.composing = false
    view.input.compositionEndedAt = view.state.config.clock()
    view.input.compositionPendingChanges = view.domObserver.pendingRecords().length ? view.input.compositionID : 0
    view.input.compositionNode = Option.none()
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
    view.input.compositionEndedAt = view.state.config.clock()
  }
  Arr.reverse(view.input.compositionNodes.splice(0)).forEach((node) => node.markParentsDirty())
}

/** @internal */
export function findCompositionNode(view: AnyView): Option.Option<Text> {
  const sel = view.domSelectionRange()
  if (!sel.focusNode) return Option.none()
  const before = textNodeBefore(sel.focusNode, sel.focusOffset)
  const after = textNodeAfter(sel.focusNode, sel.focusOffset)
  if (Option.isSome(before) && Option.isSome(after) && before.value != after.value) {
    const textBefore = before.value,
      textAfter = after.value
    const descAfter = textAfter.pmViewDesc,
      lastChanged = view.domObserver.lastChangedTextNode
    if (Option.exists(lastChanged, (node) => node == textBefore || node == textAfter)) return lastChanged
    if (!descAfter || !descAfter.isText(textAfter.data)) {
      return after
    } else if (Option.exists(view.input.compositionNode, (node) => node == textAfter)) {
      const descBefore = textBefore.pmViewDesc
      if (!(!descBefore || !descBefore.isText(textBefore.data))) {
        return after
      }
    }
  }
  return Option.orElse(before, () => after)
}

/** @internal */
export function endComposition(view: AnyView, restarting = false): boolean {
  if (browser.android && view.domObserver.flushingSoon >= 0) return false
  view.domObserver.forceFlush()
  clearComposition(view)
  if (restarting || (view.docView && view.docView.dirty)) {
    const sel = selectionFromDOM(view),
      cur = view.state.selection
    if (Option.isSome(sel) && !sel.value.eq(cur)) view.dispatchInternal(view.state.tr.setSelectionUnsafe(sel.value))
    else if (
      (Option.isSome(view.markCursor) || restarting) &&
      !cur.$from.node(cur.$from.sharedDepth(cur.to)).inlineContent
    ) {
      view.dispatchInternal(view.state.tr.deleteSelection())
    } else view.updateState(view.state)
    return true
  }
  return false
}

function captureCopy(view: AnyView, dom: HTMLElement) {
  // The extra wrapper is somehow necessary on IE/Edge to prevent the
  // content from being mangled when it is put onto the clipboard
  const sel = getSelection()
  if (!view.dom.parentNode || !sel) return
  const wrap = view.dom.parentNode.appendChild(document.createElement("div"))
  wrap.appendChild(dom)
  wrap.style.cssText = "position: fixed; left: -10000px; top: 10px"
  const range = document.createRange()
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

handlers.copy = editHandlers.cut = (view, event) => {
  const sel = view.state.selection,
    cut = event.type == "cut"
  if (sel.empty) return

  // IE and Edge's clipboard interface is completely broken
  const data = brokenClipboardAPI ? undefined : event.clipboardData
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

function sliceSingleNode(slice: Slice<any>): Option.Option<Node<any, any>> {
  return slice.openStart == 0 && slice.openEnd == 0 && slice.content.childCount == 1
    ? Option.some(slice.content.content[0])
    : Option.none()
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
    if (target instanceof HTMLTextAreaElement) doPaste(view, target.value, "", plain, event)
    else doPaste(view, target.textContent, target.innerHTML, plain, event)
  }, 50)
}

/**
 * Paste `text`, or `html` when it is not empty.
 *
 * @internal
 */
export function doPaste(
  view: AnyView,
  text: string,
  html: string,
  preferPlain: boolean,
  event: ClipboardEvent
): boolean {
  const parsed = parseFromClipboard(view, text, html, preferPlain, view.state.selection.$from)
  if (
    view.someHandler("handlePaste", (f) =>
      f(
        view,
        event,
        Option.getOrElse(parsed, () => Slice.empty)
      )
    )
  )
    return true
  if (Option.isNone(parsed)) return false
  const slice = parsed.value

  const singleNode = sliceSingleNode(slice)
  const tr = Option.isSome(singleNode)
    ? view.state.tr.replaceSelectionWith(singleNode.value, preferPlain)
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

editHandlers.paste = (view, event) => {
  // Handling paste from JavaScript during composition is very poorly
  // handled by browsers, so as a dodgy but preferable kludge, we just
  // let the browser do its native thing there, except on Android,
  // where the editor is almost always composing.
  if (view.composing && !browser.android) return
  const data = brokenClipboardAPI ? undefined : event.clipboardData
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

// The node a drag should move, or none to drag the selection (when the drag
// starts inside it, or on nothing draggable).
function draggedNode(
  view: AnyView,
  event: DragEvent,
  mouseDown: InputState["mouseDown"]
): Option.Option<NodeSelection<any>> {
  const sel = view.state.selection
  const pos = sel.empty ? Option.none() : view.posAtCoords(eventCoords(event))
  if (
    Option.exists(
      pos,
      (found) => found.pos >= sel.from && found.pos <= (sel instanceof NodeSelection ? sel.to - 1 : sel.to)
    )
  )
    return Option.none()
  const drag = Option.flatMap(mouseDown, (down) => down.mightDrag)
  if (Option.isSome(drag)) return Option.some(NodeSelection.createUnsafe(view.state.doc, drag.value.pos))
  return draggableTarget(view, event)
}

// The draggable node whose DOM the drag event targets, if any.
function draggableTarget(view: AnyView, event: DragEvent): Option.Option<NodeSelection<any>> {
  if (!event.target || !isDOMNode(event.target) || !isElt(event.target)) return Option.none()
  return Option.flatMap(view.docView.nearestDesc(event.target, true), (desc) =>
    !desc.node.type.spec.draggable || desc == view.docView
      ? Option.none()
      : Option.some(NodeSelection.createUnsafe(view.state.doc, desc.posBefore))
  )
}

handlers.dragstart = (view, event) => {
  const mouseDown = view.input.mouseDown
  if (Option.isSome(mouseDown)) mouseDown.value.done()
  if (!event.dataTransfer) return

  const node = draggedNode(view, event, mouseDown)
  const draggedSlice = Option.getOrElse(node, (): Selection<any> => view.state.selection).content()
  const { dom, slice, text } = serializeForClipboard(view, draggedSlice)
  // Pre-120 Chrome versions clear files when calling `clearData`
  if (!event.dataTransfer.files.length || !browser.chrome || browser.chrome_version > 120) {
    event.dataTransfer.clearData()
  }
  event.dataTransfer.setData(brokenClipboardAPI ? "Text" : "text/html", dom.innerHTML)
  // See https://code.haverbeke.berlin/prosemirror/prosemirror/issues/1156
  event.dataTransfer.effectAllowed = "copyMove"
  if (!brokenClipboardAPI) event.dataTransfer.setData("text/plain", text)
  view.dragging = Option.some(new Dragging(slice, dragMoves(view, event), Option.getOrUndefined(node)))
}

handlers.dragend = (view) => {
  const dragging = view.dragging
  window.setTimeout(() => {
    if (Option.getOrUndefined(view.dragging) == Option.getOrUndefined(dragging)) view.dragging = Option.none()
  }, 50)
}

editHandlers.dragover = editHandlers.dragenter = (_, e) => e.preventDefault()

editHandlers.drop = (view, event) => {
  // try/finally: clear `dragging` even when handleDrop throws, then rethrow
  const result = Result.try(() => handleDrop(view, event, view.dragging))
  view.dragging = Option.none()
  if (Result.isFailure(result)) throw result.failure
}

function handleDrop(view: AnyView, event: DragEvent, dragging: Option.Option<Dragging>) {
  if (!event.dataTransfer) return

  const eventPos = view.posAtCoords(eventCoords(event))
  if (Option.isNone(eventPos)) return
  const $mouse = view.state.doc.resolveUnsafe(eventPos.value.pos)
  const dropped = Option.isSome(dragging)
    ? Option.some(transformDragged(view, dragging.value.slice))
    : parseFromClipboard(
        view,
        getText(event.dataTransfer),
        brokenClipboardAPI ? "" : event.dataTransfer.getData("text/html"),
        false,
        $mouse
      )
  const moving = Option.filter(dragging, () => dragMoves(view, event))
  const move = Option.isSome(moving)
  if (
    view.someHandler("handleDrop", (f) =>
      f(
        view,
        event,
        Option.getOrElse(dropped, () => Slice.empty),
        move
      )
    )
  ) {
    event.preventDefault()
    return
  }
  if (Option.isNone(dropped)) return
  const slice = dropped.value

  event.preventDefault()
  const insertPos = Option.getOrElse(dropPoint(view.state.doc, $mouse.pos, slice), () => $mouse.pos)

  const tr = view.state.tr
  if (Option.isSome(moving)) {
    const { node } = moving.value
    if (node) node.replace(tr)
    else tr.deleteSelection()
  }

  const pos = tr.mapping.map(insertPos)
  const isNode = slice.openStart == 0 && slice.openEnd == 0 && slice.content.childCount == 1
  const beforeInsert = tr.doc
  if (isNode) {
    tr.replaceRangeWithUnsafe(pos, pos, slice.content.content[0])
  } else {
    tr.replaceRangeUnsafe(pos, pos, slice)
  }
  if (tr.doc.eq(beforeInsert)) return

  const $pos = tr.doc.resolveUnsafe(pos)
  if (
    isNode &&
    NodeSelection.isSelectable(slice.content.content[0]) &&
    Option.exists($pos.nodeAfter, (node) => node.sameMarkup(slice.content.content[0]))
  ) {
    tr.setSelectionUnsafe(new NodeSelection($pos))
  } else {
    let end = tr.mapping.map(insertPos)
    tr.mapping.maps[tr.mapping.maps.length - 1].forEach((_from, _to, _newFrom, newTo) => (end = newTo))
    tr.setSelectionUnsafe(selectionBetween(view, $pos, tr.doc.resolveUnsafe(end)))
  }
  view.focus()
  view.dispatchInternal(tr.setMeta("uiEvent", "drop"))
}

handlers.focus = (view) => {
  view.input.lastFocus = view.state.config.clock()
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

handlers.blur = (view, event) => {
  if (view.focused) {
    view.domObserver.stop()
    view.dom.classList.remove("ProseMirror-focused")
    view.domObserver.start()
    if (event.relatedTarget && isDOMNode(event.relatedTarget) && view.dom.contains(event.relatedTarget)) {
      view.domObserver.currentSelection.clear()
    }
    view.focused = false
  }
}

handlers.beforeinput = (view, event) => {
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
      const sel = view.state.selection
      const $cursor = sel instanceof TextSelection ? sel.$cursor : Option.none()
      // Crude approximation of backspace behavior when no command handled it
      if (Option.isSome($cursor) && $cursor.value.pos > 0) {
        const pos = $cursor.value.pos
        view.dispatchInternal(view.state.tr.deleteUnsafe(pos - 1, pos).scrollIntoView())
      }
    }, 50)
  }
}

// Make sure all handlers get registered
Object.assign(handlers, editHandlers)
