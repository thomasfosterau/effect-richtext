/**
 * The editor state.
 *
 * @since 0.1.0
 */
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import type { AnySchema, Mark, MarkJSON, ModelError, Node, NodeJSON } from "../model.ts"
import { type SelectionError, StateError } from "./errors.ts"
import type { AnyPlugin, Plugin, PluginErrors, PluginRequirements, StateField } from "./plugin.ts"
import { Selection, type SelectionJSON, type TextSelection } from "./selection.ts"
import { Transaction } from "./transaction.ts"

/**
 * The type of object passed to `EditorState.create`.
 *
 * @since 0.1.0
 * @category models
 */
export interface EditorStateConfig<
  Sc extends AnySchema = AnySchema,
  P extends ReadonlyArray<AnyPlugin> = ReadonlyArray<AnyPlugin>
> {
  /** The schema to use (only relevant if no `doc` is specified). */
  readonly schema?: Sc | undefined
  /** The starting document. Either this or `schema` _must_ be provided. */
  readonly doc?: Node<Sc> | undefined
  /** A valid selection in the document. */
  readonly selection?: Selection<Sc> | undefined
  /** The initial set of stored marks. */
  readonly storedMarks?: ReadonlyArray<Mark<Sc>> | null | undefined
  /** The plugins that should be active in this state. */
  readonly plugins?: P | undefined
}

/**
 * The JSON representation of an editor state (see `EditorState.toJSON`).
 *
 * @since 0.1.0
 * @category models
 */
export interface EditorStateJSON {
  readonly doc: NodeJSON
  readonly selection: SelectionJSON
  readonly storedMarks?: ReadonlyArray<MarkJSON>
  readonly [field: string]: unknown
}

/**
 * The result of `EditorState.applyTransaction`.
 *
 * @since 0.1.0
 * @category models
 */
export interface ApplyResult<Sc extends AnySchema, R, E> {
  readonly state: EditorState<Sc, R, E>
  readonly transactions: ReadonlyArray<Transaction<Sc>>
}

interface FieldDesc {
  readonly name: string
  readonly self: unknown
  readonly init: StateField<any, any, any, any>["init"]
  readonly apply: StateField<any, any, any, any>["apply"]
}

const baseFields: ReadonlyArray<FieldDesc> = [
  {
    name: "doc",
    self: undefined,
    init(config) {
      if (config.doc) return config.doc
      const node = config.schema!.topNodeType.createAndFillOrNull()
      if (!node) throw new StateError({ message: "Can't create a default document for the schema" })
      return node
    },
    apply(tr) {
      return tr.doc
    }
  },
  {
    name: "selection",
    self: undefined,
    init(config, instance) {
      return config.selection || Selection.atStart(instance.doc)
    },
    apply(tr) {
      return tr.selection
    }
  },
  {
    name: "storedMarks",
    self: undefined,
    init(config) {
      return config.storedMarks || null
    },
    apply(tr, _marks, _old, state) {
      return (state.selection as TextSelection<any>).$cursorOrNull ? tr.storedMarksOrNull : null
    }
  },
  {
    name: "scrollToSelection",
    self: undefined,
    init() {
      return 0
    },
    apply(tr, prev) {
      return tr.scrolledIntoView ? prev + 1 : prev
    }
  }
]

/**
 * Object wrapping the part of a state object that stays the same across
 * transactions. Stored in the state's `config` property.
 *
 * @internal
 */
export class Configuration<Sc extends AnySchema> {
  readonly fields: Array<FieldDesc>
  readonly plugins: Array<AnyPlugin> = []
  readonly pluginsByKey: Record<string, AnyPlugin> = Object.create(null)

  constructor(readonly schema: Sc, plugins?: ReadonlyArray<AnyPlugin>) {
    this.fields = baseFields.slice()
    if (plugins) {
      plugins.forEach((plugin) => {
        if (this.pluginsByKey[plugin.key]) {
          throw new StateError({ message: "Adding different instances of a keyed plugin (" + plugin.key + ")" })
        }
        this.plugins.push(plugin)
        this.pluginsByKey[plugin.key] = plugin
        const state = plugin.spec.state
        if (state) this.fields.push({ name: plugin.key, self: plugin, init: state.init, apply: state.apply })
      })
    }
  }
}

