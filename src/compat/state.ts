/**
 * A `prosemirror-state`-compatible facade over `effect-richtext/state`.
 *
 * `Selection` can be subclassed like ProseMirror's: a subclass of the
 * facade `Selection` is adapted into a core selection that calls back
 * into it. Plugins are written with ProseMirror's plugin spec (hooks
 * and props receive facades) and bridged to core plugins. Commands are
 * plain `(state, dispatch?, view?) => boolean` functions;
 * `fromCoreCommand` / `toCoreCommand` convert between them and core
 * commands.
 *
 * Ported API surface from prosemirror-state (MIT, Marijn Haverbeke and others).
 *
 * @since 0.1.0
 */
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import type * as M from "../model.ts"
import * as S from "../state.ts"
import {
  adopt,
  BASE,
  callBase,
  CORE,
  getBase,
  guard,
  isFacade,
  link,
  registerWrapper,
  runSync,
  unwrap,
  unwrapArray,
  wrap,
  wrapArray
} from "./internal/core.ts"
import { propsFromCore, propsToCore } from "./internal/props.ts"
import type { Mark, MarkType, Node, ResolvedPos, Schema } from "./model.ts"
import { Slice } from "./model.ts"
import { type Mappable, Transform } from "./transform.ts"
import type { EditorProps, EditorView } from "./view.ts"

const INTERNAL: unique symbol = Symbol("effect-richtext/compat/internal") as never

// -----------------------------------------------------------------------------
// Selection
// -----------------------------------------------------------------------------

/**
 * Represents a selected range in a document.
 *
 * @since 0.1.0
 * @category models
 */
export class SelectionRange {
  /** @internal */
  declare readonly [CORE]: S.SelectionRange

  /** Create a range. */
  constructor($from: ResolvedPos, $to: ResolvedPos) {
    link(this, new S.SelectionRange($from[CORE], $to[CORE]))
  }

  /** The lower bound of the range. */
  get $from(): ResolvedPos {
    return wrap(this[CORE].$from)
  }

  /** The upper bound of the range. */
  get $to(): ResolvedPos {
    return wrap(this[CORE].$to)
  }
}

registerWrapper(S.SelectionRange, (core) => adopt(SelectionRange.prototype, core))

/**
 * A lightweight, document-independent representation of a selection.
 *
 * @since 0.1.0
 * @category models
 */
export interface SelectionBookmark {
  map(mapping: Mappable): SelectionBookmark
  resolve(doc: Node): Selection
}

class BookmarkFacade implements SelectionBookmark {
  declare readonly [CORE]: S.SelectionBookmark
  map(mapping: Mappable): SelectionBookmark {
    return bookmarkFromCore(this[CORE].map(unwrap(mapping)))
  }
  resolve(doc: Node): Selection {
    return wrap(this[CORE].resolve(doc[CORE]))
  }
}

const bookmarkFacades = new WeakMap<object, SelectionBookmark>()
const bookmarkCores = new WeakMap<object, S.SelectionBookmark>()

const bookmarkFromCore = (core: S.SelectionBookmark): SelectionBookmark => {
  let found = bookmarkFacades.get(core)
  if (!found) {
    if ((core as any)[ADAPTED_BOOKMARK]) return (core as any)[ADAPTED_BOOKMARK]
    found = link(new BookmarkFacade(), core)
    bookmarkFacades.set(core, found)
  }
  return found
}

const ADAPTED_BOOKMARK: unique symbol = Symbol("effect-richtext/compat/bookmark") as never

const bookmarkToCore = (bookmark: SelectionBookmark): S.SelectionBookmark => {
  if (isFacade(bookmark)) return (bookmark as any)[CORE]
  let found = bookmarkCores.get(bookmark)
  if (!found) {
    found = {
      [ADAPTED_BOOKMARK]: bookmark,
      map: (mapping: Mappable) => bookmarkToCore(bookmark.map(wrap(mapping))),
      resolve: (doc: M.Node) => bookmark.resolve(wrap(doc))[CORE]
    } as S.SelectionBookmark
    bookmarkCores.set(bookmark, found)
  }
  return found
}

/**
 * Superclass for editor selections. Subclass it to define custom
 * selection types: subclasses are adapted into core selections.
 *
 * @since 0.1.0
 * @category models
 */
export abstract class Selection {
  /** @internal */
  declare readonly [CORE]: S.Selection

