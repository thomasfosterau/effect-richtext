/**
 * A plugin that shows a drop cursor (a line at the drop position) when
 * something is dragged over the editor. Ported from
 * `prosemirror-dropcursor`.
 *
 * @since 0.1.0
 */
// Ported from prosemirror-dropcursor (MIT, Marijn Haverbeke and others)
import * as Option from "effect/Option"
import { type EditorState, Plugin, type PluginView } from "./state.ts"
import { dropPoint } from "./transform.ts"
import type { EditorView, PosAtCoords } from "./view.ts"

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

class DropCursorView implements PluginView {
  readonly width: number
  readonly color: string | undefined
  readonly class: string | undefined
  cursorPos: number | null = null
  element: HTMLElement | null = null
  timeout: ReturnType<typeof setTimeout> | undefined = undefined
  readonly handlers: ReadonlyArray<{ readonly name: string; readonly handler: (event: Event) => void }>

  constructor(readonly editorView: EditorView<any, any, any>, options: DropCursorOptions) {
    this.width = options.width ?? 1
    this.color = options.color === false ? undefined : (options.color || "black")
    this.class = options.class

    this.handlers = events.map((name) => {
      const handler = (e: Event) => {
        this[name](e as DragEvent)
      }
      editorView.dom.addEventListener(name, handler)
      return { name, handler }
    })
  }

  destroy() {
    this.handlers.forEach(({ handler, name }) => this.editorView.dom.removeEventListener(name, handler))
    clearTimeout(this.timeout)
    if (this.element) {
      this.element.remove()
      this.element = null
    }
  }

  update(editorView: EditorView<any, any, any>, prevState: EditorState<any, any, any>) {
    if (this.cursorPos != null && prevState.doc !== editorView.state.doc) {
      if (this.cursorPos > editorView.state.doc.content.size) this.setCursor(null)
      else this.updateOverlay()
    }
  }

  setCursor(pos: number | null) {
    if (pos === this.cursorPos) return
    this.cursorPos = pos
    if (pos == null) {
      this.element?.remove()
      this.element = null
    } else {
      this.updateOverlay()
    }
  }

  updateOverlay() {
    const view = this.editorView
    const $pos = view.state.doc.resolveUnsafe(this.cursorPos!)
    const isBlock = !$pos.parent.inlineContent
    let rect: { left: number; right: number; top: number; bottom: number } | undefined
    const editorDOM = view.dom, editorRect = editorDOM.getBoundingClientRect()
    const scaleX = editorRect.width / editorDOM.offsetWidth, scaleY = editorRect.height / editorDOM.offsetHeight
    if (isBlock) {
      const before = $pos.nodeBeforeOrNull, after = $pos.nodeAfterOrNull
      if (before || after) {
        const node = Option.getOrNull(view.nodeDOM(this.cursorPos! - (before ? before.nodeSize : 0)))
        if (node) {
          const nodeRect = (node as HTMLElement).getBoundingClientRect()
          let top = before ? nodeRect.bottom : nodeRect.top
          if (before && after) {
            const afterDOM = Option.getOrNull(view.nodeDOM(this.cursorPos!)) as HTMLElement | null
            if (afterDOM) top = (top + afterDOM.getBoundingClientRect().top) / 2
          }
          const halfWidth = (this.width / 2) * scaleY
          rect = { left: nodeRect.left, right: nodeRect.right, top: top - halfWidth, bottom: top + halfWidth }
        }
      }
    }
    if (!rect) {
      const coords = view.coordsAtPos(this.cursorPos!)
      const halfWidth = (this.width / 2) * scaleX
      rect = { left: coords.left - halfWidth, right: coords.left + halfWidth, top: coords.top, bottom: coords.bottom }
    }

    const doc = editorDOM.ownerDocument
    const parent = editorDOM.offsetParent as HTMLElement | null
    if (!this.element) {
      this.element = (parent ?? doc.body).appendChild(doc.createElement("div"))
      if (this.class) this.element.className = this.class
      this.element.style.cssText = "position: absolute; z-index: 50; pointer-events: none;"
      if (this.color) this.element.style.backgroundColor = this.color
    }
    this.element.classList.toggle("prosemirror-dropcursor-block", isBlock)
    this.element.classList.toggle("prosemirror-dropcursor-inline", !isBlock)
    let parentLeft: number, parentTop: number
    const win = doc.defaultView ?? window
    if (!parent || parent === doc.body && win.getComputedStyle(parent).position === "static") {
      parentLeft = -win.pageXOffset
      parentTop = -win.pageYOffset
    } else {
      const rect = parent.getBoundingClientRect()
      const parentScaleX = rect.width / parent.offsetWidth, parentScaleY = rect.height / parent.offsetHeight
      parentLeft = rect.left - parent.scrollLeft * parentScaleX
      parentTop = rect.top - parent.scrollTop * parentScaleY
    }
    this.element.style.left = (rect.left - parentLeft) / scaleX + "px"
    this.element.style.top = (rect.top - parentTop) / scaleY + "px"
    this.element.style.width = (rect.right - rect.left) / scaleX + "px"
    this.element.style.height = (rect.bottom - rect.top) / scaleY + "px"
  }

  scheduleRemoval(timeout: number) {
    clearTimeout(this.timeout)
    this.timeout = setTimeout(() => this.setCursor(null), timeout)
  }

  dragover(event: DragEvent) {
    const view = this.editorView
    if (!view.editable) return
    const pos = Option.getOrNull(view.posAtCoords({ left: event.clientX, top: event.clientY }))

    const node = pos && pos.inside >= 0 ? view.state.doc.nodeAtOrNull(pos.inside) : null
    const disableDropCursor = node ? node.type.spec.disableDropCursor as DisableDropCursor | undefined : undefined
    const disabled = typeof disableDropCursor === "function"
      ? disableDropCursor(view, pos!, event)
      : disableDropCursor

    if (pos && !disabled) {
      let target = pos.pos
      if (view.dragging && view.dragging.slice) {
        const point = Option.getOrNull(dropPoint(view.state.doc, target, view.dragging.slice))
        if (point != null) target = point
      }
      this.setCursor(target)
      this.scheduleRemoval(5000)
    }
  }

  dragend() {
    this.scheduleRemoval(20)
  }

  drop() {
    this.scheduleRemoval(20)
  }

  dragleave(event: DragEvent) {
    if (!this.editorView.dom.contains(event.relatedTarget as globalThis.Node | null)) this.setCursor(null)
  }
}
