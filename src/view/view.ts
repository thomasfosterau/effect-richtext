// Ported from prosemirror-view (MIT, Marijn Haverbeke and others)
/**
 * The editor view.
 *
 * @since 0.1.0
 */
import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import { PreventSchedulerYield } from "effect/Scheduler"
import type * as Scope from "effect/Scope"
import type {
  AnySchema,
  DOMParser,
  DOMSerializer,
  Mark,
  MarkNames,
  Node,
  NodeNames,
  ResolvedPos,
  Slice
} from "../model.ts"
import {
  type EditorState,
  NodeSelection,
  type Plugin,
  type PluginView,
  type Selection,
  type StateFailure,
  type Transaction
} from "../state.ts"
import * as browser from "./browser.ts"
import { parseFromClipboard, serializeForClipboard } from "./clipboard.ts"
import { Decoration, type DecorationSource, viewDecorations } from "./decoration.ts"
import { clearReusedRange, deepActiveElement, type DOMNode, type DOMSelection, type DOMSelectionRange } from "./dom.ts"
import { readDOMChange } from "./domchange.ts"
import {
  coordsAtPos,
  endOfTextblock,
  focusPreventScroll,
  posAtCoords,
  type Rect,
  resetScrollPos,
  scrollRectIntoView,
  storeScrollPos,
  type TextblockDir
} from "./domcoords.ts"
import { DOMObserver, safariShadowSelectionRange } from "./domobserver.ts"
import { ViewError } from "./errors.ts"
import {
  clearComposition,
  destroyInput,
  dispatchEvent,
  doPaste,
  Dragging,
  endComposition,
  ensureListeners,
  findCompositionNode,
  initInput,
  InputState
} from "./input.ts"
import { anchorInRightPlace, selectionToDOM, syncNodeSelection } from "./selection.ts"
import {
  docViewDesc,
  type MarkViewConstructor,
  type NodeViewConstructor,
  type NodeViewDesc,
  type ViewDesc
} from "./viewdesc.ts"

/** @internal */
export const __parseFromClipboard = parseFromClipboard
/** @internal */
export const __endComposition = endComposition

/**
 * The value an event-handling prop may return: `true` when it handled
 * the event, `false`/`undefined` when it didn't, or an `Effect` that
 * produces that boolean.
 *
 * Effects are run with the context captured when the view was created.
 * When the effect completes synchronously, its result is used exactly
 * like a plain boolean. When it suspends (is asynchronous), the event is
 * treated as handled (`true`) and the effect keeps running in the
 * background. Failures are reported to the view's `onError` prop and
 * treated as "not handled".
 *
 * @since 0.1.0
 * @category models
 */
export type HandlerResult<R = never, E = never> = boolean | void | Effect.Effect<boolean, E, R>

/**
 * Helper type that maps event names to event object types, but includes
 * events that TypeScript's `HTMLElementEventMap` doesn't know about.
 *
 * @since 0.1.0
 * @category models
 */
export interface DOMEventMap extends HTMLElementEventMap {
  [event: string]: any
}

/**
 * Node view constructors, keyed (and typed) by node name.
 *
 * @since 0.1.0
 * @category models
 */
export type NodeViews<Sc extends AnySchema = AnySchema> = {
  readonly [N in NodeNames<Sc>]?: NodeViewConstructor<Sc, N> | undefined
}

/**
 * Mark view constructors, keyed (and typed) by mark name.
 *
 * @since 0.1.0
 * @category models
 */
export type MarkViews<Sc extends AnySchema = AnySchema> = {
  readonly [M in MarkNames<Sc>]?: MarkViewConstructor<Sc, M> | undefined
}

/**
 * Something that can serialize a fragment for the clipboard (usually a
 * `DOMSerializer`).
 *
 * @since 0.1.0
 * @category models
 */
export type ClipboardSerializer<Sc extends AnySchema = AnySchema> = Pick<DOMSerializer<Sc>, "serializeFragment">

/**
 * Props are configuration values that can be passed to an editor view
 * or included in a plugin. This interface lists the supported props.
 *
 * The various event-handling functions may all return `true` to
 * indicate that they handled the given event, or an `Effect` producing
 * that boolean (see `HandlerResult`). The view will then take care to
 * call `preventDefault` on the event, except with `handleDOMEvents`,
 * where the handler itself is responsible for that.
 *
 * How a prop is resolved depends on the prop. Handler functions are
 * called one at a time, starting with the base props and then searching
 * through the plugins (in order of appearance) until one of them returns
 * true. For some props, the first plugin that yields a value gets
 * precedence.
 *
 * The view passed to props is typed `EditorView<Sc, any, any>`:
 * handler effects run with the view's captured context anyway.
 *
 * The optional `P` type parameter refers to the type of `this` in prop
 * functions, and is used to pass in the plugin type when defining a
 * plugin.
 *
 * @since 0.1.0
 * @category models
 */
export interface EditorProps<Sc extends AnySchema = AnySchema, R = never, E = never, P = any> {
  /**
   * Can be an object mapping DOM event type names to functions that
   * handle them. Such functions will be called before any handling the
   * view does of events fired on the editable DOM element. Contrary to
   * the other event handling props, when returning true from such a
   * function, you are responsible for calling `preventDefault` yourself
   * (or not, if you want to allow the default behavior).
   */
  readonly handleDOMEvents?:
    | {
      readonly [event in keyof DOMEventMap]?:
        | ((this: P, view: EditorView<Sc, any, any>, event: DOMEventMap[event]) => HandlerResult<R, E>)
        | undefined
    }
    | undefined

  /** Called when the editor receives a `keydown` event. */
  readonly handleKeyDown?:
    | ((this: P, view: EditorView<Sc, any, any>, event: KeyboardEvent) => HandlerResult<R, E>)
    | undefined

  /** Handler for `keypress` events. */
  readonly handleKeyPress?:
    | ((this: P, view: EditorView<Sc, any, any>, event: KeyboardEvent) => HandlerResult<R, E>)
    | undefined