const isStateError = (u: unknown): u is StateError => u instanceof StateError

/** Marker returned by the synchronous fast path when a hook returned an Effect. */
const NeedsEffect: unique symbol = Symbol("effect-richtext/state/NeedsEffect")

/** Lift a synchronous computation that may throw a `StateError` into an Effect. */
const trySync = <A>(f: () => A): Effect.Effect<A, StateError> =>
  Effect.suspend(() => {
    try {
      return Effect.succeed(f())
    } catch (e) {
      return isStateError(e) ? Effect.fail(e) : Effect.die(e)
    }
  })

/**
 * Run an effect synchronously, throwing its (first) failure or defect.
 *
 * @internal
 */
export const runSyncUnsafe = <A, E>(effect: Effect.Effect<A, E>): A => {
  const exit = Effect.runSyncExit(effect)
  if (Exit.isSuccess(exit)) return exit.value
  throw Cause.squash(exit.cause)
}

/**
 * @since 0.1.0
 * @category symbols
 */
export const EditorStateTypeId: unique symbol = Symbol.for("effect-richtext/state/EditorState") as never

/**
 * @since 0.1.0
 * @category symbols
 */
export type EditorStateTypeId = typeof EditorStateTypeId

/**
 * The state of an editor is represented by an object of this type. A
 * state is a persistent data structure—it isn't updated, but rather a
 * new state value is computed from an old one using the `apply` method.
 *
 * A state holds a number of built-in fields, and plugins can define
 * additional fields.
 *
 * `R` and `E` are the unions of the requirements and errors of the
 * state's plugins: applying a transaction runs the plugins' hooks, so
 * `apply` returns an `Effect<EditorState<Sc, R, E>, E | StateError, R>`.
 * States whose plugins require no services (`R = never`) can also be
 * updated synchronously with `applyUnsafe`.
 *
 * @since 0.1.0
 * @category models
 */
export class EditorState<Sc extends AnySchema = AnySchema, R = never, E = never> {
  declare readonly [EditorStateTypeId]: {
    readonly _R: (_: never) => R
    readonly _E: (_: never) => E
  }

  /** @internal */
  constructor(
    /** @internal */
    readonly config: Configuration<Sc>,
    /** @internal */
    readonly slots: Record<string, any> = Object.create(null)
  ) {}

  /** The current document. */
  get doc(): Node<Sc> {
    return this.slots.doc
  }

  /** The selection. */
  get selection(): Selection<Sc> {
    return this.slots.selection
  }

  /** A set of marks to apply to the next input. `None` when no explicit marks have been set. */
  get storedMarks(): Option.Option<ReadonlyArray<Mark<Sc>>> {
    return Option.fromNullishOr(this.storedMarksOrNull)
  }

  /** @internal */
  get storedMarksOrNull(): ReadonlyArray<Mark<Sc>> | null {
    return this.slots.storedMarks
  }

  /** @internal */
  get scrollToSelection(): number {
    return this.slots.scrollToSelection
  }

  /** The schema of the state's document. */
  get schema(): Sc {
    return this.config.schema
  }

  /** The plugins that are active in this state. */
  get plugins(): ReadonlyArray<Plugin<any, Sc, E, R>> {
    return this.config.plugins
  }

  /** Create a new transaction from this state. */
  get tr(): Transaction<Sc> {
    return new Transaction(this)
  }

  /** Apply the given transaction to produce a new state. */
  apply(tr: Transaction<Sc>): Effect.Effect<EditorState<Sc, R, E>, E | StateError, R> {
    return Effect.map(this.applyTransaction(tr), (r) => r.state)
  }

