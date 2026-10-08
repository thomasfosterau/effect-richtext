/**
 * A `prosemirror-view`-compatible facade over `effect-richtext/view`.
 *
 * `new EditorView(place, props)` creates a core view with
 * `EditorView.makeUnsafe`, translating the ProseMirror-style props
 * (which receive and return facades) into core props. Decorations wrap
 * core decorations.
 *
 * Ported API surface from prosemirror-view (MIT, Marijn Haverbeke and others).
 *
 * @since 0.1.0
 */
import * as Option from "effect/Option"
import * as V from "../view.ts"
import { DecorationGroup as CoreDecorationGroup } from "../view/decoration.ts"
import { adopt, CORE, guard, link, registerWrapper, unwrap, unwrapArray, wrap, wrapArray } from "./internal/core.ts"
import { type PropsCache, propsToCore } from "./internal/props.ts"
import type { DOMParser, DOMSerializer, Mark, Node, ResolvedPos, Slice } from "./model.ts"
import type { EditorState, Plugin, Selection, Transaction } from "./state.ts"
import type { Mapping } from "./transform.ts"

/**
 * A DOM node.
 *
 * @since 0.1.0
 * @category models
 */
export type DOMNode = globalThis.Node

/**
 * A rectangle.
 *
 * @since 0.1.0
 * @category models
 */
export type Rect = { left: number; right: number; top: number; bottom: number }

/**
 * A record of a DOM mutation.
 *
 * @since 0.1.0
 * @category models
 */
export type ViewMutationRecord = MutationRecord | { type: "selection"; target: DOMNode }

// -----------------------------------------------------------------------------
// Decorations
// -----------------------------------------------------------------------------

const ORIGINAL: unique symbol = Symbol.for("effect-richtext/compat/original") as never

/**
 * A set of attributes to add to a decorated node.
 *
 * @since 0.1.0
 * @category models
 */
export type DecorationAttrs = {
  nodeName?: string
  class?: string
  style?: string
  [attribute: string]: string | undefined
}

const widgetConstructors = new WeakMap<object, V.WidgetConstructor>()

const widgetToCore = (toDOM: any): V.WidgetConstructor => {
  if (typeof toDOM !== "function") return toDOM
  let found = widgetConstructors.get(toDOM)
  if (!found) {
    found = (view, getPos) => toDOM(wrap(view), getPos)
    widgetConstructors.set(toDOM, found)
  }
  return found
}

const specToCore = (spec: any): any => {
  if (!spec || !spec.marks) return spec
  return { ...spec, marks: unwrapArray(spec.marks), [ORIGINAL]: spec }
}

const originalSpec = (spec: any): any => spec && (spec[ORIGINAL] ?? spec)

/**
 * Decoration objects can be provided to the view through the
 * `decorations` prop.
 *
 * @since 0.1.0
 * @category models
 */
export class Decoration {
  /** @internal */
  declare readonly [CORE]: V.Decoration

  /** The start position of the decoration. */
  get from(): number {
    return this[CORE].from
  }

  /** The end position. Will be the same as `from` for widget decorations. */
  get to(): number {
    return this[CORE].to
  }

  /** @internal */
  get type(): any {
    return this[CORE].type
  }

  /** The spec provided when creating this decoration. */
  get spec(): any {
    return originalSpec(this[CORE].spec)
  }

  /** @internal */
  get inline(): boolean {
    return this[CORE].inline
  }

  /** @internal */
  get widget(): boolean {
    return this[CORE].widget
  }

  /** @internal */
  eq(other: Decoration, offset = 0): boolean {
    return this[CORE].eq(other[CORE], offset)
  }

  /** Creates a widget decoration, which is a DOM node that's shown in the document at the given position. */
  static widget(
    pos: number,
    toDOM: ((view: EditorView, getPos: () => number | undefined) => DOMNode) | DOMNode,
    spec?: {
      side?: number
      relaxedSide?: boolean
      marks?: ReadonlyArray<Mark>
      stopEvent?: (event: Event) => boolean
      ignoreSelection?: boolean
      key?: string
      destroy?: (node: DOMNode) => void
      [key: string]: any
    }
  ): Decoration {
    return wrap(V.Decoration.widget(pos, widgetToCore(toDOM), specToCore(spec)))
  }