  /**
   * Whenever the user directly input text, this handler is called before
   * the input is applied. If it returns `true`, the default behavior of
   * actually inserting the text is suppressed.
   */
  readonly handleTextInput?:
    | ((
      this: P,
      view: EditorView<Sc, any, any>,
      from: number,
      to: number,
      text: string,
      deflt: () => Transaction<Sc>
    ) => HandlerResult<R, E>)
    | undefined

  /**
   * Called for each node around a click, from the inside out. The
   * `direct` flag will be true for the inner node.
   */
  readonly handleClickOn?:
    | ((
      this: P,
      view: EditorView<Sc, any, any>,
      pos: number,
      node: Node<Sc>,
      nodePos: number,
      event: MouseEvent,
      direct: boolean
    ) => HandlerResult<R, E>)
    | undefined

  /** Called when the editor is clicked, after `handleClickOn` handlers have been called. */
  readonly handleClick?:
    | ((this: P, view: EditorView<Sc, any, any>, pos: number, event: MouseEvent) => HandlerResult<R, E>)
    | undefined

  /** Called for each node around a double click. */
  readonly handleDoubleClickOn?:
    | ((
      this: P,
      view: EditorView<Sc, any, any>,
      pos: number,
      node: Node<Sc>,
      nodePos: number,
      event: MouseEvent,
      direct: boolean
    ) => HandlerResult<R, E>)
    | undefined

  /** Called when the editor is double-clicked, after `handleDoubleClickOn`. */
  readonly handleDoubleClick?:
    | ((this: P, view: EditorView<Sc, any, any>, pos: number, event: MouseEvent) => HandlerResult<R, E>)
    | undefined

  /** Called for each node around a triple click. */
  readonly handleTripleClickOn?:
    | ((
      this: P,
      view: EditorView<Sc, any, any>,
      pos: number,
      node: Node<Sc>,
      nodePos: number,
      event: MouseEvent,
      direct: boolean
    ) => HandlerResult<R, E>)
    | undefined

  /** Called when the editor is triple-clicked, after `handleTripleClickOn`. */
  readonly handleTripleClick?:
    | ((this: P, view: EditorView<Sc, any, any>, pos: number, event: MouseEvent) => HandlerResult<R, E>)
    | undefined

  /**
   * Can be used to override the behavior of pasting. `slice` is the
   * pasted content parsed by the editor, but you can directly access the
   * event to get at the raw content.
   */
  readonly handlePaste?:
    | ((this: P, view: EditorView<Sc, any, any>, event: ClipboardEvent, slice: Slice<Sc>) => HandlerResult<R, E>)
    | undefined

  /**
   * Called when something is dropped on the editor. `moved` will be true
   * if this drop moves from the current selection (which should thus be
   * deleted).
   */
  readonly handleDrop?:
    | ((
      this: P,
      view: EditorView<Sc, any, any>,
      event: DragEvent,
      slice: Slice<Sc>,
      moved: boolean
    ) => HandlerResult<R, E>)
    | undefined

  /**
   * Called when the view, after updating its state, tries to scroll the
   * selection into view. A handler function may return false to indicate
   * that it did not handle the scrolling and further handlers or the
   * default behavior should be tried.
   */
  readonly handleScrollToSelection?: ((this: P, view: EditorView<Sc, any, any>) => HandlerResult<R, E>) | undefined

  /**
   * Determines whether an in-editor drag event should copy or move the
   * selection. When not given, the event's `altKey` property is used on
   * macOS, `ctrlKey` on other platforms.
   */
  readonly dragCopies?: ((event: DragEvent) => boolean) | undefined

  /**
   * Can be used to override the way a selection is created when reading
   * a DOM selection between the given anchor and head.
   */
  readonly createSelectionBetween?:
    | ((
      this: P,
      view: EditorView<Sc, any, any>,
      anchor: ResolvedPos<Sc>,
      head: ResolvedPos<Sc>
    ) => Selection<Sc> | null | undefined)
    | undefined

  /**
   * The parser to use when reading editor changes from the DOM. Defaults
   * to calling `DOMParser.fromSchema` on the editor's schema.
   */
  readonly domParser?: DOMParser<Sc> | undefined

  /**
   * Can be used to transform pasted HTML text, _before_ it is parsed, for
   * example to clean it up.
   */
  readonly transformPastedHTML?: ((this: P, html: string, view: EditorView<Sc, any, any>) => string) | undefined

  /**
   * The parser to use when reading content from the clipboard. When not
   * given, the value of the `domParser` prop is used.
   */
  readonly clipboardParser?: DOMParser<Sc> | undefined

  /**
   * Transform pasted plain text. The `plain` flag will be true when the
   * text is pasted as plain text.
   */
  readonly transformPastedText?:
    | ((this: P, text: string, plain: boolean, view: EditorView<Sc, any, any>) => string)
    | undefined

  /**
   * A function to parse text from the clipboard into a document slice.
   * Called after `transformPastedText`. The default behavior is to split
   * the text into lines, wrap them in `<p>` tags, and call
   * `clipboardParser` on it. The `plain` flag will be true when the text
   * is pasted as plain text.
   */
  readonly clipboardTextParser?:
    | ((
      this: P,
      text: string,
      $context: ResolvedPos<Sc>,
      plain: boolean,
      view: EditorView<Sc, any, any>
    ) => Slice<Sc> | null | undefined)
    | undefined

  /**
   * Can be used to transform pasted or dragged-and-dropped content
   * before it is applied to the document. The `plain` flag will be true
   * when the text is pasted as plain text.
   */
  readonly transformPasted?:
    | ((this: P, slice: Slice<Sc>, view: EditorView<Sc, any, any>, plain: boolean) => Slice<Sc>)
    | undefined

  /**
   * Can be used to transform copied or cut content before it is
   * serialized to the clipboard.
   */
  readonly transformCopied?: ((this: P, slice: Slice<Sc>, view: EditorView<Sc, any, any>) => Slice<Sc>) | undefined