  /**
   * Like `apply`, but runs synchronously, throwing failures. Only
   * available for states whose plugins require no services; fails with
   * a defect (thrown) when a plugin hook is asynchronous.
   */
  applyUnsafe(this: EditorState<Sc, never, E>, tr: Transaction<Sc>): EditorState<Sc, never, E> {
    return this.applyTransactionUnsafe(tr).state
  }

  /** @internal */
  filterTransaction(tr: Transaction<Sc>, ignore = -1): Effect.Effect<boolean, E, R> {
    const plugins = this.config.plugins
    const self = this
    return Effect.gen(function*() {
      for (let i = 0; i < plugins.length; i++) {
        if (i === ignore) continue
        const plugin = plugins[i]!, filter = plugin.spec.filterTransaction
        if (filter) {
          const result = filter.call(plugin, tr, self)
          const ok = Effect.isEffect(result) ? yield* (result as Effect.Effect<boolean, E, R>) : result
          if (!ok) return false
        }
      }
      return true
    })
  }

  /**
   * Verbose variant of `apply` that returns the precise transactions
   * that were applied (which might be influenced by the transaction
   * hooks of plugins) along with the new state.
   */
  applyTransaction(rootTr: Transaction<Sc>): Effect.Effect<ApplyResult<Sc, R, E>, E | StateError, R> {
    return Effect.suspend(() => {
      // Fast path: when every plugin hook returns a plain value, apply
      // synchronously without building an Effect pipeline. Hooks are
      // expected to be pure, so falling back to the effectful path (which
      // re-runs them) is safe.
      let result: ApplyResult<Sc, R, E> | typeof NeedsEffect
      try {
        result = this.applyTransactionSync(rootTr)
      } catch (e) {
        return isStateError(e) ? Effect.fail(e) : Effect.die(e)
      }
      return result === NeedsEffect ? this.applyTransactionEffect(rootTr) : Effect.succeed(result)
    })
  }

  /** @internal */
  applyTransactionSync(rootTr: Transaction<Sc>): ApplyResult<Sc, R, E> | typeof NeedsEffect {
    const filtered = this.filterTransactionSync(rootTr)
    if (filtered === NeedsEffect) return NeedsEffect
    if (!filtered) return { state: this, transactions: [] }
    const trs: Array<Transaction<Sc>> = [rootTr]
    let newState = this.applyInnerSync(rootTr)
    if (newState === NeedsEffect) return NeedsEffect
    let seen: Array<{ state: EditorState<Sc, R, E>; n: number }> | null = null
    const plugins = this.config.plugins
    for (;;) {
      let haveNew = false
      for (let i = 0; i < plugins.length; i++) {
        const plugin = plugins[i]!, append = plugin.spec.appendTransaction
        if (append) {
          const n = seen ? seen[i]!.n : 0, oldState = seen ? seen[i]!.state : this
          let tr: Transaction<Sc> | null | undefined | void = undefined
          if (n < trs.length) {
            const result = append.call(plugin, n ? trs.slice(n) : trs, oldState, newState)
            if (Effect.isEffect(result)) return NeedsEffect
            tr = result as Transaction<Sc> | null | undefined
          }
          if (tr) {
            const ok = newState.filterTransactionSync(tr, i)
            if (ok === NeedsEffect) return NeedsEffect
            if (ok) {
              tr.setMeta("appendedTransaction", rootTr)
              if (!seen) {
                seen = []
                for (let j = 0; j < plugins.length; j++) {
                  seen.push(j < i ? { state: newState, n: trs.length } : { state: this, n: 0 })
                }
              }
              trs.push(tr)
              const next: EditorState<Sc, R, E> | typeof NeedsEffect = newState.applyInnerSync(tr)
              if (next === NeedsEffect) return NeedsEffect
              newState = next
              haveNew = true
            }
          }
          if (seen) seen[i] = { state: newState, n: trs.length }
        }
      }
      if (!haveNew) return { state: newState, transactions: trs }
    }
  }