  /** Initialize a selection with the head and anchor and ranges. */
  constructor($anchor: ResolvedPos, $head: ResolvedPos, ranges?: ReadonlyArray<SelectionRange>) {
    if (($anchor as unknown) === INTERNAL) {
      const [CoreClass, args] = $head as unknown as [new(...args: Array<any>) => S.Selection, Array<unknown>]
      link(this, guard(() => coreSelection(this, new.target, CoreClass, args)))
    } else {
      const args = [$anchor[CORE], $head[CORE], ranges && unwrapArray(ranges)]
      link(this, coreSelection(this, new.target, S.Selection as any, args))
    }
  }

  /** The ranges covered by the selection. */
  get ranges(): ReadonlyArray<SelectionRange> {
    return wrapArray(this[CORE].ranges)
  }

  /** The resolved anchor of the selection. */
  get $anchor(): ResolvedPos {
    return wrap(this[CORE].$anchor)
  }

  /** The resolved head of the selection. */
  get $head(): ResolvedPos {
    return wrap(this[CORE].$head)
  }

  /** The selection's anchor, as an unresolved position. */
  get anchor(): number {
    return this[CORE].anchor
  }

  /** The selection's head. */
  get head(): number {
    return this[CORE].head
  }

  /** The lower bound of the selection's main range. */
  get from(): number {
    return this[CORE].from
  }

  /** The upper bound of the selection's main range. */
  get to(): number {
    return this[CORE].to
  }

  /** The resolved lower bound of the selection's main range. */
  get $from(): ResolvedPos {
    return wrap(this[CORE].$from)
  }

  /** The resolved upper bound of the selection's main range. */
  get $to(): ResolvedPos {
    return wrap(this[CORE].$to)
  }

  /** Indicates whether the selection contains any content. */
  get empty(): boolean {
    return this[CORE].empty
  }

  /** Controls whether, when a selection of this type is active in the browser, the selected range should be visible to the user. */
  get visible(): boolean {
    return getBase(this[CORE], "visible")
  }

  /** Test whether the selection is the same as another selection. */
  abstract eq(selection: Selection): boolean

  /** Map this selection through a mappable thing. */
  abstract map(doc: Node, mapping: Mappable): Selection

  /** Get the content of this selection as a slice. */
  content(): Slice {
    return wrap(guard(() => callBase(this[CORE], "content")))
  }

  /** Replace the selection with a slice or, if no slice is given, delete the selection. */
  replace(tr: Transaction, content: Slice = Slice.empty): void {
    guard(() => callBase(this[CORE], "replace", [tr[CORE], content[CORE]]))
  }

  /** Replace the selection with the given node, appending the changes to the given transaction. */
  replaceWith(tr: Transaction, node: Node): void {
    guard(() => callBase(this[CORE], "replaceWith", [tr[CORE], node[CORE]]))
  }

  /** Convert the selection to a JSON representation. */
  abstract toJSON(): any

  /** Find a valid cursor or leaf node selection starting at the given position and searching back if `dir` is negative, and forward if positive. */
  static findFrom($pos: ResolvedPos, dir: number, textOnly = false): Selection | null {
    return wrap(guard(() => S.Selection.findFromOrNull($pos[CORE], dir, textOnly)))
  }

  /** Find a valid cursor or leaf node selection near the given position. */
  static near($pos: ResolvedPos, bias = 1): Selection {
    return wrap(guard(() => S.Selection.near($pos[CORE], bias)))
  }

  /** Find the cursor or leaf node selection closest to the start of the given document. */
  static atStart(doc: Node): Selection {
    return wrap(guard(() => S.Selection.atStart(doc[CORE])))
  }

  /** Find the cursor or leaf node selection closest to the end of the given document. */
  static atEnd(doc: Node): Selection {
    return wrap(guard(() => S.Selection.atEnd(doc[CORE])))
  }

  /** Deserialize the JSON representation of a selection. */
  static fromJSON(doc: Node, json: any): Selection {
    return wrap(guard(() => S.Selection.fromJSONUnsafe(doc[CORE], json)))
  }

  /** To be able to deserialize selections from JSON, custom selection classes must register themselves with an ID string. */
  static jsonID(id: string, selectionClass: { fromJSON(doc: Node, json: any): Selection }): any {
    try {
      S.Selection.jsonID(id, {
        fromJSONUnsafe: (doc, json) => selectionClass.fromJSON(wrap(doc), json)[CORE]
      })
    } catch (e) {
      throw new RangeError((e as Error).message)
    }
    ;(selectionClass as any).prototype.jsonID = id
    return selectionClass
  }

