/**
 * The `Editor`: an editor state, an optional view, and typed commands
 * and builders, created from an extension.
 *
 * @since 0.1.0
 */
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import type * as Scope from "effect/Scope"
import { fromHTMLUnsafe } from "../html.ts"
import { attempt } from "../internal/attempt.ts"
import {
  type Attrs,
  type AttrsOptional,
  type ChildNames,
  DocSchema,
  Fragment,
  isModelError,
  Mark,
  type MarkAttrsInput,
  type MarkNames,
  type MarkSpecOf,
  type ModelError,
  Node,
  type NodeAttrsInput,
  type NodeJSON,
  type NodeNames,
  type NodeSpecOf,
  type SchemaDefinitionError,
  type TextNode
} from "../model.ts"
import {
  type AnyPlugin,
  type Command,
  type Dispatch,
  EditorState,
  type EditorStateConfig,
  isStateFailure,
  type Selection,
  StateError,
  type StateFailure,
  type Transaction
} from "../state.ts"
import { runSyncUnsafe } from "../state/state.ts"
import { type DirectEditorProps, EditorView, type ViewPlace } from "../view.ts"
import {
  type CommandCreator,
  type CommandSignature,
  type CommandType,
  type Extension,
  type ExtensionTypes,
  flatten,
  resolvePlugins
} from "./extension.ts"

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/**
 * The schema of an editor built from an extension with types `T`.
 *
 * @since 0.1.0
 * @category type-level
 */
export type SchemaOf<T extends ExtensionTypes> = DocSchema<T["nodes"], T["marks"]>

/**
 * The function type of a command, given its command type, the schema
 * and what calling it returns.
 *
 * @since 0.1.0
 * @category type-level
 */
export type CommandFn<C extends CommandType, Sc, Ret> = C extends CommandSignature
  ? (C & { readonly Schema: Sc; readonly Return: Ret })["signature"]
  : C extends ReadonlyArray<any>
    ? (...args: C) => Ret
    : never

/**
 * `editor.commands`: runs a command against the editor's current state
 * (and view, when mounted), dispatching its transaction.
 *
 * @since 0.1.0
 * @category type-level
 */
export type EditorCommands<T extends ExtensionTypes> = {
  readonly [K in keyof T["commands"]]: CommandFn<T["commands"][K], SchemaOf<T>, Effect.Effect<boolean, T["E"], T["R"]>>
}

/**
 * `editor.can()`: checks whether a command applies, without dispatching.
 *
 * @since 0.1.0
 * @category type-level
 */
export type CanCommands<T extends ExtensionTypes> = EditorCommands<T>

/**
 * `editor.chain()`: queues commands, which are all applied to a single
 * transaction by `run()`.
 *
 * @since 0.1.0
 * @category type-level
 */
export type ChainedCommands<T extends ExtensionTypes> = {
  readonly [K in keyof T["commands"]]: CommandFn<T["commands"][K], SchemaOf<T>, ChainedCommands<T>>
} & ChainRun<T>

/**
 * @since 0.1.0
 * @category type-level
 */
export interface ChainRun<T extends ExtensionTypes> {
  /**
   * Run the queued commands into one transaction and dispatch it.
   * Succeeds with `true` when every command applied.
   */
  readonly run: () => Effect.Effect<boolean, T["E"], T["R"]>
}

/**
 * A child accepted by a node builder: a node allowed by the node's
 * content expression, or a string (for text) when text is allowed.
 *
 * @since 0.1.0
 * @category type-level
 */
export type NodeChild<Sc, N extends string> =
  | Node<Sc & DocSchema<any, any>, ChildNames<Sc, N> & NodeNames<Sc>>
  | ("text" extends ChildNames<Sc, N> ? string : never)
  | ReadonlyArray<Node<Sc & DocSchema<any, any>, ChildNames<Sc, N> & NodeNames<Sc>>>

/**
 * A node builder (`editor.nodes.<name>`). The attributes may be omitted
 * when they all have defaults.
 *
 * @since 0.1.0
 * @category type-level
 */