  /**
   * Allows you to pass custom rendering and behavior logic for nodes.
   * Should map node names to constructor functions that produce a
   * `NodeView` object implementing the node's display behavior. The
   * constructors are typed per node name, so `node.attrs` is typed.
   *
   * The `getPos` argument is a function that can be called to get the
   * node's current position, which can be useful when creating
   * transactions to update it. Note that if the node is not in the
   * document, the position returned by this function will be
   * `undefined`.
   *
   * `decorations` is an array of node or inline decorations that are
   * active around the node. `innerDecorations` holds the decorations for
   * the node's content.
   */
  readonly nodeViews?: NodeViews<Sc> | undefined

  /**
   * Pass custom mark rendering functions. Note that these cannot provide
   * the kind of dynamic behavior that node views can—they just provide
   * custom rendering logic. The third argument indicates whether the
   * mark's content is inline.
   */
  readonly markViews?: MarkViews<Sc> | undefined

  /**
   * The DOM serializer to use when putting content onto the clipboard.
   * If not given, the result of `DOMSerializer.fromSchema` will be used.
   * This object will only have its `serializeFragment` method called.
   */
  readonly clipboardSerializer?: ClipboardSerializer<Sc> | undefined

  /**
   * A function that will be called to get the text for the current
   * selection when copying text to the clipboard. By default, the editor
   * will use `textBetween` on the selected range.
   */
  readonly clipboardTextSerializer?:
    | ((this: P, content: Slice<Sc>, view: EditorView<Sc, any, any>) => string)
    | undefined

  /** A set of document decorations to show in the view. */
  readonly decorations?:
    | ((this: P, state: EditorState<Sc>) => DecorationSource | null | undefined)
    | undefined

  /** When this returns false, the content of the view is not directly editable. */
  readonly editable?: ((this: P, state: EditorState<Sc>) => boolean) | undefined

  /**
   * Control the DOM attributes of the editable element. May be either an
   * object or a function going from an editor state to an object. By
   * default, the element will get a class `"ProseMirror"`, and will have
   * its `contentEditable` attribute determined by the `editable` prop.
   * Additional classes provided here will be added to the class. For
   * other attributes, the value provided first (as in `someProp`) will
   * be used.
   */
  readonly attributes?:
    | { readonly [name: string]: string }
    | ((state: EditorState<Sc>) => { readonly [name: string]: string } | null | undefined)
    | undefined

  /**
   * Determines the distance (in pixels) between the cursor and the end
   * of the visible viewport at which point, when scrolling the cursor
   * into view, scrolling takes place. Defaults to 0.
   */
  readonly scrollThreshold?: number | Rect | undefined

  /**
   * Determines the extra space (in pixels) that is left above or below
   * the cursor when it is scrolled into view. Defaults to 5.
   */
  readonly scrollMargin?: number | Rect | undefined
}

/**
 * The props object given directly to the editor view supports some
 * fields that can't be used in plugins.
 *
 * @since 0.1.0
 * @category models
 */
export interface DirectEditorProps<Sc extends AnySchema = AnySchema, R = never, E = never>
  extends EditorProps<Sc, R, E>
{
  /** The current state of the editor. */
  readonly state: EditorState<Sc, R, E>

  /**
   * A set of plugins to use in the view, applying their plugin view and
   * props. Passing plugins with a state component (a state field or a
   * transaction filter or appender) will result in an error (a defect),
   * since such plugins must be present in the state to work.
   */
  readonly plugins?: ReadonlyArray<Plugin<any, any, E, R>> | undefined

  /**
   * The callback over which to send transactions (state updates)
   * produced by the view. If you specify this, you probably want to make
   * sure this ends up calling the view's `updateState` method with a new
   * state that has the transaction applied. The callback will be bound
   * to have the view instance as its `this` binding. It may return an
   * `Effect`, which is run with the view's captured context.
   */
  readonly dispatchTransaction?: ((tr: Transaction<Sc>) => void | Effect.Effect<void, E, R>) | undefined

  /**
   * Called with the cause of failures of effects run by the view on
   * behalf of DOM events: event handler effects, dispatched
   * transactions (including failing plugin hooks) and
   * `dispatchTransaction` effects. Defaults to logging the cause with
   * `Effect.logError` (run with the view's captured context).
   */
  readonly onError?: ((cause: Cause.Cause<unknown>) => void) | undefined
}

/**
 * Where to put the editor: a DOM node that the editor should be appended
 * to, a function that will place it into the document, an object whose
 * `mount` property holds the node to use as the document container, or
 * `null` to not add it to the document.
 *
 * @since 0.1.0
 * @category models
 */
export type ViewPlace = null | DOMNode | ((editor: HTMLElement) => void) | { readonly mount: HTMLElement }

type NodeViewSet = { [name: string]: NodeViewConstructor<any, any> | MarkViewConstructor<any, any> }

/**
 * The result of `EditorView.posAtCoords`.
 *
 * @since 0.1.0
 * @category models
 */
export interface PosAtCoords {
  /** The position nearest to the coordinates. */
  readonly pos: number
  /**
   * The position of the inner node that the position falls inside of,
   * or -1 if it is at the top level, not in any node.
   */
  readonly inside: number
}

/**
 * The result of `EditorView.serializeForClipboard`.
 *
 * @since 0.1.0
 * @category models
 */
export interface ClipboardSerialization<Sc extends AnySchema = AnySchema> {
  readonly dom: HTMLElement
  readonly text: string
  readonly slice: Slice<Sc>
}

/**
 * @since 0.1.0
 * @category symbols
 */
export const EditorViewTypeId: unique symbol = Symbol.for("effect-richtext/view/EditorView") as never

/**
 * @since 0.1.0
 * @category symbols
 */
export type EditorViewTypeId = typeof EditorViewTypeId