  /** Get a bookmark for this selection. */
  getBookmark(): SelectionBookmark {
    return bookmarkFromCore(callBase(this[CORE], "getBookmark"))
  }
}

const getterOf = (proto: object | null, prop: string) => {
  for (; proto; proto = Object.getPrototypeOf(proto)) {
    const desc = Object.getOwnPropertyDescriptor(proto, prop)
    if (desc) return desc.get
  }
  return undefined
}

const adaptedSelectionClasses = new Map<object, any>()

/**
 * The core class used for instances of user subclasses of a facade
 * selection class: a subclass of the corresponding core class whose
 * methods call the facade's overrides, when it has them. @internal
 */
const adaptedSelectionClass = (CoreClass: any, FacadeClass: any): any => {
  let found = adaptedSelectionClasses.get(CoreClass)
  if (!found) {
    const base = FacadeClass.prototype, baseVisible = getterOf(base, "visible")
    found = class extends CoreClass {
      declare facade: Selection
      get visible(): boolean {
        const get = getterOf(Object.getPrototypeOf(this.facade), "visible")
        return get && get !== baseVisible ? get.call(this.facade) : super.visible
      }
      eq(other: S.Selection): boolean {
        return this.facade.eq === base.eq ? super.eq(other) : this.facade.eq(wrap(other))
      }
      map(doc: M.Node, mapping: Mappable): S.Selection {
        return this.facade.map === base.map
          ? super.map(doc, mapping)
          : this.facade.map(wrap(doc), wrap(mapping))[CORE]
      }
      content(): M.Slice {
        return this.facade.content === base.content ? super.content() : this.facade.content()[CORE]
      }
      replace(tr: S.Transaction, content?: M.Slice): void {
        if (this.facade.replace === base.replace) super.replace(tr, content)
        else this.facade.replace(wrap(tr), content === undefined ? Slice.empty : wrap(content))
      }
      replaceWith(tr: S.Transaction, node: M.Node): void {
        if (this.facade.replaceWith === base.replaceWith) super.replaceWith(tr, node)
        else this.facade.replaceWith(wrap(tr), wrap(node))
      }
      toJSON(): S.SelectionJSON {
        return this.facade.toJSON === base.toJSON ? super.toJSON() : this.facade.toJSON()
      }
      getBookmark(): S.SelectionBookmark {
        return this.facade.getBookmark === base.getBookmark
          ? super.getBookmark()
          : bookmarkToCore(this.facade.getBookmark())
      }
    }
    found.prototype[BASE] = CoreClass.prototype
    adaptedSelectionClasses.set(CoreClass, found)
  }
  return found
}

const coreSelection = (
  facade: Selection,
  target: unknown,
  CoreClass: new(...args: Array<any>) => S.Selection,
  args: Array<unknown>
): S.Selection => {
  const FacadeClass = CoreClass === S.TextSelection
    ? TextSelection
    : CoreClass === S.NodeSelection
    ? NodeSelection
    : CoreClass === S.AllSelection
    ? AllSelection
    : Selection
  if (target === FacadeClass) return new CoreClass(...args)
  const core = new (adaptedSelectionClass(CoreClass, FacadeClass))(...args)
  core.facade = facade
  return core
}

/**
 * A text selection represents a classical editor selection, with a
 * head (the moving side) and anchor (immobile side), both of which
 * point into textblock nodes.
 *
 * @since 0.1.0
 * @category models
 */
export class TextSelection extends Selection {
  /** @internal */
  declare readonly [CORE]: S.TextSelection

  /** Construct a text selection between the given points. */
  constructor($anchor: ResolvedPos, $head: ResolvedPos = $anchor) {
    super(INTERNAL as any, [S.TextSelection, [$anchor[CORE], $head[CORE]]] as any)
  }

  /** Returns a resolved position if this is a cursor selection (an empty text selection), and null otherwise. */
  get $cursor(): ResolvedPos | null {
    return wrap(this[CORE].$cursorOrNull)
  }

  map(doc: Node, mapping: Mappable): Selection {
    return wrap(guard(() => callBase(this[CORE], "map", [doc[CORE], unwrap(mapping)])))
  }

  eq(other: Selection): boolean {
    return callBase(this[CORE], "eq", [other[CORE]])
  }

