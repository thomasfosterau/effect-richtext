/**
 * The editor state.
 *
 * @since 0.1.0
 */
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Result from "effect/Result"
import * as Predicate from "effect/Predicate"
import type * as Types from "effect/Types"
import type { AnySchema, Mark, MarkJSON, ModelError, Node, NodeJSON } from "../Model.ts"
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

  constructor(
    readonly schema: Sc,
    plugins?: ReadonlyArray<AnyPlugin>
  ) {
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

// EditorState's algorithms (create, apply, filter, reconfigure, fromJSON) are
// written once, as generators that yield a plugin hook's result when it is
// an Effect and are resumed with its value; a plain result is used in place,
// so an all-synchronous transaction costs no generator resumes per hook. A
// yielded `Call` enters a nested algorithm and resumes with what it returns.
// One generator serves both twins: `Run.advance` runs it synchronously, and
// the first Effect hands the suspended run to `resume`, so the hooks that
// already ran are not run again. A `yield` is typed `any` (Generator's
// default TNext) because each resolves to its own hook's result type.
type Steps<A> = Generator<unknown, A>

// A hook's result is an Effect to yield. Its channels are left to the run
// that resolves it (`Run`), so they are not tracked at the yield.
const isHookEffect = (u: unknown): u is Effect.Effect<unknown> => Effect.isEffect(u)

class Call {
  constructor(readonly steps: Steps<unknown>) {}
}

// One run of an algorithm: the generator it started with, the nested ones it
// has entered (innermost last), and the value to resume the innermost with.
// `E` and `R` are the channels of the plugins whose hooks it runs.
class Run<E, R> {
  private readonly nested: Array<Steps<unknown>> = []
  input: unknown = undefined

  constructor(private readonly root: Steps<unknown>) {}

  // Run until the root algorithm returns, or a step yields an Effect.
  // Throws what a step throws.
  advance(): IteratorResult<Effect.Effect<unknown, E, R>, unknown> {
    for (;;) {
      const step = (this.nested[this.nested.length - 1] ?? this.root).next(this.input)
      if (step.done) {
        if (this.nested.pop() === undefined) return step
        this.input = step.value
      } else if (step.value instanceof Call) {
        this.nested.push(step.value.steps)
        this.input = undefined
      } else if (this.isHookEffect(step.value)) {
        return { done: false, value: step.value }
      } else {
        this.input = step.value
      }
    }
  }

  // A yielded Effect is a plugin hook's result, so its channels are E and R.
  private isHookEffect(u: unknown): u is Effect.Effect<unknown, E, R> {
    return Effect.isEffect(u)
  }
}

// Resume `run`, resolving each Effect it suspends on in turn. A thrown
// `StateError` becomes a failure; anything else thrown is a defect.
const resume = <E, R>(run: Run<E, R>): Effect.Effect<unknown, E | StateError, R> => {
  const advanced = Result.try(() => run.advance())
  if (Result.isFailure(advanced)) {
    const e = advanced.failure
    return isStateError(e) ? Effect.fail(e) : Effect.die(e)
  }
  const step = advanced.success
  if (step.done) return Effect.succeed(step.value)
  return Effect.flatMap(step.value, (value) => {
    run.input = value
    return resume(run)
  })
}

// Run an algorithm as an Effect. `make` is called per run, so the Effect can
// be run more than once.
const runSteps = <A, E, R>(make: () => Steps<A>): Effect.Effect<A, E | StateError, R> =>
  // SAFETY: the root generator is `make()`, so the run's result is its `A`.
  Effect.suspend(() => resume(new Run<E, R>(make()))) as Effect.Effect<A, E | StateError, R>

// Run an algorithm synchronously. From the first hook that returns an
// Effect, the rest runs through runSyncUnsafe, which throws the failure, or
// a defect when a hook is asynchronous; the `Unsafe` twins are only typed
// for plugins that require no services. Failures are thrown, not typed,
// hence `never` for the run's channels.
const runStepsUnsafe = <A>(steps: Steps<A>): A => {
  const run = new Run<never, never>(steps)
  const step = run.advance()
  const value = step.done
    ? step.value
    : runSyncUnsafe(
        Effect.flatMap(step.value, (resolved) => {
          run.input = resolved
          return resume(run)
        })
      )
  // SAFETY: the root generator is `steps`, so the run's result is its `A`.
  return value as A
}

function* createSteps<Sc extends AnySchema, R, E>(config: EditorStateConfig<Sc>): Steps<EditorState<Sc, R, E>> {
  const schema = config.doc ? config.doc.type.schema : config.schema
  if (!schema) throw new StateError({ message: "Either `doc` or `schema` must be provided" })
  const instance = new EditorState<Sc, R, E>(new Configuration(schema, config.plugins))
  for (const field of instance.config.fields) {
    instance.slots[field.name] = yield field.init.call(field.self, config, instance)
  }
  return instance
}

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
 * @example
 * ```ts
 * import * as assert from "node:assert"
 * import * as Effect from "effect/Effect"
 * import { EditorState } from "@thomasfosterau/effect-richtext/State"
 * import { doc, p, schema } from "@thomasfosterau/effect-richtext/TestBuilder"
 *
 * const program = Effect.gen(function* () {
 *   const state = yield* EditorState.create({ schema, doc: doc(p("Hello")) })
 *
 *   // States are persistent: applying a transaction returns a new state.
 *   const next = yield* state.apply(state.tr.insertTextUnsafe(" world", 6))
 *   assert.strictEqual(state.doc.textContent, "Hello")
 *   assert.strictEqual(next.doc.textContent, "Hello world")
 * })
 *
 * Effect.runSync(program)
 * ```
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
  filterTransaction(tr: Transaction<Sc>, ignore = -1): Effect.Effect<boolean, E | StateError, R> {
    return runSteps(() => filterSteps(this, tr, ignore))
  }

  /**
   * Verbose variant of `apply` that returns the precise transactions
   * that were applied (which might be influenced by the transaction
   * hooks of plugins) along with the new state.
   */
  applyTransaction(rootTr: Transaction<Sc>): Effect.Effect<ApplyResult<Sc, R, E>, E | StateError, R> {
    return runSteps(() => applySteps(this, rootTr))
  }

  /** Like `applyTransaction`, but runs synchronously (see `applyUnsafe`). */
  applyTransactionUnsafe(this: EditorState<Sc, never, E>, rootTr: Transaction<Sc>): ApplyResult<Sc, never, E> {
    return runStepsUnsafe(applySteps(this, rootTr))
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
    return runSteps(() => reconfigureSteps(this, config))
  }

  /** Like `reconfigure`, but runs synchronously (see `applyUnsafe`). */
  reconfigureUnsafe<const P extends ReadonlyArray<Plugin<any, any, any, never>> = readonly []>(config: {
    readonly plugins?: P | undefined
  }): EditorState<Sc, never, PluginErrors<P>> {
    return runStepsUnsafe(reconfigureSteps(this, config))
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
    const result: Types.Mutable<EditorStateJSON> = { doc: this.doc.toJSON(), selection: this.selection.toJSON() }
    if (this.storedMarksOrNull) result.storedMarks = this.storedMarksOrNull.map((m) => m.toJSON())
    if (Predicate.isObjectOrArray(pluginFields)) {
      for (const prop in pluginFields) {
        if (prop === "doc" || prop === "selection") {
          throw new StateError({ message: "The JSON fields `doc` and `selection` are reserved" })
        }
        const plugin = pluginFields[prop]!,
          state = plugin.spec.state
        if (state && state.toJSON) result[prop] = state.toJSON.call(plugin, this.slots[plugin.key])
      }
    }
    return result
  }

  /** Create a new state. */
  static create<Sc extends AnySchema, const P extends ReadonlyArray<AnyPlugin> = readonly []>(
    config: EditorStateConfig<Sc, P>
  ): Effect.Effect<
    EditorState<Sc, PluginRequirements<P>, PluginErrors<P>>,
    PluginErrors<P> | StateError,
    PluginRequirements<P>
  > {
    return runSteps(() => createSteps(config))
  }

  /**
   * Like `create`, but runs synchronously. Only available when the
   * plugins require no services; throws on failure.
   */
  static createUnsafe<Sc extends AnySchema, const P extends ReadonlyArray<Plugin<any, any, any, never>> = readonly []>(
    config: EditorStateConfig<Sc, P>
  ): EditorState<Sc, never, PluginErrors<P>> {
    // Synchronous unless a plugin's init hook returns an Effect.
    return runStepsUnsafe(createSteps(config))
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
    // The JSON decoders are Effects, yielded like the hooks.
    return runSteps(function* () {
      const data = json as Record<string, any> | null | undefined
      if (!Predicate.isObject(data)) throw new StateError({ message: "Invalid input for EditorState.fromJSON" })
      if (!config.schema) throw new StateError({ message: "Required config field 'schema' missing" })
      const $config = new Configuration(config.schema, config.plugins)
      const instance = new EditorState<Sc, PluginRequirements<P>, PluginErrors<P>>($config)
      for (const field of $config.fields) {
        if (field.name === "doc") {
          instance.slots.doc = yield config.schema.nodeFromJSON(data.doc)
        } else if (field.name === "selection") {
          instance.slots.selection = yield Selection.fromJSON(instance.doc, data.selection)
        } else if (field.name === "storedMarks") {
          if (data.storedMarks) {
            const marks: Array<Mark<Sc>> = []
            for (const m of data.storedMarks as Array<unknown>) marks.push(yield config.schema.markFromJSON(m))
            instance.slots.storedMarks = marks
          } else {
            instance.slots.storedMarks = null
          }
        } else {
          let done = false
          if (pluginFields) {
            for (const prop in pluginFields) {
              const plugin = pluginFields[prop]!,
                state = plugin.spec.state
              if (
                plugin.key === field.name &&
                state &&
                state.fromJSON &&
                Object.prototype.hasOwnProperty.call(data, prop)
              ) {
                // This field belongs to a plugin mapped to a JSON field, read it from there.
                instance.slots[field.name] = yield state.fromJSON.call(plugin, config, data[prop], instance)
                done = true
                break
              }
            }
          }
          if (!done) instance.slots[field.name] = yield field.init.call(field.self, config, instance)
        }
      }
      return instance
    })
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
    // Every run awaits the document's decode, an Effect, so there is no synchronous fast path to take.
    return runSyncUnsafe(EditorState.fromJSON(config, json, pluginFields)) as any
  }
}