/**
 * An editor view manages the DOM structure that represents an editable
 * document. Its state and behavior are determined by its props.
 *
 * `R` and `E` are the requirements and errors of the effects the view
 * runs: those of its state's plugins and of its effectful props. Create
 * a view with `EditorView.make`, inside an Effect that provides `R` and a
 * `Scope`: the view captures the current context to run handler effects
 * later, and is destroyed when the scope closes.
 *
 * @since 0.1.0
 * @category models
 */
export class EditorView<Sc extends AnySchema = AnySchema, R = never, E = never> {
  declare readonly [EditorViewTypeId]: {
    readonly _R: (_: never) => R
    readonly _E: (_: never) => E
  }

  /** @internal */
  _props: DirectEditorProps<Sc, R, E>
  private directPlugins: ReadonlyArray<Plugin<any, any, any, any>>
  private _root: Document | ShadowRoot | null = null
  /** @internal */
  focused = false
  /** Kludge used to work around a Chrome bug @internal */
  trackWrites: DOMNode | null = null
  private mounted = false
  /** @internal */
  markCursor: ReadonlyArray<Mark<any, any>> | null = null
  /** @internal */
  cursorWrapper: { dom: DOMNode; deco: Decoration } | null = null
  /** @internal */
  nodeViews: NodeViewSet
  /** @internal */
  lastSelectedViewDesc: ViewDesc | undefined = undefined
  /** @internal */
  docView: NodeViewDesc
  /** @internal */
  input: InputState = new InputState()
  private prevDirectPlugins: ReadonlyArray<Plugin<any, any, any, any>> = []
  private pluginViews: Array<PluginView<any>> = []
  /** @internal */
  declare domObserver: DOMObserver
  /**
   * Holds `true` when a hack node is needed in Firefox to prevent the
   * space is eaten issue.
   *
   * @internal
   */
  requiresGeckoHackNode: boolean = false
  /**
   * The context captured when the view was created, used to run effects.
   *
   * @internal
   */
  readonly context: Context.Context<any>
  private readonly runContext: Context.Context<any>

  /** The view's current state. */
  state: EditorState<Sc, R, E>

  /** @internal */
  constructor(place: ViewPlace, props: DirectEditorProps<Sc, R, E>, context: Context.Context<R>) {
    this.context = context
    this.runContext = Context.add(context, PreventSchedulerYield, true)
    this._props = props
    this.state = props.state
    this.directPlugins = props.plugins || []
    this.directPlugins.forEach(checkStateComponent)

    this.dom = (place && (place as { mount: HTMLElement }).mount) || document.createElement("div")
    if (place) {
      if ((place as DOMNode).appendChild) (place as DOMNode).appendChild(this.dom)
      else if (typeof place == "function") place(this.dom)
      else if ((place as { mount: HTMLElement }).mount) this.mounted = true
    }

    this.editable = getEditable(this)
    updateCursorWrapper(this)
    this.nodeViews = buildNodeViews(this)
    this.docView = docViewDesc(this.state.doc, computeDocDeco(this), viewDecorations(this), this.dom, this)

    this.domObserver = new DOMObserver(
      this,
      (from, to, typeOver, added) => readDOMChange(this, from, to, typeOver, added)
    )
    this.domObserver.start()
    initInput(this)
    this.updatePluginViews()
  }

  /**
   * Create a view inside a scope. `place` may be a DOM node that the
   * editor should be appended to, a function that will place it into the
   * document, or an object whose `mount` property holds the node to use
   * as the document container. If it is `null`, the editor will not be
   * added to the document.
   *
   * The view captures the current context (which must provide `R`) to
   * run the effects of its plugins and props, and is destroyed when the
   * scope closes.
   *
   * When props' handlers require services that the state's plugins
   * don't, pass the type arguments explicitly
   * (`EditorView.make<typeof schema, ServiceA | ServiceB>(...)`).
   */
  static make<Sc extends AnySchema, R = never, E = never>(
    place: ViewPlace,
    props: DirectEditorProps<Sc, R, E>
  ): Effect.Effect<EditorView<Sc, R, E>, never, Scope.Scope | R> {
    return Effect.acquireRelease(
      Effect.flatMap(Effect.context<R>(), (context) => Effect.sync(() => new EditorView(place, props, context))),
      (view) => Effect.sync(() => view.destroy())
    )
  }

  /**
   * Create a view without a scope. The caller is responsible for calling
   * `destroy`. When `R` is not `never`, a context providing it must be
   * passed; it is used to run the effects of plugins and props.
   */
  static makeUnsafe<Sc extends AnySchema, E = never>(
    place: ViewPlace,
    props: DirectEditorProps<Sc, never, E>
  ): EditorView<Sc, never, E>
  static makeUnsafe<Sc extends AnySchema, R, E = never>(
    place: ViewPlace,
    props: DirectEditorProps<Sc, R, E>,
    context: Context.Context<R>
  ): EditorView<Sc, R, E>
  static makeUnsafe(
    place: ViewPlace,
    props: DirectEditorProps<any, any, any>,
    context?: Context.Context<any>
  ): EditorView<any, any, any> {
    return new EditorView<any, any, any>(place, props, context ?? (Context.empty() as Context.Context<any>))
  }

  /**
   * An editable DOM node containing the document. (You probably should
   * not directly interfere with its content.)
   */
  readonly dom: HTMLElement

  /** Indicates whether the editor is currently editable. */
  editable: boolean

  /**
   * When editor content is being dragged, this object contains
   * information about the dragged slice and whether it is being copied
   * or moved. At any other time, it is null.
   */
  dragging: null | { readonly slice: Slice<Sc>; readonly move: boolean } = null

  /** Holds `true` when a composition is active. */
  get composing(): boolean {
    return this.input.composing
  }

  /** The view's current props. */
  get props(): DirectEditorProps<Sc, R, E> {
    if (this._props.state != this.state) {
      const prev = this._props
      this._props = {} as any
      for (const name in prev) (this._props as any)[name] = (prev as any)[name]
      ;(this._props as any).state = this.state
    }
    return this._props
  }