export type NodeBuilder<Sc extends DocSchema<any, any>, N extends NodeNames<Sc>> = [
  keyof NodeAttrsInput<Sc, N>
] extends [never]
  ? {
      (attrs: null, ...children: ReadonlyArray<NodeChild<Sc, N>>): Node<Sc, N>
      (...children: ReadonlyArray<NodeChild<Sc, N>>): Node<Sc, N>
    }
  : AttrsOptional<NodeSpecOf<Sc, N>> extends true
    ? {
        (attrs?: NodeAttrsInput<Sc, N> | null, ...children: ReadonlyArray<NodeChild<Sc, N>>): Node<Sc, N>
        (...children: ReadonlyArray<NodeChild<Sc, N>>): Node<Sc, N>
      }
    : (attrs: NodeAttrsInput<Sc, N>, ...children: ReadonlyArray<NodeChild<Sc, N>>) => Node<Sc, N>

/**
 * A mark builder (`editor.marks.<name>`).
 *
 * @since 0.1.0
 * @category type-level
 */
export type MarkBuilder<Sc extends DocSchema<any, any>, M extends MarkNames<Sc>> =
  AttrsOptional<MarkSpecOf<Sc, M>> extends true
    ? (attrs?: MarkAttrsInput<Sc, M> | null) => Mark<Sc, M>
    : (attrs: MarkAttrsInput<Sc, M>) => Mark<Sc, M>

/**
 * @since 0.1.0
 * @category type-level
 */
export type NodeBuilders<Sc extends DocSchema<any, any>> = { readonly [N in NodeNames<Sc>]: NodeBuilder<Sc, N> }

/**
 * @since 0.1.0
 * @category type-level
 */
export type MarkBuilders<Sc extends DocSchema<any, any>> = { readonly [M in MarkNames<Sc>]: MarkBuilder<Sc, M> }

/**
 * Content accepted by `createEditor` and `setContent`: a document node,
 * its JSON representation, or an HTML string (parsed with the schema's
 * parse rules; needs a DOM `document`).
 *
 * @since 0.1.0
 * @category models
 */
export type EditorContent<Sc extends DocSchema<any, any>> = Node<Sc> | NodeJSON | string

/**
 * Options for `createEditor`.
 *
 * @since 0.1.0
 * @category models
 */
export interface EditorOptions<Sc extends DocSchema<any, any>> {
  /** The initial document. Defaults to an empty document. */
  readonly doc?: EditorContent<Sc> | undefined
  /** The initial selection. Defaults to the start of the document. */
  readonly selection?: ((doc: Node<Sc>) => Selection<Sc>) | undefined
}

/**
 * The errors `createEditor` can fail with besides those of the
 * extension's plugins: invalid specs (`SchemaDefinitionError`), invalid
 * initial content (`ModelError`), or a state that can't be created.
 *
 * @since 0.1.0
 * @category models
 */
export type CreateEditorError = SchemaDefinitionError | ModelError | StateFailure

/**
 * Options for `Editor.mount`: the view's props, without `state`.
 *
 * @since 0.1.0
 * @category models
 */
export type MountProps<Sc extends DocSchema<any, any>, R, E> = Omit<DirectEditorProps<Sc, R, E>, "state">

// -----------------------------------------------------------------------------
// Chaining
// -----------------------------------------------------------------------------

/**
 * An editor state seen by chained commands. It shares one transaction
 * between all commands in a chain: its `doc`, `selection` and stored
 * marks are the transaction's current ones, and its `tr` is the shared
 * transaction itself. Plugin state is that of the state the chain
 * started from.
 *
 * @internal
 */
class ChainableState<Sc extends DocSchema<any, any>> extends EditorState<Sc, any, any> {
  constructor(
    base: EditorState<Sc, any, any>,
    readonly chainTr: Transaction<Sc>
  ) {
    super(base.config, base.slots)
  }
  override get doc(): Node<Sc> {
    return this.chainTr.doc
  }
  override get selection(): Selection<Sc> {
    return this.chainTr.selection
  }
  override get storedMarksOrNull(): ReadonlyArray<Mark<Sc>> | null {
    return this.chainTr.storedMarksOrNull
  }
  override get tr(): Transaction<Sc> {
    return this.chainTr
  }
}