  toJSON(): any {
    return callBase(this[CORE], "toJSON")
  }

  /** @internal */
  static override fromJSON(doc: Node, json: any): TextSelection {
    return wrap(guard(() => S.TextSelection.fromJSONUnsafe(doc[CORE], json)))
  }

  /** Create a text selection from non-resolved positions. */
  static create(doc: Node, anchor: number, head = anchor): TextSelection {
    return wrap(guard(() => S.TextSelection.createUnsafe(doc[CORE], anchor, head)))
  }

  /** Return a text selection that spans the given positions or, if they aren't text positions, find a text selection near them. */
  static between($anchor: ResolvedPos, $head: ResolvedPos, bias?: number): Selection {
    return wrap(guard(() => S.TextSelection.between($anchor[CORE], $head[CORE], bias)))
  }
}

/**
 * A node selection is a selection that points at a single node.
 *
 * @since 0.1.0
 * @category models
 */
export class NodeSelection extends Selection {
  /** @internal */
  declare readonly [CORE]: S.NodeSelection

  /** Create a node selection. Does not verify the validity of its argument. */
  constructor($pos: ResolvedPos) {
    super(INTERNAL as any, [S.NodeSelection, [$pos[CORE]]] as any)
  }

  /** The selected node. */
  get node(): Node {
    return wrap(this[CORE].node)
  }

  map(doc: Node, mapping: Mappable): Selection {
    return wrap(guard(() => callBase(this[CORE], "map", [doc[CORE], unwrap(mapping)])))
  }

  eq(other: Selection): boolean {
    return callBase(this[CORE], "eq", [other[CORE]])
  }

  toJSON(): any {
    return callBase(this[CORE], "toJSON")
  }

  /** @internal */
  static override fromJSON(doc: Node, json: any): NodeSelection {
    return wrap(guard(() => S.NodeSelection.fromJSONUnsafe(doc[CORE], json)))
  }

  /** Create a node selection from non-resolved positions. */
  static create(doc: Node, from: number): NodeSelection {
    return wrap(guard(() => S.NodeSelection.createUnsafe(doc[CORE], from)))
  }

  /** Determines whether the given node may be selected as a node selection. */
  static isSelectable(node: Node): boolean {
    return S.NodeSelection.isSelectable(node[CORE])
  }
}

/**
 * A selection type that represents selecting the whole document.
 *
 * @since 0.1.0
 * @category models
 */
export class AllSelection extends Selection {
  /** @internal */
  declare readonly [CORE]: S.AllSelection

  /** Create an all-selection over the given document. */
  constructor(doc: Node) {
    super(INTERNAL as any, [S.AllSelection, [doc[CORE]]] as any)
  }

  map(doc: Node): Selection {
    return wrap(callBase(this[CORE], "map", [doc[CORE]]))
  }

  eq(other: Selection): boolean {
    return callBase(this[CORE], "eq", [other[CORE]])
  }

  toJSON(): any {
    return callBase(this[CORE], "toJSON")
  }
}

registerWrapper(S.TextSelection, (core) => adopt(TextSelection.prototype, core))
registerWrapper(S.NodeSelection, (core) => adopt(NodeSelection.prototype, core))
registerWrapper(S.AllSelection, (core) => adopt(AllSelection.prototype, core))

// -----------------------------------------------------------------------------
// Transaction
// -----------------------------------------------------------------------------

/**
 * Commands are functions that take a state and a an optional
 * transaction dispatch function and determine whether they are
 * applicable for the given state.
 *
 * @since 0.1.0
 * @category models
 */
export type Command = (state: EditorState, dispatch?: (tr: Transaction) => void, view?: EditorView) => boolean

const metaKey = (key: string | Plugin | PluginKey): string => typeof key === "string" ? key : key.key

/**
 * An editor state transaction, which can be applied to a state to
 * create an updated state.
 *
 * @since 0.1.0
 * @category models
 */
export class Transaction extends Transform {
  /** @internal */
  declare readonly [CORE]: S.Transaction

  /** @internal */
  private constructor(state: EditorState) {
    super(state.doc)
    link(this, new S.Transaction(state[CORE]))
  }

  /** The timestamp associated with this transaction. */
  get time(): number {
    return this[CORE].time
  }

  set time(value: number) {
    this[CORE].time = value
  }