  /** Update the view's props. Will immediately cause an update to the DOM. */
  update(props: DirectEditorProps<Sc, R, E>): void {
    if (props.handleDOMEvents != this._props.handleDOMEvents) ensureListeners(this)
    const prevProps = this._props
    this._props = props
    if (props.plugins) {
      props.plugins.forEach(checkStateComponent)
      this.directPlugins = props.plugins
    }
    this.updateStateInner(props.state, prevProps)
  }

  /**
   * Update the view by updating existing props object with the object
   * given as argument. Equivalent to
   * `view.update(Object.assign({}, view.props, props))`.
   */
  setProps(props: Partial<DirectEditorProps<Sc, R, E>>): void {
    const updated = {} as DirectEditorProps<Sc, R, E>
    for (const name in this._props) (updated as any)[name] = (this._props as any)[name]
    ;(updated as any).state = this.state
    for (const name in props) (updated as any)[name] = (props as any)[name]
    this.update(updated)
  }

  /** Update the editor's `state` prop, without touching any of the other props. */
  updateState(state: EditorState<Sc, R, E>): void {
    this.updateStateInner(state, this._props)
  }

  private updateStateInner(state: EditorState<Sc, R, E>, prevProps: DirectEditorProps<Sc, R, E>) {
    const prev = this.state
    let redraw = false, updateSel = false
    // When stored marks are added, stop composition, so that they can
    // be displayed.
    if (state.storedMarksOrNull && this.composing) {
      clearComposition(this)
      updateSel = true
    }
    this.state = state
    const pluginsChanged = prev.plugins != state.plugins || this._props.plugins != prevProps.plugins
    if (pluginsChanged || this._props.plugins != prevProps.plugins || this._props.nodeViews != prevProps.nodeViews) {
      const nodeViews = buildNodeViews(this)
      if (changedNodeViews(nodeViews, this.nodeViews)) {
        this.nodeViews = nodeViews
        redraw = true
      }
    }
    if (pluginsChanged || prevProps.handleDOMEvents != this._props.handleDOMEvents) {
      ensureListeners(this)
    }

    this.editable = getEditable(this)
    updateCursorWrapper(this)
    const innerDeco = viewDecorations(this), outerDeco = computeDocDeco(this)

    const scroll = prev.plugins != state.plugins && !prev.doc.eq(state.doc)
      ? "reset"
      : state.scrollToSelection > prev.scrollToSelection
      ? "to selection"
      : "preserve"
    const updateDoc = redraw || !this.docView.matchesNode(state.doc, outerDeco, innerDeco)
    if (updateDoc || !state.selection.eq(prev.selection)) updateSel = true
    const oldScrollPos = scroll == "preserve" && updateSel && this.dom.style.overflowAnchor == null &&
      storeScrollPos(this)

    if (updateSel) {
      this.domObserver.stop()
      // Work around an issue in Chrome, IE, and Edge where changing
      // the DOM around an active selection puts it into a broken
      // state where the thing the user sees differs from the
      // selection reported by the Selection object (#710, #973,
      // #1011, #1013, #1035).
      let forceSelUpdate = updateDoc && (browser.ie || browser.chrome) && !this.composing &&
        !prev.selection.empty && !state.selection.empty && selectionContextChanged(prev.selection, state.selection)
      if (updateDoc) {
        // If the node that the selection points into is written to,
        // Chrome sometimes starts misreporting the selection, so this
        // tracks that and forces a selection reset when our update
        // did write to the node.
        const chromeKludge = browser.chrome ? (this.trackWrites = this.domSelectionRange().focusNode) : null
        if (this.composing) this.input.compositionNode = findCompositionNode(this)
        if (redraw || !this.docView.update(state.doc, outerDeco, innerDeco, this)) {
          this.docView.updateOuterDeco(outerDeco)
          this.docView.destroy()
          this.docView = docViewDesc(state.doc, outerDeco, innerDeco, this.dom, this)
        }
        if (chromeKludge && (!this.trackWrites || !this.dom.contains(this.trackWrites))) forceSelUpdate = true
      }
      // Work around for an issue where an update arriving right between
      // a DOM selection change and the "selectionchange" event for it
      // can cause a spurious DOM selection update, disrupting mouse
      // drag selection.
      if (
        forceSelUpdate ||
        !(this.input.mouseDown && this.domObserver.currentSelection.eq(this.domSelectionRange()) &&
          anchorInRightPlace(this))
      ) {
        selectionToDOM(this, forceSelUpdate)
      } else {
        syncNodeSelection(this, state.selection)
        this.domObserver.setCurSelection()
      }
      this.domObserver.start()
    }

    this.updatePluginViews(prev)
    if ((this.dragging as Dragging | null)?.node && !prev.doc.eq(state.doc)) {
      this.updateDraggedNode(this.dragging as Dragging, prev)
    }

    if (scroll == "reset") {
      this.dom.scrollTop = 0
    } else if (scroll == "to selection") {
      this.scrollToSelection()
    } else if (oldScrollPos) {
      resetScrollPos(oldScrollPos)
    }
  }

  /** @internal */
  scrollToSelection(): void {
    const startDOM = this.domSelectionRange().focusNode
    if (!startDOM || !this.dom.contains(startDOM.nodeType == 1 ? startDOM : startDOM.parentNode)) {
      // Ignore selections outside the editor
    } else if (this.someHandler("handleScrollToSelection", (f) => f(this as any))) {
      // Handled
    } else if (this.state.selection instanceof NodeSelection) {
      const target = this.docView.domAfterPos(this.state.selection.from)
      if (target.nodeType == 1) scrollRectIntoView(this, (target as HTMLElement).getBoundingClientRect(), startDOM)
    } else {
      scrollRectIntoView(this, this.coordsAtPos(this.state.selection.head, 1), startDOM)
    }
  }

  private destroyPluginViews() {
    let view
    while ((view = this.pluginViews.pop())) if (view.destroy) view.destroy()
  }