// The plugins' `filterTransaction` hooks, but the `ignore`th: false as soon
// as one rejects `tr`.
function* filterSteps<Sc extends AnySchema>(
  state: EditorState<Sc, any, any>,
  tr: Transaction<Sc>,
  ignore = -1
): Steps<boolean> {
  const plugins = state.config.plugins
  for (let i = 0; i < plugins.length; i++) {
    if (i === ignore) continue
    const plugin = plugins[i]!,
      filter = plugin.spec.filterTransaction
    if (filter) {
      const ok = filter.call(plugin, tr, state)
      if (!(isHookEffect(ok) ? yield ok : ok)) return false
    }
  }
  return true
}

// `applyTransaction`: filter and apply `rootTr`, then the transactions the
// plugins append in response.
function* applySteps<Sc extends AnySchema, R, E>(
  state: EditorState<Sc, R, E>,
  rootTr: Transaction<Sc>
): Steps<ApplyResult<Sc, R, E>> {
  if (!(yield new Call(filterSteps(state, rootTr)))) return { state, transactions: [] }

  const trs: Array<Transaction<Sc>> = [rootTr]
  let newState: EditorState<Sc, R, E> = yield new Call(applyInnerSteps(state, rootTr))
  let seen: Array<{ state: EditorState<Sc, R, E>; n: number }> | null = null
  const plugins = state.config.plugins
  // This loop repeatedly gives plugins a chance to respond to
  // transactions as new transactions are added, making sure to only
  // pass the transactions the plugin did not see before.
  for (;;) {
    let haveNew = false
    for (let i = 0; i < plugins.length; i++) {
      const plugin = plugins[i]!,
        append = plugin.spec.appendTransaction
      if (append) {
        const n = seen ? seen[i]!.n : 0,
          oldState = seen ? seen[i]!.state : state
        const appended = n < trs.length ? append.call(plugin, n ? trs.slice(n) : trs, oldState, newState) : undefined
        const tr: Transaction<Sc> | null | undefined = isHookEffect(appended) ? yield appended : appended
        if (tr && (yield new Call(filterSteps(newState, tr, i)))) {
          tr.setMeta("appendedTransaction", rootTr)
          if (!seen) {
            seen = []
            for (let j = 0; j < plugins.length; j++) {
              seen.push(j < i ? { state: newState, n: trs.length } : { state, n: 0 })
            }
          }
          trs.push(tr)
          newState = yield new Call(applyInnerSteps(newState, tr))
          haveNew = true
        }
        if (seen) seen[i] = { state: newState, n: trs.length }
      }
    }
    if (!haveNew) return { state: newState, transactions: trs }
  }
}