  /** @internal */
  filterTransactionSync(tr: Transaction<Sc>, ignore = -1): boolean | typeof NeedsEffect {
    const plugins = this.config.plugins
    for (let i = 0; i < plugins.length; i++) {
      if (i === ignore) continue
      const plugin = plugins[i]!, filter = plugin.spec.filterTransaction
      if (filter) {
        const result = filter.call(plugin, tr, this)
        if (Effect.isEffect(result)) return NeedsEffect
        if (!result) return false
      }
    }
    return true
  }

  /** @internal */
  applyInnerSync(tr: Transaction<Sc>): EditorState<Sc, R, E> | typeof NeedsEffect {
    if (!tr.before.eq(this.doc)) throw new StateError({ message: "Applying a mismatched transaction" })
    const newInstance = new EditorState<Sc, R, E>(this.config), fields = this.config.fields
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i]!
      const result = field.apply.call(field.self, tr, this.slots[field.name], this, newInstance)
      if (Effect.isEffect(result)) return NeedsEffect
      newInstance.slots[field.name] = result
    }
    return newInstance
  }

  /** @internal */
  applyTransactionEffect(rootTr: Transaction<Sc>): Effect.Effect<ApplyResult<Sc, R, E>, E | StateError, R> {
    const self = this
    return Effect.gen(function*() {
      if (!(yield* self.filterTransaction(rootTr))) return { state: self, transactions: [] }

      const trs: Array<Transaction<Sc>> = [rootTr]
      let newState = yield* self.applyInner(rootTr)
      let seen: Array<{ state: EditorState<Sc, R, E>; n: number }> | null = null
      const plugins = self.config.plugins
      // This loop repeatedly gives plugins a chance to respond to
      // transactions as new transactions are added, making sure to only
      // pass the transactions the plugin did not see before.
      for (;;) {
        let haveNew = false
        for (let i = 0; i < plugins.length; i++) {
          const plugin = plugins[i]!, append = plugin.spec.appendTransaction
          if (append) {
            const n = seen ? seen[i]!.n : 0, oldState = seen ? seen[i]!.state : self
            let tr: Transaction<Sc> | null | undefined | void = undefined
            if (n < trs.length) {
              const result = append.call(plugin, n ? trs.slice(n) : trs, oldState, newState)
              tr = Effect.isEffect(result)
                ? yield* (result as Effect.Effect<Transaction<Sc> | null | undefined, E, R>)
                : result as Transaction<Sc> | null | undefined
            }
            if (tr && (yield* newState.filterTransaction(tr, i))) {
              tr.setMeta("appendedTransaction", rootTr)
              if (!seen) {
                seen = []
                for (let j = 0; j < plugins.length; j++) {
                  seen.push(j < i ? { state: newState, n: trs.length } : { state: self, n: 0 })
                }
              }
              trs.push(tr)
              newState = yield* newState.applyInner(tr)
              haveNew = true
            }
            if (seen) seen[i] = { state: newState, n: trs.length }
          }
        }
        if (!haveNew) return { state: newState, transactions: trs as ReadonlyArray<Transaction<Sc>> }
      }
    })
  }

  /** Like `applyTransaction`, but runs synchronously (see `applyUnsafe`). */
  applyTransactionUnsafe(this: EditorState<Sc, never, E>, rootTr: Transaction<Sc>): ApplyResult<Sc, never, E> {
    const result = this.applyTransactionSync(rootTr)
    return result === NeedsEffect ? runSyncUnsafe(this.applyTransactionEffect(rootTr)) : result
  }

  /** @internal */
  applyInner(tr: Transaction<Sc>): Effect.Effect<EditorState<Sc, R, E>, E | StateError, R> {
    const self = this
    return Effect.gen(function*() {
      if (!tr.before.eq(self.doc)) {
        return yield* Effect.fail(new StateError({ message: "Applying a mismatched transaction" }))
      }
      const newInstance = new EditorState<Sc, R, E>(self.config), fields = self.config.fields
      for (let i = 0; i < fields.length; i++) {
        const field = fields[i]!
        const result = field.apply.call(field.self, tr, self.slots[field.name], self, newInstance)
        newInstance.slots[field.name] = Effect.isEffect(result)
          ? yield* (result as Effect.Effect<unknown, E, R>)
          : result
      }
      return newInstance
    })
  }

  /**
   * Create a new state based on this one, but with an adjusted set of
   * active plugins. State fields that exist in both sets of plugins are
   * kept unchanged. Those that no longer exist are dropped, and those
   * that are new are initialized using their `init` method, passing in
   * the new configuration object.
   */
  reconfigure<const P extends ReadonlyArray<AnyPlugin> = readonly []>(config: {
    readonly plugins?: P | undefined
  }): Effect.Effect<
    EditorState<Sc, PluginRequirements<P>, PluginErrors<P>>,
    PluginErrors<P> | StateError,
    PluginRequirements<P>
  > {
    const self = this
    return Effect.gen(function*() {
      const $config = yield* trySync(() => new Configuration(self.schema, config.plugins))
      const fields = $config.fields, instance = new EditorState<Sc, PluginRequirements<P>, PluginErrors<P>>($config)
      for (let i = 0; i < fields.length; i++) {
        const field = fields[i]!, name = field.name
        if (Object.prototype.hasOwnProperty.call(self.slots, name)) {
          instance.slots[name] = self.slots[name]
        } else {
          const result = field.init.call(field.self, config, instance)
          instance.slots[name] = Effect.isEffect(result) ? yield* (result as Effect.Effect<unknown, any, any>) : result
        }
      }
      return instance
    }) as any
  }

  /** Like `reconfigure`, but runs synchronously (see `applyUnsafe`). */
  reconfigureUnsafe<const P extends ReadonlyArray<Plugin<any, any, any, never>> = readonly []>(config: {
    readonly plugins?: P | undefined
  }): EditorState<Sc, never, PluginErrors<P>> {
    return runSyncUnsafe(this.reconfigure(config)) as any
  }

  /**
   * Serialize this state to JSON. If you want to serialize the state of
   * plugins, pass an object mapping property names to use in the
   * resulting JSON object to plugin objects. The argument may also be a
   * string or number, in which case it is ignored, to support the way
   * `JSON.stringify` calls `toJSON` methods. Throws a `StateError` when
   * a plugin is mapped to the reserved `doc` or `selection` fields.
   */
  toJSON(pluginFields?: Record<string, AnyPlugin> | string | number): EditorStateJSON {
    const result: Record<string, unknown> = { doc: this.doc.toJSON(), selection: this.selection.toJSON() }
    if (this.storedMarksOrNull) result.storedMarks = this.storedMarksOrNull.map((m) => m.toJSON())
    if (pluginFields && typeof pluginFields === "object") {
      for (const prop in pluginFields) {
        if (prop === "doc" || prop === "selection") {
          throw new StateError({ message: "The JSON fields `doc` and `selection` are reserved" })
        }
        const plugin = pluginFields[prop]!, state = plugin.spec.state
        if (state && state.toJSON) result[prop] = state.toJSON.call(plugin, this.slots[plugin.key])
      }
    }
    return result as unknown as EditorStateJSON
  }

  /** Create a new state. */
  static create<Sc extends AnySchema, const P extends ReadonlyArray<AnyPlugin> = readonly []>(
    config: EditorStateConfig<Sc, P>
  ): Effect.Effect<
    EditorState<Sc, PluginRequirements<P>, PluginErrors<P>>,
    PluginErrors<P> | StateError,
    PluginRequirements<P>
  > {
    return Effect.gen(function*() {
      const schema = config.doc ? config.doc.type.schema as Sc : config.schema
      if (!schema) return yield* Effect.fail(new StateError({ message: "Either `doc` or `schema` must be provided" }))
      const $config = yield* trySync(() => new Configuration(schema, config.plugins))
      const instance = new EditorState<Sc, PluginRequirements<P>, PluginErrors<P>>($config)
      for (let i = 0; i < $config.fields.length; i++) {
        const field = $config.fields[i]!
        const result = yield* trySync(() => field.init.call(field.self, config, instance))
        instance.slots[field.name] = Effect.isEffect(result)
          ? yield* (result as Effect.Effect<unknown, any, any>)
          : result
      }
      return instance
    }) as any
  }

  /**
   * Like `create`, but runs synchronously. Only available when the
   * plugins require no services; throws on failure.
   */
  static createUnsafe<Sc extends AnySchema, const P extends ReadonlyArray<Plugin<any, any, any, never>> = readonly []>(
    config: EditorStateConfig<Sc, P>
  ): EditorState<Sc, never, PluginErrors<P>> {
    return runSyncUnsafe(EditorState.create(config)) as any
  }

  /**
   * Deserialize a JSON representation of a state. `config` should have
   * at least a `schema` field, and should contain an array of plugins to
   * initialize the state with. `pluginFields` can be used to deserialize
   * the state of plugins, by associating plugin instances with the
   * property names they use in the JSON object.
   */
  static fromJSON<Sc extends AnySchema, const P extends ReadonlyArray<AnyPlugin> = readonly []>(
    config: { readonly schema: Sc; readonly plugins?: P | undefined },
    json: unknown,
    pluginFields?: Record<string, AnyPlugin>
  ): Effect.Effect<
    EditorState<Sc, PluginRequirements<P>, PluginErrors<P>>,
    PluginErrors<P> | StateError | SelectionError | ModelError,
    PluginRequirements<P>
  > {
    return Effect.gen(function*() {
      const data = json as Record<string, any> | null | undefined
      if (!data || typeof data !== "object") {
        return yield* Effect.fail(new StateError({ message: "Invalid input for EditorState.fromJSON" }))
      }
      if (!config.schema) {
        return yield* Effect.fail(new StateError({ message: "Required config field 'schema' missing" }))
      }
      const $config = yield* trySync(() => new Configuration(config.schema, config.plugins))
      const instance = new EditorState<Sc, PluginRequirements<P>, PluginErrors<P>>($config)
      for (const field of $config.fields) {
        if (field.name === "doc") {
          instance.slots.doc = yield* config.schema.nodeFromJSON(data.doc)
        } else if (field.name === "selection") {
          instance.slots.selection = yield* Selection.fromJSON(instance.doc, data.selection)
        } else if (field.name === "storedMarks") {
          if (data.storedMarks) {
            const marks: Array<Mark<Sc>> = []
            for (const m of data.storedMarks as Array<unknown>) marks.push(yield* config.schema.markFromJSON(m))
            instance.slots.storedMarks = marks
          } else {
            instance.slots.storedMarks = null
          }
        } else {
          let done = false
          if (pluginFields) {
            for (const prop in pluginFields) {
              const plugin = pluginFields[prop]!, state = plugin.spec.state
              if (
                plugin.key === field.name && state && state.fromJSON &&
                Object.prototype.hasOwnProperty.call(data, prop)
              ) {
                // This field belongs to a plugin mapped to a JSON field, read it from there.
                const result = state.fromJSON.call(plugin, config, data[prop], instance)
                instance.slots[field.name] = Effect.isEffect(result)
                  ? yield* (result as Effect.Effect<unknown, any, any>)
                  : result
                done = true
                break
              }
            }
          }
          if (!done) {
            const result = field.init.call(field.self, config, instance)
            instance.slots[field.name] = Effect.isEffect(result)
              ? yield* (result as Effect.Effect<unknown, any, any>)
              : result
          }
        }
      }
      return instance
    }) as any
  }

  /** Like `fromJSON`, but runs synchronously (see `createUnsafe`). */
  static fromJSONUnsafe<
    Sc extends AnySchema,
    const P extends ReadonlyArray<Plugin<any, any, any, never>> = readonly []
  >(
    config: { readonly schema: Sc; readonly plugins?: P | undefined },
    json: unknown,
    pluginFields?: Record<string, AnyPlugin>
  ): EditorState<Sc, never, PluginErrors<P>> {
    return runSyncUnsafe(EditorState.fromJSON(config, json, pluginFields)) as any
  }
}