  /** Creates an inline decoration, which adds the given attributes to each inline node between `from` and `to`. */
  static inline(
    from: number,
    to: number,
    attrs: DecorationAttrs,
    spec?: { inclusiveStart?: boolean; inclusiveEnd?: boolean; [key: string]: any }
  ): Decoration {
    return wrap(V.Decoration.inline(from, to, attrs, spec))
  }

  /** Creates a node decoration. */
  static node(from: number, to: number, attrs: DecorationAttrs, spec?: any): Decoration {
    return wrap(V.Decoration.node(from, to, attrs, spec))
  }
}

registerWrapper(V.Decoration, (core) => adopt(Decoration.prototype, core))

/**
 * An object that can provide decorations.
 *
 * @since 0.1.0
 * @category models
 */
export interface DecorationSource {
  map: (mapping: Mapping, node: Node) => DecorationSource
  forChild(offset: number, child: Node): DecorationSource
  eq(other: DecorationSource): boolean
  forEachSet(f: (set: DecorationSet) => void): void
}

/**
 * A collection of decorations, organized in such a way that the
 * drawing algorithm can efficiently use and compare them.
 *
 * @since 0.1.0
 * @category models
 */
export class DecorationSet implements DecorationSource {
  /** @internal */
  declare readonly [CORE]: V.DecorationSet

  /** Create a set of decorations, using the structure of the given document. */
  static create(doc: Node, decorations: Array<Decoration>): DecorationSet {
    return wrap(V.DecorationSet.create(doc[CORE], decorations.map(unwrap)))
  }

  /** Find all decorations in this set which touch the given range (including decorations that start or end directly at the boundaries) and match the given predicate on their spec. */
  find(start?: number, end?: number, predicate?: (spec: any) => boolean): Array<Decoration> {
    return this[CORE].find(start, end, predicate && ((spec) => predicate(originalSpec(spec)))).map(wrap)
  }

  /** Map the set of decorations in response to a change in the document. */
  map(mapping: Mapping, doc: Node, options?: { onRemove?: (decorationSpec: any) => void }): DecorationSet {
    const onRemove = options && options.onRemove
    return wrap(
      this[CORE].map(unwrap(mapping), doc[CORE], onRemove && { onRemove: (spec) => onRemove(originalSpec(spec)) })
    )
  }

  /** Add the given array of decorations to the ones in the set, producing a new set. */
  add(doc: Node, decorations: Array<Decoration>): DecorationSet {
    return wrap(this[CORE].add(doc[CORE], decorations.map(unwrap)))
  }

  /** Create a new set that contains the decorations in this set, minus the ones in the given array. */
  remove(decorations: Array<Decoration>): DecorationSet {
    return wrap(this[CORE].remove(decorations.map(unwrap)))
  }

  /** @internal */
  forChild(offset: number, node: Node): DecorationSource {
    return wrap(this[CORE].forChild(offset, node[CORE]))
  }

  /** @internal */
  eq(other: DecorationSource): boolean {
    return this[CORE].eq(unwrap(other))
  }

  /** @internal */
  locals(node: Node): ReadonlyArray<Decoration> {
    return wrapArray(this[CORE].locals(node[CORE]))
  }

  /** @internal */
  forEachSet(f: (set: DecorationSet) => void): void {
    this[CORE].forEachSet((set) => f(wrap(set)))
  }

  /** The empty set of decorations. */
  static empty: DecorationSet

  /** @internal */
  static removeOverlap(spans: ReadonlyArray<Decoration>): Array<Decoration> {
    return V.DecorationSet.removeOverlap(unwrapArray(spans) as Array<V.Decoration>).map(wrap)
  }
}

registerWrapper(V.DecorationSet, (core) => adopt(DecorationSet.prototype, core))
DecorationSet.empty = wrap(V.DecorationSet.empty)

/** A facade for the core's (non-exported) group of decoration sources. @internal */
class DecorationGroup implements DecorationSource {
  declare readonly [CORE]: V.DecorationSource
  map(mapping: Mapping, doc: Node): DecorationSource {
    return wrap(this[CORE].map(unwrap(mapping), doc[CORE]))
  }
  forChild(offset: number, child: Node): DecorationSource {
    return wrap(this[CORE].forChild(offset, child[CORE]))
  }
  eq(other: DecorationSource): boolean {
    return this[CORE].eq(unwrap(other))
  }
  forEachSet(f: (set: DecorationSet) => void): void {
    this[CORE].forEachSet((set) => f(wrap(set)))
  }
  locals(node: Node): ReadonlyArray<Decoration> {
    return wrapArray(this[CORE].locals(node[CORE]))
  }
}

