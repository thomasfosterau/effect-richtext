/**
 * Plugins, plugin keys and state fields.
 *
 * @since 0.1.0
 */
import type * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import type { AnySchema } from "../model.ts"
import type { EditorProps, EditorView } from "../view/view.ts"
import type { EditorState, EditorStateConfig } from "./state.ts"
import type { Transaction } from "./transaction.ts"

/**
 * A value, or an Effect producing it. Plugin hooks may return either:
 * plain values keep simple plugins simple, while Effects let plugins use
 * services (reflected in the plugin's `R` type) and fail with typed
 * errors (`E`).
 *
 * Note that a hook result is treated as an Effect whenever
 * `Effect.isEffect` is true for it, so a plugin whose state is itself
 * an Effect must wrap it in `Effect.succeed`.
 *
 * @since 0.1.0
 * @category models
 */
export type MaybeEffect<A, E = never, R = never> = A | Effect.Effect<A, E, R>

/**
 * The editor view type, as passed to commands (which may be called
 * without a view, hence `undefined`).
 *
 * @since 0.1.0
 * @category models
 */
export type EditorViewLike = EditorView<any, any, any> | undefined

/**
 * The props a plugin adds to the editor view: the view's `EditorProps`.
 * Function-valued props are bound to the plugin instance.
 *
 * @since 0.1.0
 * @category models
 */
export type PluginProps<Sc extends AnySchema = AnySchema, E = never, R = never> = EditorProps<
  Sc,
  R,
  E,
  Plugin<any, Sc, never, never>
>

/**
 * A stateful object that can be installed in an editor by a plugin's
 * `view` hook.
 *
 * @since 0.1.0
 * @category models
 */
export interface PluginView<Sc extends AnySchema = AnySchema> {
  /** Called whenever the view's state is updated. */
  readonly update?: ((view: EditorView<Sc, any, any>, prevState: EditorState<Sc, any, any>) => void) | undefined
  /** Called when the view is destroyed or receives a state with different plugins. */
  readonly destroy?: (() => void) | undefined
}

/**
 * A plugin spec may provide a state field (under its `state` property)
 * of this type, which describes the state it wants to keep. Functions
 * provided here are always called with the plugin instance as their
 * `this` binding, and may return either a plain value or an Effect.
 *
 * @since 0.1.0
 * @category models
 */
export interface StateField<PState, Sc extends AnySchema = AnySchema, E = never, R = never> {
  /**
   * Initialize the value of the field. `config` will be the object
   * passed to `EditorState.create`. Note that `instance` is a
   * half-initialized state instance, and will not have values for
   * plugin fields initialized after this one.
   */
  readonly init: (config: EditorStateConfig<Sc>, instance: EditorState<Sc, any, any>) => MaybeEffect<PState, E, R>

  /**
   * Apply the given transaction to this state field, producing a new
   * field value. Note that the `newState` argument is again a partially
   * constructed state does not yet contain the state from plugins coming
   * after this one.
   */
  readonly apply: (
    tr: Transaction<Sc>,
    value: PState,
    oldState: EditorState<Sc, any, any>,
    newState: EditorState<Sc, any, any>
  ) => MaybeEffect<PState, E, R>

  /**
   * Convert this field to JSON. Optional, can be left off to disable
   * JSON serialization for the field.
   */
  readonly toJSON?: ((value: PState) => unknown) | undefined

  /**
   * Deserialize the JSON representation of this field. Note that the
   * `state` argument is again a half-initialized state.
   */
  readonly fromJSON?:
    | ((config: EditorStateConfig<Sc>, value: unknown, state: EditorState<Sc, any, any>) => MaybeEffect<PState, E, R>)
    | undefined
}

/**
 * This is the type passed to the `Plugin` constructor. It provides a
 * definition for a plugin.
 *
 * The hooks that run while creating or updating states (`state.init`,
 * `state.apply`, `state.fromJSON`, `filterTransaction` and
 * `appendTransaction`) may return Effects; their error and requirement
 * types become the plugin's `E` and `R`.
 *
 * @since 0.1.0
 * @category models
 */
export interface PluginSpec<PState = any, Sc extends AnySchema = AnySchema, E = never, R = never> {
  /**
   * The view props added by this plugin. Props that are functions will
   * be bound to have the plugin instance as their `this` binding.
   */
  readonly props?: PluginProps<Sc, E, R> | undefined

  /**
   * Allows a plugin to define a state field, an extra slot in the state
   * object in which it can keep its own data.
   */
  readonly state?: StateField<PState, Sc, E, R> | undefined

  /**
   * Can be used to make this a keyed plugin. You can have only one
   * plugin with a given key in a given state, but it is possible to
   * access the plugin's configuration and state through the key,
   * without having access to the plugin instance object.
   */
  readonly key?: PluginKey<PState> | undefined

  /**
   * When the plugin needs to interact with the editor view, or set
   * something up in the DOM, use this field. The function will be
   * called when the plugin's state is associated with an editor view.
   */
  readonly view?: ((view: EditorView<Sc, any, any>) => PluginView<Sc>) | undefined