// Apply one transaction: every field's `apply` hook, in order.
function* applyInnerSteps<Sc extends AnySchema, R, E>(
  state: EditorState<Sc, R, E>,
  tr: Transaction<Sc>
): Steps<EditorState<Sc, R, E>> {
  if (!tr.before.eq(state.doc)) throw new StateError({ message: "Applying a mismatched transaction" })
  const newInstance = new EditorState<Sc, R, E>(state.config),
    fields = state.config.fields
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]!
    const value = field.apply.call(field.self, tr, state.slots[field.name], state, newInstance)
    newInstance.slots[field.name] = isHookEffect(value) ? yield value : value
  }
  return newInstance
}

// `reconfigure`: keep the fields both plugin sets share, init the new ones.
function* reconfigureSteps<Sc extends AnySchema, R, E>(
  state: EditorState<Sc, any, any>,
  config: { readonly plugins?: ReadonlyArray<AnyPlugin> | undefined }
): Steps<EditorState<Sc, R, E>> {
  const $config = new Configuration(state.schema, config.plugins)
  const instance = new EditorState<Sc, R, E>($config)
  for (const field of $config.fields) {
    instance.slots[field.name] = Object.prototype.hasOwnProperty.call(state.slots, field.name)
      ? state.slots[field.name]
      : yield field.init.call(field.self, config, instance)
  }
  return instance
}