  /** The stored marks set by this transaction, if any. */
  get storedMarks(): ReadonlyArray<Mark> | null {
    const marks = this[CORE].storedMarksOrNull
    return marks && wrapArray(marks)
  }

  /** The transaction's current selection. */
  get selection(): Selection {
    return wrap(this[CORE].selection)
  }

  /** Update the transaction's current selection. */
  setSelection(selection: Selection): this {
    guard(() => this[CORE].setSelectionUnsafe(selection[CORE]))
    return this
  }

  /** Whether the selection was explicitly updated by this transaction. */
  get selectionSet(): boolean {
    return this[CORE].selectionSet
  }

  /** Set the current stored marks. */
  setStoredMarks(marks: ReadonlyArray<Mark> | null): this {
    this[CORE].setStoredMarks(marks && unwrapArray(marks))
    return this
  }

  /** Make sure the current stored marks or, if that is null, the marks at the selection, match the given set of marks. */
  ensureMarks(marks: ReadonlyArray<Mark>): this {
    this[CORE].ensureMarks(unwrapArray(marks))
    return this
  }

  /** Add a mark to the set of stored marks. */
  addStoredMark(mark: Mark): this {
    this[CORE].addStoredMark(mark[CORE])
    return this
  }

  /** Remove a mark or mark type from the set of stored marks. */
  removeStoredMark(mark: Mark | MarkType): this {
    this[CORE].removeStoredMark(mark[CORE])
    return this
  }

  /** Whether the stored marks were explicitly set for this transaction. */
  get storedMarksSet(): boolean {
    return this[CORE].storedMarksSet
  }

  /** Update the timestamp for the transaction. */
  setTime(time: number): this {
    this[CORE].setTime(time)
    return this
  }

  /** Replace the current selection with the given slice. */
  replaceSelection(slice: Slice): this {
    guard(() => this[CORE].replaceSelection(slice[CORE]))
    return this
  }

  /** Replace the selection with the given node. */
  replaceSelectionWith(node: Node, inheritMarks = true): this {
    guard(() => this[CORE].replaceSelectionWith(node[CORE], inheritMarks))
    return this
  }

  /** Delete the selection. */
  deleteSelection(): this {
    guard(() => this[CORE].deleteSelection())
    return this
  }

  /** Replace the given range, or the selection if no range is given, with a text node containing the given string. */
  insertText(text: string, from?: number, to?: number): this {
    guard(() => this[CORE].insertTextUnsafe(text, from, to))
    return this
  }

  /** Store a metadata property in this transaction, keyed either by name or by plugin. */
  setMeta(key: string | Plugin | PluginKey, value: any): this {
    this[CORE].setMeta(metaKey(key), value)
    return this
  }

  /** Retrieve a metadata property for a given name or plugin. */
  getMeta(key: string | Plugin | PluginKey): any {
    return wrap(Option.getOrUndefined(this[CORE].getMeta(metaKey(key))))
  }

  /** Returns true if this transaction doesn't contain any metadata, and can thus safely be extended. */
  get isGeneric(): boolean {
    return this[CORE].isGeneric
  }

  /** Indicate that the editor should scroll the selection into view when updated to the state produced by this transaction. */
  scrollIntoView(): this {
    this[CORE].scrollIntoView()
    return this
  }

  /** True when this transaction has had `scrollIntoView` called on it. */
  get scrolledIntoView(): boolean {
    return this[CORE].scrolledIntoView
  }
}

registerWrapper(S.Transaction, (core) => adopt(Transaction.prototype, core))

// -----------------------------------------------------------------------------
// Plugins
// -----------------------------------------------------------------------------

/**
 * A plugin's state field.
 *
 * @since 0.1.0
 * @category models
 */
export interface StateField<T> {
  init: (config: EditorStateConfig, instance: EditorState) => T
  apply: (tr: Transaction, value: T, oldState: EditorState, newState: EditorState) => T
  toJSON?: ((value: T) => any) | undefined
  fromJSON?: ((config: EditorStateConfig, value: any, state: EditorState) => T) | undefined
}

/**
 * A stateful object that can be installed in an editor by a plugin.
 *
 * @since 0.1.0
 * @category models
 */
export type PluginView = {
  update?: (view: EditorView, prevState: EditorState) => void
  destroy?: () => void
}

/**
 * This is the type passed to the `Plugin` constructor.
 *
 * @since 0.1.0
 * @category models
 */