  /**
   * When present, this will be called before a transaction is applied
   * by the state, allowing the plugin to cancel it (by returning
   * false).
   */
  readonly filterTransaction?:
    | ((tr: Transaction<Sc>, state: EditorState<Sc, any, any>) => MaybeEffect<boolean, E, R>)
    | undefined

  /**
   * Allows the plugin to append another transaction to be applied after
   * the given array of transactions. When another plugin appends a
   * transaction after this was called, it is called again with the new
   * state and new transactions—but only the new transactions, i.e. it
   * won't be passed transactions that it already saw.
   */
  readonly appendTransaction?:
    | ((
      transactions: ReadonlyArray<Transaction<Sc>>,
      oldState: EditorState<Sc, any, any>,
      newState: EditorState<Sc, any, any>
    ) => MaybeEffect<Transaction<Sc> | null | undefined | void, E, R>)
    | undefined

  /**
   * Additional properties are allowed on plugin specs, which can be
   * read via `Plugin.spec`.
   */
  readonly [key: string]: unknown
}

function bindProps(
  obj: { readonly [prop: string]: unknown },
  self: unknown,
  target: Record<string, unknown>
): Record<string, unknown> {
  for (const prop in obj) {
    let val = obj[prop]
    if (val instanceof Function) val = val.bind(self)
    else if (prop === "handleDOMEvents") val = bindProps(val as { readonly [prop: string]: unknown }, self, {})
    target[prop] = val
  }
  return target
}

const keys: Record<string, number> = Object.create(null)

function createKey(name: string): string {
  if (name in keys) return name + "$" + ++keys[name]!
  keys[name] = 0
  return name + "$"
}

/**
 * @since 0.1.0
 * @category symbols
 */
export const PluginTypeId: unique symbol = Symbol.for("effect-richtext/state/Plugin") as never

/**
 * @since 0.1.0
 * @category symbols
 */
export type PluginTypeId = typeof PluginTypeId

/**
 * Plugins bundle functionality that can be added to an editor. They are
 * part of the editor state and may influence that state and the view
 * that contains it.
 *
 * The type parameters are the plugin's state type, the schema it works
 * with, and the errors (`E`) and requirements (`R`) of its effectful
 * hooks, which are inferred from the spec:
 *
 * ```ts
 * const counter = new Plugin({
 *   state: {
 *     init: () => 0,
 *     apply: (_tr, n) => Effect.map(Clock.currentTimeMillis, () => n + 1)
 *   }
 * }) // Plugin<number, AnySchema, never, never>
 * ```
 *
 * @since 0.1.0
 * @category models
 */
export class Plugin<PState = any, Sc extends AnySchema = AnySchema, E = never, R = never> {
  declare readonly [PluginTypeId]: {
    readonly _PState: (_: never) => PState
    readonly _E: (_: never) => E
    readonly _R: (_: never) => R
  }

  /** The props exported by this plugin. */
  readonly props: PluginProps<Sc, E, R> = {}

  /** @internal */
  readonly key: string

  /** Create a plugin. */
  constructor(
    /** The plugin's spec object. */
    readonly spec: PluginSpec<PState, Sc, E, R>
  ) {
    if (spec.props) bindProps(spec.props as any, this, this.props as Record<string, unknown>)
    this.key = spec.key ? spec.key.key : createKey("plugin")
  }

  /** Extract the plugin's state field from an editor state. */
  getState(state: EditorState<any, any, any>): Option.Option<PState> {
    return getField(state, this.key)
  }
}

/**
 * Any plugin.
 *
 * @since 0.1.0
 * @category models
 */
export type AnyPlugin = Plugin<any, any, any, any>

/**
 * The union of the error types of the given plugins.
 *
 * @since 0.1.0
 * @category type-level
 */
export type PluginErrors<P extends ReadonlyArray<AnyPlugin>> = P[number] extends infer X ?
  X extends Plugin<any, any, infer E, any> ? E : never
  : never

/**
 * The union of the requirements of the given plugins.
 *
 * @since 0.1.0
 * @category type-level
 */
export type PluginRequirements<P extends ReadonlyArray<AnyPlugin>> = P[number] extends infer X ?
  X extends Plugin<any, any, any, infer R> ? R : never
  : never

/** @internal */
export const getField = <A>(state: EditorState<any, any, any>, key: string): Option.Option<A> =>
  Object.prototype.hasOwnProperty.call(state.slots, key) ? Option.some(state.slots[key] as A) : Option.none()

/**
 * A key is used to tag plugins in a way that makes it possible to find
 * them, given an editor state. Assigning a key does mean only one plugin
 * of that type can be active in a state.
 *
 * @since 0.1.0
 * @category models
 */
export class PluginKey<PState = any> {
  /** @internal */
  readonly key: string

  /** Create a plugin key. */
  constructor(name = "key") {
    this.key = createKey(name)
  }

  /** Get the active plugin with this key, if any, from an editor state. */
  get(state: EditorState<any, any, any>): Option.Option<Plugin<PState, any, any, any>> {
    return Option.fromUndefinedOr(state.config.pluginsByKey[this.key])
  }

  /** Get the plugin's state from an editor state. */
  getState(state: EditorState<any, any, any>): Option.Option<PState> {
    return getField(state, this.key)
  }
}
