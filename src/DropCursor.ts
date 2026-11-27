/**
 * A plugin that shows a drop cursor (a line at the drop position) when
 * something is dragged over the editor. Ported from
 * `prosemirror-dropcursor`.
 *
 * @since 0.1.0
 */
// Ported from prosemirror-dropcursor (MIT, Marijn Haverbeke and others)
import * as Equal from "effect/Equal"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import { type EditorState, Plugin, type PluginView } from "./State.ts"
import { dropPoint } from "./Transform.ts"
import type { EditorView, PosAtCoords } from "./View.ts"

/**
 * Options for `dropCursor`.
 *
 * @since 0.1.0
 * @category models
 */
export interface DropCursorOptions {
  /**
   * The color of the cursor. Defaults to `black`. Use `false` to apply
   * no color and rely only on class.
   */
  readonly color?: string | false | undefined

  /** The precise width of the cursor in pixels. Defaults to 1. */
  readonly width?: number | undefined

  /** A CSS class name to add to the cursor element. */
  readonly class?: string | undefined
}

/**
 * The type of the `disableDropCursor` property node specs may define to
 * control the showing of a drop cursor inside them.
 *
 * @since 0.1.0
 * @category models
 */
export type DisableDropCursor =
  | boolean
  | ((view: EditorView<any, any, any>, pos: PosAtCoords, event: DragEvent) => boolean)

/**
 * Create a plugin that, when added to an editor, causes a decoration to
 * show up at the drop position when something is dragged over the
 * editor.
 *
 * Nodes may add a `disableDropCursor` property (see `DisableDropCursor`)
 * to their spec to control the showing of a drop cursor inside them.
 * This may be a boolean or a function, which will be called with a view
 * and a position, and should return a boolean.
 *
 * The cursor element gets the class `prosemirror-dropcursor-block` or
 * `prosemirror-dropcursor-inline`, depending on the position.
 *
 * @since 0.1.0
 * @category constructors
 */
export const dropCursor = (options: DropCursorOptions = {}): Plugin<undefined> =>
  new Plugin<undefined>({
    view: (editorView) => new DropCursorView(editorView, options)
  })

const events = ["dragover", "dragend", "drop", "dragleave"] as const

const isDOMNode = (target: EventTarget): target is globalThis.Node => "nodeType" in target
const isElement = (node: globalThis.Node): node is Element => node.nodeType == 1
const isHTMLElement = (element: Element): element is HTMLElement => "offsetWidth" in element

interface Rect {
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
}

// Whether the node at the drop position opts out of the cursor through its
// spec's `disableDropCursor`.
// Checked by shape, since events from another window's realm fail `instanceof`.
const isDragEvent = (event: Event): event is DragEvent => "dataTransfer" in event

const isDisabledAt = (view: EditorView<any, any, any>, pos: PosAtCoords, event: DragEvent): boolean => {
  const node = pos.inside >= 0 ? view.state.doc.nodeAtOrNull(pos.inside) : null
  const disable = node?.type.spec.disableDropCursor
  if (!Predicate.isFunction(disable)) return Boolean(disable)
  // SAFETY: node specs declare `disableDropCursor` as a `DisableDropCursor`.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return (disable as Extract<DisableDropCursor, Function>)(view, pos, event)
}

class DropCursorView implements PluginView {
  readonly width: number
  readonly color: Option.Option<string>
  readonly class: Option.Option<string>
  cursorPos: Option.Option<number> = Option.none()
  element: Option.Option<HTMLElement> = Option.none()
  timeout: Option.Option<ReturnType<typeof setTimeout>> = Option.none()
  readonly handlers: ReadonlyArray<{ readonly name: string; readonly handler: (event: Event) => void }>

  constructor(
    readonly editorView: EditorView<any, any, any>,
    options: DropCursorOptions
  ) {
    this.width = options.width ?? 1
    this.color = options.color === false ? Option.none() : Option.some(options.color || "black")
    this.class = Option.fromNullishOr(options.class)

    this.handlers = events.map((name) => {
      // Each of `events` dispatches a `DragEvent`.
      const handler = (e: Event) => {
        if (isDragEvent(e)) this[name](e)
      }
      editorView.dom.addEventListener(name, handler)
      return { name, handler }
    })
  }

  destroy() {
    this.handlers.forEach(({ handler, name }) => this.editorView.dom.removeEventListener(name, handler))
    Option.map(this.timeout, clearTimeout)
    Option.map(this.element, (element) => element.remove())
    this.element = Option.none()
  }

  update(editorView: EditorView<any, any, any>, prevState: EditorState<any, any, any>) {
    if (Option.isSome(this.cursorPos) && prevState.doc !== editorView.state.doc) {
      if (this.cursorPos.value > editorView.state.doc.content.size) this.setCursor(Option.none())
      else this.updateOverlay(this.cursorPos.value)
    }
  }