  private updatePluginViews(prevState?: EditorState<Sc, R, E>) {
    if (!prevState || prevState.plugins != this.state.plugins || this.directPlugins != this.prevDirectPlugins) {
      this.prevDirectPlugins = this.directPlugins
      this.destroyPluginViews()
      for (let i = 0; i < this.directPlugins.length; i++) {
        const plugin = this.directPlugins[i]!
        if (plugin.spec.view) this.pluginViews.push(plugin.spec.view(this as any))
      }
      for (let i = 0; i < this.state.plugins.length; i++) {
        const plugin = this.state.plugins[i]!
        if (plugin.spec.view) this.pluginViews.push(plugin.spec.view(this as any))
      }
    } else {
      for (let i = 0; i < this.pluginViews.length; i++) {
        const pluginView = this.pluginViews[i]!
        if (pluginView.update) pluginView.update(this as any, prevState)
      }
    }
  }

  private updateDraggedNode(dragging: Dragging, prev: EditorState<Sc, R, E>) {
    const sel = dragging.node!
    let found = -1
    if (sel.from < this.state.doc.content.size && this.state.doc.nodeAtOrNull(sel.from) == sel.node) {
      found = sel.from
    } else {
      const movedPos = sel.from + (this.state.doc.content.size - prev.doc.content.size)
      const moved = movedPos > 0 && movedPos < this.state.doc.content.size && this.state.doc.nodeAtOrNull(movedPos)
      if (moved == sel.node) found = movedPos
    }
    this.dragging = new Dragging(
      dragging.slice,
      dragging.move,
      found < 0 ? undefined : NodeSelection.createUnsafe(this.state.doc, found)
    )
  }

  /**
   * Goes over the values of a prop, first those provided directly, then
   * those from plugins given to the view, then from plugins in the state
   * (in order), and calls `f` every time a non-undefined value is found.
   * When `f` returns a truthy value, that is immediately returned. When
   * `f` isn't provided, it is treated as the identity function (the prop
   * value is returned directly).
   *
   * Note that event handler props may return Effects, which are returned
   * as-is (and are truthy).
   */
  someProp<PropName extends keyof EditorProps<Sc, R, E>, Result>(
    propName: PropName,
    f: (value: NonNullable<EditorProps<Sc, R, E>[PropName]>) => Result
  ): Result | undefined
  someProp<PropName extends keyof EditorProps<Sc, R, E>>(
    propName: PropName
  ): NonNullable<EditorProps<Sc, R, E>[PropName]> | undefined
  someProp<PropName extends keyof EditorProps<Sc, R, E>, Result>(
    propName: PropName,
    f?: (value: NonNullable<EditorProps<Sc, R, E>[PropName]>) => Result
  ): Result | undefined {
    const prop = this._props && this._props[propName]
    let value
    if (prop != null && (value = f ? f(prop as any) : prop)) return value as any
    for (let i = 0; i < this.directPlugins.length; i++) {
      const prop = (this.directPlugins[i]!.props as any)[propName]
      if (prop != null && (value = f ? f(prop as any) : prop)) return value as any
    }
    const plugins = this.state.plugins
    if (plugins) {
      for (let i = 0; i < plugins.length; i++) {
        const prop = (plugins[i]!.props as any)[propName]
        if (prop != null && (value = f ? f(prop as any) : prop)) return value as any
      }
    }
    return undefined
  }

  /**
   * Like `someProp`, but for event handler props, whose results may be
   * Effects: those are run (see `HandlerResult`) and their results used.
   *
   * @internal
   */
  someHandler<PropName extends keyof EditorProps<Sc, R, E>>(
    propName: PropName,
    f: (value: NonNullable<EditorProps<Sc, R, E>[PropName]>) => HandlerResult<any, any>
  ): boolean {
    return !!this.someProp(propName, (h) => this.runHandler(f(h)))
  }

  /**
   * Interpret the result of an event handler prop, running it with the
   * view's context when it is an Effect.
   *
   * @internal
   */
  runHandler(result: HandlerResult<any, any>): boolean {
    if (!Effect.isEffect(result)) return !!result
    const exit = this.runEffect(result as Effect.Effect<boolean, unknown, R>)
    if (exit === undefined) return true
    return Exit.isSuccess(exit) ? !!exit.value : false
  }

  /**
   * Run an effect with the view's captured context. Returns its exit
   * when it completed synchronously (reporting failures to `onError`),
   * or `undefined` when it is still running in the background (in which
   * case failures are reported when it completes).
   *
   * @internal
   */
  runEffect<A>(effect: Effect.Effect<A, unknown, R>): Exit.Exit<A, unknown> | undefined {
    const fiber = Effect.runForkWith(this.runContext)(effect)
    const exit = fiber.pollUnsafe()
    if (exit) {
      if (Exit.isFailure(exit)) this.reportError(exit.cause)
      return exit
    }
    fiber.addObserver((exit) => {
      if (Exit.isFailure(exit)) this.reportError(exit.cause)
    })
    return undefined
  }

  /** @internal */
  reportError(cause: Cause.Cause<unknown>): void {
    const onError = this._props.onError
    if (onError) onError(cause)
    else Effect.runForkWith(this.context)(Effect.logError(cause))
  }

  /** Query whether the view has focus. */
  hasFocus(): boolean {
    // Work around IE not handling focus correctly if resize handles are shown.
    // If the cursor is inside an element with resize handles, activeElement
    // will be that element instead of this.dom.
    if (browser.ie) {
      // If activeElement is within this.dom, and there are no other elements
      // setting `contenteditable` to false in between, treat it as focused.
      let node = this.root.activeElement
      if (node == this.dom) return true
      if (!node || !this.dom.contains(node)) return false
      while (node && this.dom != node && this.dom.contains(node)) {
        if ((node as HTMLElement).contentEditable == "false") return false
        node = node.parentElement
      }
      return true
    }
    return this.root.activeElement == this.dom
  }

  /** Focus the editor. */
  focus(): void {
    this.domObserver.stop()
    if (this.editable) focusPreventScroll(this.dom)
    selectionToDOM(this)
    this.domObserver.start()
  }