// Fold a transaction dispatched by a chained command that is not the
// shared one (a command that didn't create its transaction from
// `state.tr`) into the shared transaction.
const foldInto = (target: Transaction<any>, tr: Transaction<any>): void => {
  if (tr === target) return
  if (!tr.before.eq(target.doc)) {
    throw new StateError({ message: "A chained command dispatched a transaction that doesn't match the chain" })
  }
  for (const step of tr.steps) target.stepUnsafe(step)
  if (tr.selectionSet) {
    target.setSelectionUnsafe(tr.selection.map(target.doc, target.mapping.slice(target.steps.length)))
  }
  if (tr.storedMarksSet) target.setStoredMarks(tr.storedMarksOrNull)
  if (tr.scrolledIntoView) target.scrollIntoView()
  const meta = (tr as any).meta as Record<string, unknown>
  for (const key in meta) target.setMeta(key, meta[key])
}

const isPlainObject = (u: unknown): u is Attrs => {
  if (u === null || typeof u !== "object" || Array.isArray(u)) return false
  const proto = Object.getPrototypeOf(u)
  return proto === Object.prototype || proto === null
}

const dieOnStateFailure = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, Exclude<E, StateFailure>, R> =>
  Effect.catchIf(effect, isStateFailure as any, (e) => Effect.die(e)) as any

// -----------------------------------------------------------------------------
// Editor
// -----------------------------------------------------------------------------

/**
 * @since 0.1.0
 * @category symbols
 */
export const EditorTypeId: unique symbol = Symbol.for("effect-richtext/extensions/Editor") as never

/**
 * @since 0.1.0
 * @category symbols
 */
export type EditorTypeId = typeof EditorTypeId

/**
 * An editor created from an extension by `createEditor`. It owns the
 * current `EditorState`, and, while mounted, an `EditorView` (which then
 * holds the current state).
 *
 * @since 0.1.0
 * @category models
 */
export class Editor<T extends ExtensionTypes> {
  declare readonly [EditorTypeId]: { readonly _T: (_: never) => T }

  private _state: EditorState<SchemaOf<T>, T["R"], T["E"]>
  private _view: EditorView<SchemaOf<T>, T["R"], T["E"]> | undefined = undefined
  private readonly creators: Record<string, CommandCreator>

  /** Typed node builders: `editor.nodes.heading({ level: 2 }, "Title")`. Throw on invalid content. */
  readonly nodes: NodeBuilders<SchemaOf<T>>
  /** Typed mark builders: `editor.marks.link({ href })`. Throw on invalid attributes. */
  readonly marks: MarkBuilders<SchemaOf<T>>
  /** The editor's commands. */
  readonly commands: EditorCommands<T>

  /** @internal */
  constructor(
    /** The editor's schema, built from the extension's node and mark specs. */
    readonly schema: SchemaOf<T>,
    state: EditorState<SchemaOf<T>, T["R"], T["E"]>,
    creators: Record<string, CommandCreator>
  ) {
    this._state = state
    this.creators = creators
    const nodes: Record<string, unknown> = {}
    for (const name in schema.nodes) nodes[name] = this.nodeBuilder(name)
    this.nodes = nodes as any
    const marks: Record<string, unknown> = {}
    for (const name in schema.marks) {
      marks[name] = (attrs?: Attrs | null) => schema.markUnsafe(name as any, attrs as any)
    }
    this.marks = marks as any
    const commands: Record<string, unknown> = {}
    for (const name in creators) {
      commands[name] = (...args: Array<unknown>) =>
        Effect.suspend(() => this.runCommand(creators[name]!(...args), true))
    }
    this.commands = commands as any
  }

  /** The current editor state (the view's state while mounted). */
  get state(): EditorState<SchemaOf<T>, T["R"], T["E"]> {
    return this._view ? this._view.state : this._state
  }

  /** The view, while the editor is mounted. */
  get view(): Option.Option<EditorView<SchemaOf<T>, T["R"], T["E"]>> {
    return Option.fromUndefinedOr(this._view)
  }

  /** Whether the editor is currently mounted. */
  get mounted(): boolean {
    return this._view !== undefined
  }