  setCursor(pos: Option.Option<number>) {
    if (Equal.equals(pos, this.cursorPos)) return
    this.cursorPos = pos
    if (Option.isNone(pos)) {
      Option.map(this.element, (element) => element.remove())
      this.element = Option.none()
    } else {
      this.updateOverlay(pos.value)
    }
  }

  // The cursor's rectangle between two blocks, centred on the gap.
  blockRect(cursorPos: number, scaleY: number): Option.Option<Rect> {
    const view = this.editorView
    const $pos = view.state.doc.resolveUnsafe(cursorPos)
    const before = $pos.nodeBeforeOrNull,
      after = $pos.nodeAfterOrNull
    if (!before && !after) return Option.none()
    const node = Option.getOrNull(view.nodeDOM(cursorPos - (before ? before.nodeSize : 0)))
    if (!node || !isElement(node)) return Option.none()
    const nodeRect = node.getBoundingClientRect()
    let top = before ? nodeRect.bottom : nodeRect.top
    if (before && after) {
      const afterDOM = Option.getOrNull(view.nodeDOM(cursorPos))
      if (afterDOM && isElement(afterDOM)) top = (top + afterDOM.getBoundingClientRect().top) / 2
    }
    const halfWidth = (this.width / 2) * scaleY
    return Option.some({ left: nodeRect.left, right: nodeRect.right, top: top - halfWidth, bottom: top + halfWidth })
  }

  updateOverlay(cursorPos: number) {
    const view = this.editorView
    const $pos = view.state.doc.resolveUnsafe(cursorPos)
    const isBlock = !$pos.parent.inlineContent
    const editorDOM = view.dom,
      editorRect = editorDOM.getBoundingClientRect()
    const scaleX = editorRect.width / editorDOM.offsetWidth,
      scaleY = editorRect.height / editorDOM.offsetHeight
    const rect = (isBlock ? this.blockRect(cursorPos, scaleY) : Option.none<Rect>()).pipe(
      Option.getOrElse((): Rect => {
        const coords = view.coordsAtPos(cursorPos)
        const halfWidth = (this.width / 2) * scaleX
        return { left: coords.left - halfWidth, right: coords.left + halfWidth, top: coords.top, bottom: coords.bottom }
      })
    )

    const doc = editorDOM.ownerDocument
    const parent = Option.getOrNull(Option.filter(Option.fromNullishOr(editorDOM.offsetParent), isHTMLElement))
    const element = Option.getOrElse(this.element, () => {
      const created = (parent ?? doc.body).appendChild(doc.createElement("div"))
      Option.map(this.class, (name) => (created.className = name))
      created.style.cssText = "position: absolute; z-index: 50; pointer-events: none;"
      Option.map(this.color, (color) => (created.style.backgroundColor = color))
      return created
    })
    this.element = Option.some(element)
    element.classList.toggle("prosemirror-dropcursor-block", isBlock)
    element.classList.toggle("prosemirror-dropcursor-inline", !isBlock)
    let parentLeft: number, parentTop: number
    const win = doc.defaultView ?? window
    if (!parent || (parent === doc.body && win.getComputedStyle(parent).position === "static")) {
      parentLeft = -win.pageXOffset
      parentTop = -win.pageYOffset
    } else {
      const parentRect = parent.getBoundingClientRect()
      const parentScaleX = parentRect.width / parent.offsetWidth,
        parentScaleY = parentRect.height / parent.offsetHeight
      parentLeft = parentRect.left - parent.scrollLeft * parentScaleX
      parentTop = parentRect.top - parent.scrollTop * parentScaleY
    }
    element.style.left = (rect.left - parentLeft) / scaleX + "px"
    element.style.top = (rect.top - parentTop) / scaleY + "px"
    element.style.width = (rect.right - rect.left) / scaleX + "px"
    element.style.height = (rect.bottom - rect.top) / scaleY + "px"
  }

  scheduleRemoval(timeout: number) {
    Option.map(this.timeout, clearTimeout)
    this.timeout = Option.some(setTimeout(() => this.setCursor(Option.none()), timeout))
  }

  dragover(event: DragEvent) {
    const view = this.editorView
    if (!view.editable) return
    const pos = Option.getOrNull(view.posAtCoords({ left: event.clientX, top: event.clientY }))
    if (!pos || isDisabledAt(view, pos, event)) return
    const slice = view.dragging?.slice
    const target = slice ? Option.getOrElse(dropPoint(view.state.doc, pos.pos, slice), () => pos.pos) : pos.pos
    this.setCursor(Option.some(target))
    this.scheduleRemoval(5000)
  }

  dragend() {
    this.scheduleRemoval(20)
  }

  drop() {
    this.scheduleRemoval(20)
  }

  dragleave(event: DragEvent) {
    const target = event.relatedTarget
    if (!(target && isDOMNode(target) && this.editorView.dom.contains(target))) this.setCursor(Option.none())
  }
}