export interface PluginSpec<PluginState> {
  props?: EditorProps<Plugin<PluginState>> | undefined
  state?: StateField<PluginState> | undefined
  key?: PluginKey | undefined
  view?: ((view: EditorView) => PluginView) | undefined
  filterTransaction?: ((tr: Transaction, state: EditorState) => boolean) | undefined
  appendTransaction?: (
    transactions: ReadonlyArray<Transaction>,
    oldState: EditorState,
    newState: EditorState
  ) => Transaction | null | undefined | void
  [key: string]: any
}

function bindProps(obj: { [prop: string]: any }, self: any, target: { [prop: string]: any }) {
  for (const prop in obj) {
    let val = obj[prop]
    if (val instanceof Function) val = val.bind(self)
    else if (prop === "handleDOMEvents") val = bindProps(val, self, {})
    target[prop] = val
  }
  return target
}

const configs = new WeakMap<object, EditorStateConfig>()

const facadeConfig = (config: any): any => configs.get(config) ?? config

const pluginViewToCore = (pluginView: PluginView): S.PluginView<any> => ({
  get update() {
    return pluginView.update && ((view: any, prevState: any) => pluginView.update!(wrap(view), wrap(prevState)))
  },
  get destroy() {
    return pluginView.destroy && (() => pluginView.destroy!())
  }
} as S.PluginView<any>)

const pluginSpecToCore = (spec: PluginSpec<any>, self: Plugin): S.PluginSpec<any> => {
  const result: Record<string, any> = { ...spec }
  result.key = spec.key && spec.key[CORE]
  const state = spec.state
  if (state) {
    result.state = {
      init: (config: any, instance: any) => state.init.call(self, facadeConfig(config), wrap(instance)),
      apply: (tr: any, value: any, oldState: any, newState: any) =>
        state.apply.call(self, wrap(tr), value, wrap(oldState), wrap(newState)),
      toJSON: state.toJSON && ((value: any) => state.toJSON!.call(self, value)),
      fromJSON: state.fromJSON &&
        ((config: any, value: any, instance: any) =>
          state.fromJSON!.call(self, facadeConfig(config), value, wrap(instance)))
    }
  }
  const filter = spec.filterTransaction
  if (filter) result.filterTransaction = (tr: any, s: any) => filter.call(self, wrap(tr), wrap(s))
  const append = spec.appendTransaction
  if (append) {
    result.appendTransaction = (trs: ReadonlyArray<any>, oldState: any, newState: any) =>
      unwrap(append.call(self, trs.map(wrap), wrap(oldState), wrap(newState)))
  }
  const view = spec.view
  if (view) result.view = (v: any) => pluginViewToCore(view.call(self, wrap(v)))
  result.props = spec.props ? propsToCore(spec.props, self) : undefined
  return result as S.PluginSpec<any>
}

/**
 * Plugins bundle functionality that can be added to an editor.
 *
 * @since 0.1.0
 * @category models
 */
export class Plugin<PluginState = any> {
  /** @internal */
  declare readonly [CORE]: S.Plugin<any, any, any, any>

  /** The props exported by this plugin. */
  declare readonly props: EditorProps<Plugin<PluginState>>

  /** The plugin's spec object. */
  declare readonly spec: PluginSpec<PluginState>

  /** Create a plugin. */
  constructor(spec: PluginSpec<PluginState>) {
    ;(this as any).spec = spec
    ;(this as any).props = {}
    if (spec.props) bindProps(spec.props, this, this.props)
    link(this, guard(() => new S.Plugin(pluginSpecToCore(spec, this))))
  }

  /** @internal */
  get key(): string {
    return this[CORE].key
  }

  /** Extract the plugin's state field from an editor state. */
  getState(state: EditorState): PluginState | undefined {
    return state[CORE].slots[this.key]
  }
}

registerWrapper(S.Plugin, (core: S.Plugin<any, any, any, any>) => {
  const plugin = adopt<Plugin>(Plugin.prototype, core)
  ;(plugin as any).spec = core.spec
  ;(plugin as any).props = propsFromCore(core.props as any, core)
  return plugin
})

/**
 * A key is used to tag plugins in a way that makes it possible to find
 * them, given an editor state.
 *
 * @since 0.1.0
 * @category models
 */
export class PluginKey<PluginState = any> {
  /** @internal */
  declare readonly [CORE]: S.PluginKey<PluginState>