  /**
   * Mount the editor: create an `EditorView` (with `EditorView.make`)
   * for the current state in `place`. The view is destroyed, and the
   * editor unmounted, when the scope closes (or on `unmount`). Mounting
   * an already mounted editor first unmounts it.
   */
  mount(
    place: ViewPlace,
    props?: MountProps<SchemaOf<T>, T["R"], T["E"]>
  ): Effect.Effect<void, never, Scope.Scope | T["R"]> {
    return Effect.gen({ self: this }, function* () {
      yield* this.unmount
      const view = yield* EditorView.make<SchemaOf<T>, T["R"], T["E"]>(place, { ...props, state: this.state })
      this._view = view
      yield* Effect.addFinalizer(() => Effect.sync(() => this.detach(view)))
    })
  }

  /** Destroy the view, if mounted. The editor keeps the view's last state. */
  get unmount(): Effect.Effect<void> {
    return Effect.sync(() => {
      const view = this._view
      if (view) {
        this.detach(view)
        view.destroy()
      }
    })
  }

  private detach(view: EditorView<SchemaOf<T>, T["R"], T["E"]>): void {
    if (this._view !== view) return
    this._state = view.state
    this._view = undefined
  }

  /**
   * Dispatch a transaction: through the view when mounted (honouring its
   * `dispatchTransaction` prop), otherwise by applying it to the
   * editor's state. Fails with the plugins' errors.
   */
  dispatch(tr: Transaction<SchemaOf<T>>): Effect.Effect<void, T["E"], T["R"]> {
    return Effect.suspend(() => {
      const view = this._view
      if (view) return dieOnStateFailure(view.tryDispatch(tr))
      return dieOnStateFailure(
        Effect.map(this._state.apply(tr), (state) => {
          this._state = state
        })
      )
    }) as any
  }

  // Run a command against the current state. The dispatch function
  // applies transactions immediately, with the context of the calling
  // fiber; failures of plugin hooks propagate through the command's
  // effect.
  private runCommand(command: Command<any, any, any>, dispatching: boolean): Effect.Effect<boolean, any, any> {
    if (!dispatching) return command(this.state, undefined, this._view)
    return Effect.flatMap(Effect.context<any>(), (context) => {
      const dispatch: Dispatch<any> = (tr) => Effect.provideContext(this.dispatch(tr), context) as Effect.Effect<void>
      return command(this.state, dispatch, this._view)
    })
  }

  /** Check whether commands apply to the current state, without dispatching. */
  can(): CanCommands<T> {
    const result: Record<string, unknown> = {}
    for (const name in this.creators) {
      result[name] = (...args: Array<unknown>) =>
        Effect.suspend(() => this.runCommand(this.creators[name]!(...args), false))
    }
    return result as any
  }

  /**
   * Queue commands to apply them in a single transaction. Each command
   * sees the document, selection and stored marks produced by the
   * previous ones (through a state whose `tr` is the shared
   * transaction). `run()` runs every queued command, then dispatches
   * the transaction (when any command changed it), and succeeds with
   * `true` when all commands applied.
   */
  chain(): ChainedCommands<T> {
    const queue: Array<Command<any, any, any>> = []
    const chain: Record<string, unknown> = {}
    for (const name in this.creators) {
      if (name === "run") continue
      chain[name] = (...args: Array<unknown>) => {
        queue.push(this.creators[name]!(...args))
        return chain
      }
    }
    chain.run = () =>
      Effect.gen({ self: this }, function* () {
        const state = this.state
        const tr = state.tr
        const chained = new ChainableState(state, tr)
        const dispatch: Dispatch<any> = (t) => Effect.sync(() => foldInto(tr, t))
        let all = true
        for (const command of queue) {
          if (!(yield* command(chained, dispatch, this._view))) all = false
        }
        if (tr.docChanged || tr.selectionSet || tr.storedMarksSet || tr.scrolledIntoView || !tr.isGeneric) {
          yield* this.dispatch(tr)
        }
        return all
      })
    return chain as any
  }