registerWrapper(CoreDecorationGroup, (core) => adopt(DecorationGroup.prototype, core))

// -----------------------------------------------------------------------------
// Props
// -----------------------------------------------------------------------------

/**
 * By default, document nodes are rendered using the result of the
 * `toDOM` method of their spec, and managed entirely by the editor.
 * For some use cases you want more control; node views allow that.
 *
 * @since 0.1.0
 * @category models
 */
export interface NodeView {
  dom: DOMNode
  contentDOM?: HTMLElement | null | undefined
  update?:
    | ((node: Node, decorations: ReadonlyArray<Decoration>, innerDecorations: DecorationSource) => boolean)
    | undefined
  multiType?: boolean | undefined
  selectNode?: (() => void) | undefined
  deselectNode?: (() => void) | undefined
  setSelection?: ((anchor: number, head: number, root: Document | ShadowRoot) => void) | undefined
  stopEvent?: ((event: Event) => boolean) | undefined
  ignoreMutation?: ((mutation: ViewMutationRecord) => boolean) | undefined
  destroy?: (() => void) | undefined
}

/**
 * Objects returned as mark views.
 *
 * @since 0.1.0
 * @category models
 */
export interface MarkView {
  dom: HTMLElement
  contentDOM?: HTMLElement | null | undefined
  ignoreMutation?: ((mutation: ViewMutationRecord) => boolean) | undefined
  destroy?: (() => void) | undefined
}

/**
 * The type of function provided to create node views.
 *
 * @since 0.1.0
 * @category models
 */
export type NodeViewConstructor = (
  node: Node,
  view: EditorView,
  getPos: () => number | undefined,
  decorations: ReadonlyArray<Decoration>,
  innerDecorations: DecorationSource
) => NodeView

/**
 * The function types used to create mark views.
 *
 * @since 0.1.0
 * @category models
 */
export type MarkViewConstructor = (mark: Mark, view: EditorView, inline: boolean) => MarkView

/**
 * Helper type that maps event names to event object types.
 *
 * @since 0.1.0
 * @category models
 */
export interface DOMEventMap extends HTMLElementEventMap {
  [event: string]: any
}

/**
 * Props are configuration values that can be passed to an editor view
 * or included in a plugin.
 *
 * @since 0.1.0
 * @category models
 */