  /** Create a plugin key. */
  constructor(name = "key") {
    link(this, new S.PluginKey(name))
  }

  /** @internal */
  get key(): string {
    return this[CORE].key
  }

  /** Get the active plugin with this key, if any, from an editor state. */
  get(state: EditorState): Plugin<PluginState> | undefined {
    return wrap(state[CORE].config.pluginsByKey[this.key])
  }

  /** Get the plugin's state from an editor state. */
  getState(state: EditorState): PluginState | undefined {
    return state[CORE].slots[this.key]
  }
}

registerWrapper(S.PluginKey, (core) => adopt(PluginKey.prototype, core))

// -----------------------------------------------------------------------------
// EditorState
// -----------------------------------------------------------------------------

/**
 * The type of object passed to `EditorState.create`.
 *
 * @since 0.1.0
 * @category models
 */
export interface EditorStateConfig {
  schema?: Schema | undefined
  doc?: Node | undefined
  selection?: Selection | undefined
  storedMarks?: ReadonlyArray<Mark> | null | undefined
  plugins?: ReadonlyArray<Plugin> | undefined
}

const configToCore = (config: EditorStateConfig): any => {
  const result: Record<string, any> = { ...config }
  if (config.schema) result.schema = config.schema[CORE]
  if (config.doc) result.doc = config.doc[CORE]
  if (config.selection) result.selection = config.selection[CORE]
  if (config.storedMarks) result.storedMarks = unwrapArray(config.storedMarks)
  if (config.plugins) result.plugins = config.plugins.map(unwrap)
  configs.set(result, config)
  return result
}

/**
 * The state of a ProseMirror editor.
 *
 * @since 0.1.0
 * @category models
 */
export class EditorState {
  /** @internal */
  declare readonly [CORE]: S.EditorState<any, any, any>

  /** @internal */
  private constructor() {}

  /** The current document. */
  get doc(): Node {
    return wrap(this[CORE].doc)
  }

  /** The selection. */
  get selection(): Selection {
    return wrap(this[CORE].selection)
  }

  /** A set of marks to apply to the next input. Will be null when no explicit marks have been set. */
  get storedMarks(): ReadonlyArray<Mark> | null {
    const marks = this[CORE].storedMarksOrNull
    return marks && wrapArray(marks)
  }

  /** @internal */
  get scrollToSelection(): number {
    return this[CORE].scrollToSelection
  }

  /** The schema of the state's document. */
  get schema(): Schema {
    return wrap(this[CORE].schema)
  }

  /** The plugins that are active in this state. */
  get plugins(): ReadonlyArray<Plugin> {
    return wrapArray(this[CORE].plugins)
  }

  /** Apply the given transaction to produce a new state. */
  apply(tr: Transaction): EditorState {
    return this.applyTransaction(tr).state
  }

  /** @internal */
  filterTransaction(tr: Transaction, ignore = -1): boolean {
    return runSync(this[CORE].filterTransaction(tr[CORE], ignore) as Effect.Effect<boolean, unknown>)
  }

  /** Verbose variant of `apply` that returns the precise transactions that were applied and the new state. */
  applyTransaction(rootTr: Transaction): { state: EditorState; transactions: ReadonlyArray<Transaction> } {
    const result = runSync(this[CORE].applyTransaction(rootTr[CORE]) as Effect.Effect<S.ApplyResult<any, any, any>>)
    return { state: wrap(result.state), transactions: result.transactions.map(wrap) }
  }

  /** Start a transaction from this state. */
  get tr(): Transaction {
    return wrap(this[CORE].tr)
  }

  /** Create a new state based on this one, but with an adjusted set of active plugins. */
  reconfigure(config: { plugins?: ReadonlyArray<Plugin> }): EditorState {
    return wrap(runSync(this[CORE].reconfigure(configToCore(config)) as Effect.Effect<any>))
  }

  /** Serialize this state to JSON. */
  toJSON(pluginFields?: { [propName: string]: Plugin }): any {
    let fields: Record<string, any> | undefined
    if (pluginFields && typeof pluginFields == "object") {
      fields = {}
      for (const prop in pluginFields) fields[prop] = unwrap(pluginFields[prop])
    }
    return guard(() => this[CORE].toJSON(fields))
  }

  /** Create a new state. */
  static create(config: EditorStateConfig): EditorState {
    return wrap(runSync(S.EditorState.create(configToCore(config)) as Effect.Effect<any>))
  }