  /**
   * Replace the document's content (through a transaction, so plugins
   * like the history see it). Accepts a node, its JSON, or HTML.
   */
  setContent(content: EditorContent<SchemaOf<T>>): Effect.Effect<void, ModelError | T["E"], T["R"]> {
    return Effect.flatMap(
      attempt(() => parseContent(this.schema, content), isModelError),
      (doc) =>
        Effect.suspend(() => {
          const tr = this.state.tr
          tr.replaceWithUnsafe(0, tr.doc.content.size, doc.content)
          return this.dispatch(tr)
        })
    )
  }

  /** The current document as JSON. */
  getDocJSON(): NodeJSON {
    return this.state.doc.toJSON()
  }

  /** Create a text node with the given marks. Throws for empty strings. */
  text(text: string, ...marks: ReadonlyArray<Mark<SchemaOf<T>>>): TextNode<SchemaOf<T>> {
    return this.schema.textUnsafe(text, marks.length ? Mark.setFrom(marks) : null)
  }

  private nodeBuilder(name: string) {
    const type = this.schema.nodes[name]!
    return (...args: Array<unknown>) => {
      let attrs: Attrs | null = null
      if (args.length && (args[0] === null || isPlainObject(args[0]))) attrs = args.shift() as Attrs | null
      const children: Array<Node<any, any>> = []
      const add = (child: unknown) => {
        if (typeof child === "string") {
          if (child) children.push(this.schema.textUnsafe(child))
        } else if (Array.isArray(child)) child.forEach(add)
        else if (child instanceof Fragment) child.forEach((n) => children.push(n))
        else if (child instanceof Node) children.push(child)
        else throw new TypeError("Invalid child passed to a node builder: " + String(child))
      }
      args.forEach(add)
      return type.createCheckedUnsafe(attrs as any, children as any)
    }
  }
}

const parseContent = <Sc extends DocSchema<any, any>>(schema: Sc, content: EditorContent<Sc>): Node<Sc> => {
  if (content instanceof Node) {
    // Nodes from another schema (say, another editor's) are converted
    // through their JSON representation.
    return content.type.schema === schema ? content : (schema.nodeFromJSONUnsafe(content.toJSON()) as Node<Sc>)
  }
  if (typeof content === "string") return fromHTMLUnsafe(schema, content)
  return schema.nodeFromJSONUnsafe(content) as Node<Sc>
}

// -----------------------------------------------------------------------------
// Constructors
// -----------------------------------------------------------------------------

/**
 * Create an editor from an extension: builds the schema from the merged
 * node and mark specs (ordered by priority, then declaration), resolves
 * the plugins (keymaps included, same order) and creates the initial
 * state. The editor isn't mounted; see `Editor.mount`.
 *
 * @since 0.1.0
 * @category constructors
 */
export const createEditor = <T extends ExtensionTypes>(
  extension: Extension<T>,
  options: EditorOptions<SchemaOf<T>> = {}
): Effect.Effect<Editor<T>, CreateEditorError | T["E"], T["R"]> =>
  Effect.gen(function* () {
    const flat = flatten(extension)
    const schema = yield* DocSchema.make({ nodes: flat.nodes, marks: flat.marks }) as Effect.Effect<
      SchemaOf<T>,
      SchemaDefinitionError
    >
    const plugins: ReadonlyArray<AnyPlugin> = resolvePlugins(flat.plugins, schema)
    const doc =
      options.doc === undefined ? undefined : yield* attempt(() => parseContent(schema, options.doc!), isModelError)
    const config: EditorStateConfig<SchemaOf<T>> = {
      schema,
      doc,
      selection: doc && options.selection ? options.selection(doc) : undefined,
      plugins
    }
    const state = yield* EditorState.create(config)
    return new Editor<T>(schema, state as any, flat.commands)
  }) as any

/**
 * Like `createEditor`, but runs synchronously and throws failures. Only
 * available for extensions that require no services.
 *
 * @since 0.1.0
 * @category constructors
 */
export const createEditorUnsafe = <T extends ExtensionTypes & { readonly R: never }>(
  extension: Extension<T>,
  options: EditorOptions<SchemaOf<T>> = {}
): Editor<T> => runSyncUnsafe(createEditor(extension, options) as Effect.Effect<Editor<T>, unknown>)