export interface EditorProps<P = any> {
  handleDOMEvents?: {
    [event in keyof DOMEventMap]?: (this: P, view: EditorView, event: DOMEventMap[event]) => boolean | void
  }
  handleKeyDown?: ((this: P, view: EditorView, event: KeyboardEvent) => boolean | void) | undefined
  handleKeyPress?: ((this: P, view: EditorView, event: KeyboardEvent) => boolean | void) | undefined
  handleTextInput?: (
    this: P,
    view: EditorView,
    from: number,
    to: number,
    text: string,
    deflt: () => Transaction
  ) => boolean | void
  handleClickOn?: (
    this: P,
    view: EditorView,
    pos: number,
    node: Node,
    nodePos: number,
    event: MouseEvent,
    direct: boolean
  ) => boolean | void
  handleClick?: ((this: P, view: EditorView, pos: number, event: MouseEvent) => boolean | void) | undefined
  handleDoubleClickOn?: (
    this: P,
    view: EditorView,
    pos: number,
    node: Node,
    nodePos: number,
    event: MouseEvent,
    direct: boolean
  ) => boolean | void
  handleDoubleClick?: ((this: P, view: EditorView, pos: number, event: MouseEvent) => boolean | void) | undefined
  handleTripleClickOn?: (
    this: P,
    view: EditorView,
    pos: number,
    node: Node,
    nodePos: number,
    event: MouseEvent,
    direct: boolean
  ) => boolean | void
  handleTripleClick?: ((this: P, view: EditorView, pos: number, event: MouseEvent) => boolean | void) | undefined
  handlePaste?: ((this: P, view: EditorView, event: ClipboardEvent, slice: Slice) => boolean | void) | undefined
  handleDrop?:
    | ((this: P, view: EditorView, event: DragEvent, slice: Slice, moved: boolean) => boolean | void)
    | undefined
  handleScrollToSelection?: ((this: P, view: EditorView) => boolean) | undefined
  dragCopies?: ((event: DragEvent) => boolean) | undefined
  createSelectionBetween?: (
    this: P,
    view: EditorView,
    anchor: ResolvedPos,
    head: ResolvedPos
  ) => Selection | null | undefined
  domParser?: DOMParser | undefined
  transformPastedHTML?: ((this: P, html: string, view: EditorView) => string) | undefined
  clipboardParser?: DOMParser | undefined
  transformPastedText?: ((this: P, text: string, plain: boolean, view: EditorView) => string) | undefined
  clipboardTextParser?: (
    this: P,
    text: string,
    $context: ResolvedPos,
    plain: boolean,
    view: EditorView
  ) => Slice | null | undefined
  transformPasted?: ((this: P, slice: Slice, view: EditorView, plain: boolean) => Slice) | undefined
  transformCopied?: ((this: P, slice: Slice, view: EditorView) => Slice) | undefined
  nodeViews?: { [node: string]: NodeViewConstructor } | undefined
  markViews?: { [mark: string]: MarkViewConstructor } | undefined
  clipboardSerializer?: DOMSerializer | undefined
  clipboardTextSerializer?: ((this: P, content: Slice, view: EditorView) => string) | undefined
  decorations?: ((this: P, state: EditorState) => DecorationSource | null) | undefined
  editable?: ((this: P, state: EditorState) => boolean) | undefined
  attributes?: (({ [name: string]: string } | ((state: EditorState) => { [name: string]: string }))) | undefined
  scrollThreshold?: number | { top: number; right: number; bottom: number; left: number } | undefined
  scrollMargin?: number | { top: number; right: number; bottom: number; left: number } | undefined
}

/**
 * The props object given directly to the editor view supports some
 * fields that can't be used in plugins.
 *
 * @since 0.1.0
 * @category models
 */
export interface DirectEditorProps extends EditorProps {
  state: EditorState
  plugins?: ReadonlyArray<Plugin> | undefined
  dispatchTransaction?: ((this: EditorView, tr: Transaction) => void) | undefined
}

// -----------------------------------------------------------------------------
// EditorView
// -----------------------------------------------------------------------------

let constructing: EditorView | null = null

/**
 * An editor view manages the DOM structure that represents an editable
 * document.
 *
 * @since 0.1.0
 * @category models
 */
export class EditorView {
  /** @internal */
  declare readonly [CORE]: V.EditorView<any, any, any>
  /** @internal */
  declare _props: DirectEditorProps
  /** @internal */
  declare private propsCache: PropsCache

  /** Create a view. */
  constructor(
    place: null | DOMNode | ((editor: HTMLElement) => void) | { mount: HTMLElement },
    props: DirectEditorProps
  ) {
    this._props = props
    this.propsCache = new WeakMap()
    this.dispatch = this.dispatch.bind(this)
    const prev = constructing
    constructing = this
    try {
      const core = guard(() => V.EditorView.makeUnsafe(place, this.propsToCore(props)))
      link(this, core)
    } finally {
      constructing = prev
    }
  }

  private propsToCore(props: Partial<DirectEditorProps>): any {
    return propsToCore(props, this, this.propsCache)
  }

  /** The view's current state. */
  get state(): EditorState {
    return wrap(this[CORE].state)
  }

  /** An editable DOM node containing the document. */
  get dom(): HTMLElement {
    return this[CORE].dom
  }

  /** Indicates whether the editor is currently editable. */
  get editable(): boolean {
    return this[CORE].editable
  }

  /** When editor content is being dragged, this object contains information about the dragged slice and whether it is being copied or moved. */
  get dragging(): null | { readonly slice: Slice; readonly move: boolean } {
    const dragging = this[CORE].dragging
    return dragging && { slice: wrap(dragging.slice), move: dragging.move }
  }

  set dragging(value: null | { readonly slice: Slice; readonly move: boolean }) {
    this[CORE].dragging = value && { slice: value.slice[CORE], move: value.move }
  }

  /** Holds `true` when a composition is active. */
  get composing(): boolean {
    return this[CORE].composing
  }