  /**
   * Get the document root in which the editor exists. This will usually
   * be the top-level `document`, but might be a shadow DOM root if the
   * editor is inside one.
   */
  get root(): Document | ShadowRoot {
    const cached = this._root
    if (cached == null) {
      for (let search = this.dom.parentNode; search; search = search.parentNode) {
        if (search.nodeType == 9 || (search.nodeType == 11 && (search as any).host)) {
          if (!(search as any).getSelection) {
            Object.getPrototypeOf(search).getSelection = () => (search as DOMNode).ownerDocument!.getSelection()
          }
          return this._root = search as Document | ShadowRoot
        }
      }
    }
    return cached || document
  }

  /**
   * When an existing editor view is moved to a new document or shadow
   * tree, call this to make it recompute its root.
   */
  updateRoot(): void {
    this._root = null
  }

  /**
   * Given a pair of viewport coordinates, return the document position
   * that corresponds to them. Returns `None` if the given coordinates
   * aren't inside of the editor.
   */
  posAtCoords(coords: { readonly left: number; readonly top: number }): Option.Option<PosAtCoords> {
    return Option.fromNullishOr(posAtCoords(this, coords))
  }

  /**
   * Returns the viewport rectangle at a given document position. `left`
   * and `right` will be the same number, as this returns a flat
   * cursor-ish rectangle. If the position is between two things that
   * aren't directly adjacent, `side` determines which element is used.
   * When < 0, the element before the position is used, otherwise the
   * element after.
   */
  coordsAtPos(pos: number, side = 1): Rect {
    return coordsAtPos(this, pos, side)
  }

  /**
   * Find the DOM position that corresponds to the given document
   * position. When `side` is negative, find the position as close as
   * possible to the content before the position. When positive, prefer
   * positions close to the content after the position. When zero,
   * prefer as shallow a position as possible.
   *
   * Note that you should **not** mutate the editor's internal DOM, only
   * inspect it (and even that is usually not necessary).
   */
  domAtPos(pos: number, side = 0): { node: DOMNode; offset: number } {
    return this.docView.domFromPos(pos, side)
  }

  /**
   * Find the DOM node that represents the document node after the given
   * position. Returns `None` when the position doesn't point in front of
   * a node or if the node is inside an opaque node view.
   *
   * This is intended to be able to call things like
   * `getBoundingClientRect` on that DOM node. Do **not** mutate the
   * editor DOM directly, or add styling this way, since that will be
   * immediately overriden by the editor as it redraws the node.
   */
  nodeDOM(pos: number): Option.Option<DOMNode> {
    const desc = this.docView.descAt(pos)
    return Option.fromNullishOr(desc ? (desc as NodeViewDesc).nodeDOM : null)
  }

  /**
   * Find the document position that corresponds to a given DOM position.
   * (Whenever possible, it is preferable to inspect the document
   * structure directly, rather than poking around in the DOM, but
   * sometimes—for example when interpreting an event target—you don't
   * have a choice.)
   *
   * The `bias` parameter can be used to influence which side of a DOM
   * node to use when the position is inside a leaf node. Fails with a
   * `ViewError` when the DOM position is not inside the editor.
   */
  posAtDOM(node: DOMNode, offset: number, bias = -1): Effect.Effect<number, ViewError> {
    return Effect.suspend(() => {
      const pos = this.docView.posFromDOM(node, offset, bias)
      return pos == null || pos < 0
        ? Effect.fail(new ViewError({ message: "DOM position not inside the editor" }))
        : Effect.succeed(pos)
    })
  }

  /** Like `posAtDOM`, but throws a `ViewError` when the position is not inside the editor. */
  posAtDOMUnsafe(node: DOMNode, offset: number, bias = -1): number {
    const pos = this.docView.posFromDOM(node, offset, bias)
    if (pos == null || pos < 0) throw new ViewError({ message: "DOM position not inside the editor" })
    return pos
  }

  /**
   * Find out whether the selection is at the end of a textblock when
   * moving in a given direction. When, for example, given `"left"`, it
   * will return true if moving left from the current cursor position
   * would leave that position's parent textblock. Will apply to the
   * view's current state by default, but it is possible to pass a
   * different state.
   */
  endOfTextblock(dir: TextblockDir, state?: EditorState<any, any, any>): boolean {
    return endOfTextblock(this, state || this.state, dir)
  }

  /**
   * Run the editor's paste logic with the given HTML string. The
   * `event`, if given, will be passed to the `handlePaste` hook.
   */
  pasteHTML(html: string, event?: ClipboardEvent): boolean {
    return doPaste(this, "", html, false, event || new ClipboardEvent("paste"))
  }

  /** Run the editor's paste logic with the given plain-text input. */
  pasteText(text: string, event?: ClipboardEvent): boolean {
    return doPaste(this, text, null, true, event || new ClipboardEvent("paste"))
  }

  /**
   * Serialize the given slice as it would be if it was copied from this
   * editor. Returns a DOM element that contains a representation of the
   * slice as its children, a textual representation, and the
   * transformed slice (which can be different from the given input due
   * to hooks like `transformCopied`).
   */
  serializeForClipboard(slice: Slice<Sc>): ClipboardSerialization<Sc> {
    return serializeForClipboard(this, slice)
  }

  /** Removes the editor from the DOM and destroys all node views. */
  destroy(): void {
    if (!this.docView) return
    destroyInput(this)
    this.destroyPluginViews()
    if (this.mounted) {
      this.docView.update(this.state.doc, [], viewDecorations(this), this)
      this.dom.textContent = ""
    } else if (this.dom.parentNode) {
      this.dom.parentNode.removeChild(this.dom)
    }
    this.docView.destroy()
    ;(this as any).docView = null
    clearReusedRange()
  }

  /**
   * This is true when the view has been destroyed (and thus should not
   * be used anymore).
   */
  get isDestroyed(): boolean {
    return this.docView == null
  }