  /** Deserialize a JSON representation of a state. */
  static fromJSON(
    config: { schema: Schema; plugins?: ReadonlyArray<Plugin> },
    json: any,
    pluginFields?: { [propName: string]: Plugin }
  ): EditorState {
    const fields: Record<string, any> | undefined = pluginFields && {}
    if (pluginFields) { for (const prop in pluginFields) fields![prop] = unwrap(pluginFields[prop]) }
    return wrap(runSync(S.EditorState.fromJSON(configToCore(config), json, fields) as Effect.Effect<any>))
  }
}

registerWrapper(S.EditorState, (core) => adopt(EditorState.prototype, core))

// -----------------------------------------------------------------------------
// Commands
// -----------------------------------------------------------------------------

const pmCommands = new WeakMap<object, Command>()
const coreCommands = new WeakMap<object, S.Command<any, any, any>>()

/**
 * Convert a core (Effect) command into a ProseMirror-style command. The
 * command is run synchronously; failures are thrown.
 *
 * @since 0.1.0
 * @category conversions
 */
export const fromCoreCommand = (command: S.Command<any, any, never>): Command => {
  let found = pmCommands.get(command)
  if (!found) {
    found = (state, dispatch, view) =>
      runSync(
        command(
          state[CORE],
          dispatch && ((tr) => Effect.sync(() => dispatch(wrap(tr)))),
          view && unwrap(view)
        ) as Effect.Effect<boolean, unknown>
      )
    pmCommands.set(command, found)
    coreCommands.set(found, command)
  }
  return found
}

/**
 * Convert a ProseMirror-style command into a core (Effect) command.
 *
 * @since 0.1.0
 * @category conversions
 */
export const toCoreCommand = (command: Command): S.Command<any> => {
  let found = coreCommands.get(command)
  if (!found) {
    found = (state, dispatch, view) =>
      Effect.sync(() =>
        command(
          wrap(state),
          dispatch && ((tr) => runSync(dispatch(tr[CORE]))),
          view && wrap(view)
        )
      )
    coreCommands.set(command, found)
    pmCommands.set(found, command)
  }
  return found as S.Command<any>
}

// -----------------------------------------------------------------------------
// toCore / fromCore
// -----------------------------------------------------------------------------

/**
 * Get the core (Effect API) object behind a facade. For a user-defined
 * `Selection` subclass, this is a core selection that delegates to it.
 *
 * @since 0.1.0
 * @category conversions
 */
export function toCore(state: EditorState): S.EditorState<any, never, any>
export function toCore(tr: Transaction): S.Transaction
export function toCore(selection: TextSelection): S.TextSelection
export function toCore(selection: NodeSelection): S.NodeSelection
export function toCore(selection: AllSelection): S.AllSelection
export function toCore(selection: Selection): S.Selection
export function toCore(range: SelectionRange): S.SelectionRange
export function toCore(plugin: Plugin): S.Plugin<any, any, never, never>
export function toCore(key: PluginKey): S.PluginKey
export function toCore(bookmark: SelectionBookmark): S.SelectionBookmark
export function toCore(command: Command): S.Command<any>
export function toCore(value: unknown): unknown {
  if (typeof value === "function") return toCoreCommand(value as Command)
  if (value instanceof BookmarkFacade || (value && !isFacade(value) && typeof (value as any).resolve === "function")) {
    return bookmarkToCore(value as SelectionBookmark)
  }
  return unwrap(value)
}

/**
 * Get the facade for a core (Effect API) object.
 *
 * @since 0.1.0
 * @category conversions
 */
export function fromCore(state: S.EditorState<any, any, any>): EditorState
export function fromCore(tr: S.Transaction<any>): Transaction
export function fromCore(selection: S.TextSelection<any>): TextSelection
export function fromCore(selection: S.NodeSelection<any>): NodeSelection
export function fromCore(selection: S.AllSelection<any>): AllSelection
export function fromCore(selection: S.Selection<any>): Selection
export function fromCore(range: S.SelectionRange<any>): SelectionRange
export function fromCore(plugin: S.Plugin<any, any, any, any>): Plugin
export function fromCore(key: S.PluginKey<any>): PluginKey
export function fromCore(command: S.Command<any, any, never>): Command
export function fromCore(value: unknown): unknown {
  if (typeof value === "function") return fromCoreCommand(value as S.Command<any, any, never>)
  return wrap(value)
}