  /** The view's current props. */
  get props(): DirectEditorProps {
    if (this._props.state != this.state) {
      const prev = this._props
      this._props = {} as DirectEditorProps
      for (const name in prev) (this._props as any)[name] = (prev as any)[name]
      this._props.state = this.state
    }
    return this._props
  }

  /** Update the view's props. Will immediately cause an update to the DOM. */
  update(props: DirectEditorProps): void {
    this._props = props
    guard(() => this[CORE].update(this.propsToCore(props)))
  }

  /** Update the view by updating existing props object with the object given as argument. */
  setProps(props: Partial<DirectEditorProps>): void {
    const updated: any = {}
    for (const name in this._props) updated[name] = (this._props as any)[name]
    updated.state = this.state
    for (const name in props) updated[name] = (props as any)[name]
    this.update(updated)
  }

  /** Update the editor's `state` prop, without touching any of the other props. */
  updateState(state: EditorState): void {
    guard(() => this[CORE].updateState(state[CORE]))
  }

  /** Goes over the values of a prop, first those provided directly, then those from plugins given to the view, then from plugins in the state (in order), and calls `f` every time a non-undefined value is found. */
  someProp<PropName extends keyof EditorProps, Result>(
    propName: PropName,
    f: (value: NonNullable<EditorProps[PropName]>) => Result
  ): Result | undefined
  someProp<PropName extends keyof EditorProps>(propName: PropName): NonNullable<EditorProps[PropName]> | undefined
  someProp<PropName extends keyof EditorProps, Result>(
    propName: PropName,
    f?: (value: NonNullable<EditorProps[PropName]>) => Result
  ): Result | undefined {
    const prop = this._props && this._props[propName]
    let value
    if (prop != null && (value = f ? f(prop as any) : prop)) return value as any
    const direct = this._props.plugins || []
    for (let i = 0; i < direct.length; i++) {
      const prop = direct[i]!.props[propName]
      if (prop != null && (value = f ? f(prop as any) : prop)) return value as any
    }
    const plugins = this.state.plugins
    if (plugins) {
      for (let i = 0; i < plugins.length; i++) {
        const prop = plugins[i]!.props[propName]
        if (prop != null && (value = f ? f(prop as any) : prop)) return value as any
      }
    }
    return undefined
  }

  /** Query whether the view has focus. */
  hasFocus(): boolean {
    return this[CORE].hasFocus()
  }

  /** Focus the editor. */
  focus(): void {
    this[CORE].focus()
  }

  /** Get the document root in which the editor exists. */
  get root(): Document | ShadowRoot {
    return this[CORE].root
  }

  /** When an existing editor view is moved to a new document or shadow tree, call this to make it recompute its root. */
  updateRoot(): void {
    this[CORE].updateRoot()
  }

  /** Given a pair of viewport coordinates, return the document position that corresponds to them. */
  posAtCoords(coords: { left: number; top: number }): { pos: number; inside: number } | null {
    return Option.getOrNull(this[CORE].posAtCoords(coords)) as { pos: number; inside: number } | null
  }

  /** Returns the viewport rectangle at a given document position. */
  coordsAtPos(pos: number, side = 1): Rect {
    return guard(() => this[CORE].coordsAtPos(pos, side))
  }

  /** Find the DOM position that corresponds to the given document position. */
  domAtPos(pos: number, side = 0): { node: DOMNode; offset: number } {
    return guard(() => this[CORE].domAtPos(pos, side))
  }

  /** Find the DOM node that represents the document node after the given position. */
  nodeDOM(pos: number): DOMNode | null {
    return Option.getOrNull(this[CORE].nodeDOM(pos))
  }

  /** Find the document position that corresponds to a given DOM position. */
  posAtDOM(node: DOMNode, offset: number, bias = -1): number {
    return guard(() => this[CORE].posAtDOMUnsafe(node, offset, bias))
  }

  /** Find out whether the selection is at the end of a textblock when moving in a given direction. */
  endOfTextblock(dir: "up" | "down" | "left" | "right" | "forward" | "backward", state?: EditorState): boolean {
    return this[CORE].endOfTextblock(dir, state && state[CORE])
  }

  /** Run the editor's paste logic with the given HTML string. */
  pasteHTML(html: string, event?: ClipboardEvent): boolean {
    return guard(() => this[CORE].pasteHTML(html, event))
  }