  /** Used for testing. */
  dispatchEvent(event: Event): void {
    return dispatchEvent(this, event)
  }

  /**
   * Dispatch a transaction. Will call `dispatchTransaction` when given,
   * and otherwise defaults to applying the transaction to the current
   * state and calling `updateState` with the result.
   *
   * The returned effect runs with the view's captured context (so it
   * requires nothing), and failures (of plugin hooks or of a
   * `dispatchTransaction` effect) are reported to the `onError` prop
   * rather than to the error channel—use `tryDispatch` to observe them.
   * This is a bound function, usable as a command's `Dispatch`.
   */
  readonly dispatch: (tr: Transaction<Sc>) => Effect.Effect<void> = (tr) =>
    Effect.catchCause(this.tryDispatch(tr), (cause) => Effect.sync(() => this.reportError(cause)))

  /**
   * Like `dispatch`, but fails with the errors of the plugin hooks and
   * of `dispatchTransaction` instead of reporting them to `onError`.
   * Runs with the view's captured context.
   */
  tryDispatch(tr: Transaction<Sc>): Effect.Effect<void, E | StateFailure> {
    return Effect.provideContext(
      Effect.suspend((): Effect.Effect<void, E | StateFailure, R> => {
        const dispatchTransaction = this._props.dispatchTransaction
        if (dispatchTransaction) {
          const result = dispatchTransaction.call(this, tr)
          return Effect.isEffect(result) ? result : Effect.void
        }
        return Effect.map(this.state.apply(tr), (state) => this.updateState(state))
      }),
      this.context
    )
  }

  /**
   * Dispatch a transaction synchronously, throwing its failure (as
   * `tryDispatch` would fail). When the dispatch is asynchronous (a
   * plugin hook suspends), it keeps running in the background and
   * failures are reported to `onError`. Bound to the view instance.
   */
  readonly dispatchUnsafe: (tr: Transaction<Sc>) => void = (tr) => {
    const fiber = Effect.runForkWith(this.runContext)(this.tryDispatch(tr))
    const exit = fiber.pollUnsafe()
    if (exit) {
      if (Exit.isFailure(exit)) throw Cause.squash(exit.cause)
      return
    }
    fiber.addObserver((exit) => {
      if (Exit.isFailure(exit)) this.reportError(exit.cause)
    })
  }

  /**
   * Dispatch a transaction on behalf of a DOM event: like
   * `dispatchUnsafe`, but failures are reported to `onError` instead of
   * thrown.
   *
   * @internal
   */
  dispatchInternal(tr: Transaction<any>): void {
    this.runEffect(this.tryDispatch(tr))
  }

  /** @internal */
  domSelectionRange(): DOMSelectionRange {
    const sel = this.domSelection()
    if (!sel) return { focusNode: null, focusOffset: 0, anchorNode: null, anchorOffset: 0 }
    return browser.safari && this.root.nodeType === 11 &&
        deepActiveElement(this.dom.ownerDocument) == this.dom && safariShadowSelectionRange(this, sel) || sel
  }

  /** @internal */
  domSelection(): DOMSelection | null {
    return (this.root as Document).getSelection()
  }
}

function computeDocDeco(view: EditorView<any, any, any>) {
  const attrs: Record<string, string> = Object.create(null)
  attrs.class = "ProseMirror"
  attrs.contenteditable = String(view.editable)

  view.someProp("attributes", (prop) => {
    const value: { readonly [name: string]: string } | null | undefined = typeof prop == "function"
      ? prop(view.state as EditorState<any>)
      : prop
    if (value) {
      for (const attr in value) {
        if (attr == "class") {
          attrs.class += " " + value[attr]
        } else if (attr == "style") {
          attrs.style = (attrs.style ? attrs.style + ";" : "") + value[attr]
        } else if (!attrs[attr] && attr != "contenteditable" && attr != "nodeName") {
          attrs[attr] = String(value[attr])
        }
      }
    }
  })
  if (!attrs.translate) attrs.translate = "no"

  return [Decoration.node(0, view.state.doc.content.size, attrs)]
}

function updateCursorWrapper(view: EditorView<any, any, any>) {
  if (view.markCursor) {
    const dom = document.createElement("img")
    dom.className = "ProseMirror-separator"
    dom.setAttribute("mark-placeholder", "true")
    dom.setAttribute("alt", "")
    view.cursorWrapper = {
      dom,
      deco: Decoration.widget(view.state.selection.from, dom, { raw: true, marks: view.markCursor } as any)
    }
  } else {
    view.cursorWrapper = null
  }
}

function getEditable(view: EditorView<any, any, any>) {
  return !view.someProp("editable", (value) => value(view.state as EditorState<any>) === false)
}

function selectionContextChanged(sel1: Selection<any>, sel2: Selection<any>) {
  const depth = Math.min(sel1.$anchor.sharedDepth(sel1.head), sel2.$anchor.sharedDepth(sel2.head))
  return sel1.$anchor.start(depth) != sel2.$anchor.start(depth)
}

function buildNodeViews(view: EditorView<any, any, any>) {
  const result: NodeViewSet = Object.create(null)
  function add(obj: { readonly [name: string]: any }) {
    for (const prop in obj) {
      if (!Object.prototype.hasOwnProperty.call(result, prop)) {
        result[prop] = obj[prop]
      }
    }
  }
  view.someProp("nodeViews", add)
  view.someProp("markViews", add)
  return result
}

function changedNodeViews(a: NodeViewSet, b: NodeViewSet) {
  let nA = 0, nB = 0
  for (const prop in a) {
    if (a[prop] != b[prop]) return true
    nA++
  }
  for (const _ in b) nB++
  return nA != nB
}

function checkStateComponent(plugin: Plugin<any, any, any, any>) {
  if (plugin.spec.state || plugin.spec.filterTransaction || plugin.spec.appendTransaction) {
    throw new ViewError({ message: "Plugins passed directly to the view must not have a state component" })
  }
}