  /** Run the editor's paste logic with the given plain-text input. */
  pasteText(text: string, event?: ClipboardEvent): boolean {
    return guard(() => this[CORE].pasteText(text, event))
  }

  /** Serialize the given slice as it would be if it was copied from this editor. */
  serializeForClipboard(slice: Slice): { dom: HTMLElement; text: string; slice: Slice } {
    const result = guard(() => this[CORE].serializeForClipboard(slice[CORE]))
    return { dom: result.dom, text: result.text, slice: wrap(result.slice) }
  }

  /** Removes the editor from the DOM and destroys all node views. */
  destroy(): void {
    this[CORE].destroy()
  }

  /** This is true when the view has been destroyed (and thus should not be used anymore). */
  get isDestroyed(): boolean {
    return this[CORE].isDestroyed
  }

  /** Used for testing. */
  dispatchEvent(event: Event): void {
    this[CORE].dispatchEvent(event)
  }

  /** Dispatch a transaction. */
  dispatch(tr: Transaction): void {
    guard(() => this[CORE].dispatchUnsafe(tr[CORE]))
  }

  /** @internal */
  domSelectionRange(): any {
    return this[CORE].domSelectionRange()
  }

  /** @internal */
  domSelection(): globalThis.Selection | null {
    return this[CORE].domSelection() as globalThis.Selection | null
  }

  /** @internal */
  scrollToSelection(): void {
    this[CORE].scrollToSelection()
  }

  /** @internal */
  get domObserver(): any {
    return (this[CORE] as any).domObserver
  }

  /** @internal */
  get docView(): any {
    return this[CORE].docView
  }

  /** @internal */
  get input(): any {
    return this[CORE].input
  }

  /** @internal */
  get focused(): boolean {
    return (this[CORE] as any).focused
  }

  /** @internal */
  get markCursor(): ReadonlyArray<Mark> | null {
    const marks = this[CORE].markCursor
    return marks && wrapArray(marks)
  }

  /** @internal */
  get cursorWrapper(): any {
    return this[CORE].cursorWrapper
  }

  /** @internal */
  get lastSelectedViewDesc(): any {
    return this[CORE].lastSelectedViewDesc
  }

  /** @internal */
  get trackWrites(): DOMNode | null {
    return this[CORE].trackWrites
  }

  /** @internal */
  get nodeViews(): any {
    return this[CORE].nodeViews
  }
}

registerWrapper(V.EditorView, (core: V.EditorView<any, any, any>) => {
  if (constructing && !(CORE in constructing)) return constructing
  // A view created through the core API: give it a facade whose props
  // are the core props.
  const view = adopt<EditorView>(EditorView.prototype, core)
  view._props = core.props as any
  ;(view as any).propsCache = new WeakMap()
  view.dispatch = view.dispatch.bind(view)
  return view
})

/** @internal */
export const __parseFromClipboard = (
  view: EditorView,
  text: string,
  html: string | null,
  plainText: boolean,
  $context: ResolvedPos
): Slice | null => wrap(V.__parseFromClipboard(view[CORE], text, html, plainText, $context[CORE]))

/** @internal */
export const __endComposition = (view: EditorView, restarting = false): boolean =>
  V.__endComposition(view[CORE], restarting)

// -----------------------------------------------------------------------------
// toCore / fromCore
// -----------------------------------------------------------------------------

/**
 * Get the core (Effect API) object behind a facade.
 *
 * @since 0.1.0
 * @category conversions
 */
export function toCore(view: EditorView): V.EditorView<any, any, any>
export function toCore(decoration: Decoration): V.Decoration
export function toCore(set: DecorationSet): V.DecorationSet
export function toCore(source: DecorationSource): V.DecorationSource
export function toCore(value: unknown): unknown {
  return unwrap(value)
}

/**
 * Get the facade for a core (Effect API) object.
 *
 * @since 0.1.0
 * @category conversions
 */
export function fromCore(view: V.EditorView<any, any, any>): EditorView
export function fromCore(decoration: V.Decoration): Decoration
export function fromCore(set: V.DecorationSet): DecorationSet
export function fromCore(source: V.DecorationSource): DecorationSource
export function fromCore(value: unknown): unknown {
  return wrap(value)
}
