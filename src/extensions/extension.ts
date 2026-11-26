/**
 * Extensions: composable, strongly typed bundles of schema specs,
 * plugins, keymaps and commands.
 *
 * @since 0.1.0
 */
import type { NoKeys } from "../internal/types.ts"
import type * as Types from "effect/Types"
import * as Arr from "effect/Array"
import type * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Order from "effect/Order"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import { type Bindings, type BindingsError, type BindingsRequirements, keymap } from "../Keymap.ts"
import type { AnySchema, MarkSpec, MarkSpecs, NodeSpec, NodeSpecs } from "../Model.ts"
import type { AnyPlugin, Command, Plugin } from "../State.ts"

// -----------------------------------------------------------------------------
// Priority
// -----------------------------------------------------------------------------

/**
 * Extension priorities. Within a merged extension, facets with a higher
 * priority come first: their node and mark specs come earlier in the
 * schema (which matters for the default node of a group and for parse
 * rule precedence), their plugins and keymaps come earlier in the
 * plugin list (so their key bindings and props take precedence), and
 * their commands win over commands with the same name. Facets with the
 * same priority keep their declaration order.
 *
 * @since 0.1.0
 * @category models
 */
export const Priority = {
  lowest: 0,
  low: 1,
  default: 2,
  high: 3,
  highest: 4
} as const

/**
 * @since 0.1.0
 * @category models
 */
export type Priority = (typeof Priority)[keyof typeof Priority]

// -----------------------------------------------------------------------------
// Type-level description
// -----------------------------------------------------------------------------

/**
 * A command whose argument types depend on the final (merged) schema,
 * described as a type lambda: `this["Schema"]` is the editor's schema
 * and `this["Return"]` the type the call returns (an Effect for
 * `editor.commands`, the chain for `editor.chain()`).
 *
 * ```ts skip-type-checking
 * interface ToggleMark extends CommandSignature {
 *   readonly signature: <M extends MarkNames<this["Schema"]>>(mark: M) => this["Return"]
 * }
 * ```
 *
 * @since 0.1.0
 * @category type-level
 */
export interface CommandSignature {
  readonly Schema: unknown
  readonly Return: unknown
  readonly signature: (...args: any) => this["Return"]
}

/**
 * The type-level description of a command: its argument tuple, or a
 * `CommandSignature` for schema-dependent commands.
 *
 * @since 0.1.0
 * @category type-level
 */
export type CommandType = ReadonlyArray<any> | CommandSignature

/**
 * @since 0.1.0
 * @category type-level
 */
export interface CommandTypes {
  readonly [name: string]: CommandType
}

/**
 * What an extension contributes at the type level: node specs, mark
 * specs, commands (name to argument types), and the errors (`E`) and
 * requirements (`R`) of its plugins and commands.
 *
 * @since 0.1.0
 * @category type-level
 */
export interface ExtensionTypes {
  readonly nodes: NodeSpecs
  readonly marks: MarkSpecs
  readonly commands: CommandTypes
  readonly E: unknown
  readonly R: unknown
}

/**
 * The types of an extension that contributes nothing.
 *
 * @since 0.1.0
 * @category type-level
 */
export interface EmptyTypes {
  readonly nodes: NoKeys
  readonly marks: NoKeys
  readonly commands: NoKeys
  readonly E: never
  readonly R: never
}

type Cast<A, B> = A extends B ? A : never

type UnionToIntersection<U> = (U extends any ? (u: U) => void : never) extends (i: infer I) => void ? I : never

/**
 * Merge a union of extension types: node, mark and command records are
 * intersected, `E` and `R` are unions.
 *
 * @since 0.1.0
 * @category type-level
 */
export type MergeTypes<T extends ExtensionTypes> = {
  readonly nodes: Cast<Types.Simplify<UnionToIntersection<T["nodes"]>>, NodeSpecs>
  readonly marks: Cast<Types.Simplify<UnionToIntersection<T["marks"]>>, MarkSpecs>
  readonly commands: Cast<Types.Simplify<UnionToIntersection<T["commands"]>>, CommandTypes>
  readonly E: T["E"]
  readonly R: T["R"]
}

/**
 * The types of an extension.
 *
 * @since 0.1.0
 * @category type-level
 */
export type TypesOf<X> = X extends Extension<infer T> ? T : never

/**
 * The node specs contributed by an extension.
 *
 * @since 0.1.0
 * @category type-level
 */
export type ExtensionNodes<X> = TypesOf<X>["nodes"]

/**
 * The mark specs contributed by an extension.
 *
 * @since 0.1.0
 * @category type-level
 */
export type ExtensionMarks<X> = TypesOf<X>["marks"]

/**
 * The commands contributed by an extension.
 *
 * @since 0.1.0
 * @category type-level
 */
export type ExtensionCommands<X> = TypesOf<X>["commands"]

// -----------------------------------------------------------------------------
// Runtime representation
// -----------------------------------------------------------------------------

/**
 * Creates a command from its arguments.
 *
 * @since 0.1.0
 * @category models
 */
export type CommandCreator = (...args: any) => Command<any, any, any>

/**
 * @since 0.1.0
 * @category models
 */
export interface CommandCreators {
  readonly [name: string]: CommandCreator
}

/**
 * A plugin, a list of plugins, or a function creating them from the
 * editor's schema.
 *
 * @since 0.1.0
 * @category models
 */
export type PluginInput =
  | AnyPlugin
  | ReadonlyArray<AnyPlugin>
  | ((schema: AnySchema) => AnyPlugin | ReadonlyArray<AnyPlugin>)

/**
 * The contents of a single extension, as given to `defineExtension`.
 *
 * @since 0.1.0
 * @category models
 */
export interface ExtensionSpec {
  readonly nodes?: NodeSpecs | undefined
  readonly marks?: MarkSpecs | undefined
  readonly plugins?: ReadonlyArray<PluginInput> | undefined
  readonly keymap?: Bindings | undefined
  readonly commands?: CommandCreators | undefined
}

/**
 * @since 0.1.0
 * @category symbols
 */
export const ExtensionTypeId: unique symbol = Symbol.for("effect-richtext/extensions/Extension") as never

/**
 * @since 0.1.0
 * @category symbols
 */
export type ExtensionTypeId = typeof ExtensionTypeId

/**
 * An extension: a tree of facets (node and mark specs, plugins,
 * keymaps and commands), each with an optional priority. `T` records,
 * at the type level, what the extension contributes. Extensions are
 * immutable values; combine them with `union` and turn them into an
 * editor with `createEditor`.
 *
 * @since 0.1.0
 * @category models
 */
export class Extension<out T extends ExtensionTypes = EmptyTypes> {
  declare readonly [ExtensionTypeId]: { readonly _T: (_: never) => T }

  /** @internal */
  constructor(
    /** @internal */
    readonly spec: ExtensionSpec | undefined,
    /** @internal */
    readonly children: ReadonlyArray<AnyExtension>,
    /** @internal */
    readonly priority: Priority | undefined
  ) {}
}

/**
 * Any extension.
 *
 * @since 0.1.0
 * @category models
 */
export type AnyExtension = Extension<any>

/**
 * Whether a value is an `Extension`.
 *
 * @since 0.1.0
 * @category guards
 */
export const isExtension = (u: unknown): u is AnyExtension => u instanceof Extension

// -----------------------------------------------------------------------------
// Type extraction helpers
// -----------------------------------------------------------------------------

type PluginInputE<P> = P extends (...args: any) => infer X
  ? PluginInputE<X>
  : P extends ReadonlyArray<infer X>
    ? PluginInputE<X>
    : P extends Plugin<any, any, infer E, any>
      ? E
      : never

type PluginInputR<P> = P extends (...args: any) => infer X
  ? PluginInputR<X>
  : P extends ReadonlyArray<infer X>
    ? PluginInputR<X>
    : P extends Plugin<any, any, any, infer R>
      ? R
      : never

type CreatorE<C> = C extends (...args: any) => (...args: any) => Effect.Effect<any, infer E, any> ? E : never
type CreatorR<C> = C extends (...args: any) => (...args: any) => Effect.Effect<any, any, infer R> ? R : never

/**
 * The command types of a set of command creators: their argument
 * tuples.
 *
 * @since 0.1.0
 * @category type-level
 */
export type CommandArgsOf<C extends CommandCreators> = { readonly [K in keyof C]: Parameters<C[K]> }

/**
 * The errors of a set of command creators' commands.
 *
 * @since 0.1.0
 * @category type-level
 */
export type CommandsError<C extends CommandCreators> = { [K in keyof C]: CreatorE<C[K]> }[keyof C]

/**
 * The requirements of a set of command creators' commands.
 *
 * @since 0.1.0
 * @category type-level
 */
export type CommandsRequirements<C extends CommandCreators> = { [K in keyof C]: CreatorR<C[K]> }[keyof C]

/**
 * The extension types described by an `ExtensionSpec`.
 *
 * @since 0.1.0
 * @category type-level
 */
export interface SpecTypes<
  N extends NodeSpecs,
  M extends MarkSpecs,
  P extends ReadonlyArray<PluginInput>,
  B extends Bindings,
  C extends CommandCreators
> {
  readonly nodes: N
  readonly marks: M
  readonly commands: CommandArgsOf<C>
  readonly E: PluginInputE<P[number]> | BindingsError<B> | CommandsError<C>
  readonly R: PluginInputR<P[number]> | BindingsRequirements<B> | CommandsRequirements<C>
}

// -----------------------------------------------------------------------------
// Constructors
// -----------------------------------------------------------------------------

/**
 * Define an extension from node and mark specs, plugins, a keymap and
 * commands. Every field is optional; the types of all of them are
 * recorded in the extension's type.
 *
 * ```ts skip-type-checking
 * const bold = defineExtension({
 *   marks: { strong: { parseDOM: [{ tag: "strong" }], toDOM: () => ["strong", 0] } },
 *   commands: { toggleBold: () => (state, dispatch) => toggleMark(state.schema.marks.strong!)(state, dispatch) },
 *   keymap: { "Mod-b": (state, dispatch) => toggleMark(state.schema.marks.strong!)(state, dispatch) }
 * })
 * ```
 *
 * Throws a `KeymapError` when a key name in `keymap` is invalid.
 *
 * @since 0.1.0
 * @category constructors
 */
export const defineExtension = <
  const N extends NodeSpecs = NoKeys,
  const M extends MarkSpecs = NoKeys,
  const P extends ReadonlyArray<PluginInput> = readonly [],
  const B extends Bindings = NoKeys,
  const C extends CommandCreators = NoKeys
>(spec: {
  readonly nodes?: N | undefined
  readonly marks?: M | undefined
  readonly plugins?: P | undefined
  readonly keymap?: B | undefined
  readonly commands?: C | undefined
}): Extension<SpecTypes<N, M, P, B, C>> => {
  const plugins: Array<PluginInput> = spec.plugins ? [...spec.plugins] : []
  // Keymaps become ordinary plugins (built now, so that invalid key
  // names are reported where they are defined).
  if (spec.keymap) plugins.push(keymap(spec.keymap))
  return new Extension(
    {
      nodes: spec.nodes,
      marks: spec.marks,
      plugins,
      commands: spec.commands
    },
    [],
    undefined
  )
}

/**
 * Merge extensions. The result contributes everything its parts
 * contribute: node, mark and command types are intersected, `E` and `R`
 * are unions. At runtime facets are ordered by priority, then by
 * declaration order (depth first); including the same extension value
 * more than once only uses its first occurrence.
 *
 * @since 0.1.0
 * @category combinators
 */
export const union = <const Exts extends ReadonlyArray<AnyExtension>>(
  ...extensions: Exts
): Extension<MergeTypes<TypesOf<Exts[number]>>> => new Extension(undefined, extensions, undefined)

/**
 * Give an extension (and every part of it that doesn't set its own
 * priority) a priority.
 *
 * @since 0.1.0
 * @category combinators
 */
export const withPriority = <T extends ExtensionTypes>(extension: Extension<T>, priority: Priority): Extension<T> =>
  new Extension(undefined, [extension], priority)

/**
 * Define an extension adding a single node spec.
 *
 * @since 0.1.0
 * @category constructors
 */
export const defineNodeSpec = <const Name extends string, const Spec extends NodeSpec>(
  name: Name,
  spec: Spec
): Extension<SpecTypes<{ readonly [K in Name]: Spec }, NoKeys, readonly [], NoKeys, NoKeys>> =>
  new Extension({ nodes: { [name]: spec } }, [], undefined)

/**
 * Define an extension adding a single mark spec.
 *
 * @since 0.1.0
 * @category constructors
 */
export const defineMarkSpec = <const Name extends string, const Spec extends MarkSpec>(
  name: Name,
  spec: Spec
): Extension<SpecTypes<NoKeys, { readonly [K in Name]: Spec }, readonly [], NoKeys, NoKeys>> =>
  new Extension({ marks: { [name]: spec } }, [], undefined)

/**
 * Define an extension adding plugins: a plugin, an array of plugins, or
 * a function creating them from the editor's schema.
 *
 * @since 0.1.0
 * @category constructors
 */
export const definePlugin = <const P extends PluginInput>(
  plugin: P
): Extension<SpecTypes<NoKeys, NoKeys, readonly [P], NoKeys, NoKeys>> =>
  new Extension({ plugins: [plugin] }, [], undefined)

/**
 * Define an extension adding a keymap (see `keymap`). Throws a
 * `KeymapError` when a key name is invalid or bound twice.
 *
 * @since 0.1.0
 * @category constructors
 */
export const defineKeymap = <const B extends Bindings>(
  bindings: B
): Extension<SpecTypes<NoKeys, NoKeys, readonly [], B, NoKeys>> => defineExtension({ keymap: bindings })

/**
 * Define an extension adding commands. Each command is given as a
 * function from the command's arguments to a `Command`; the argument
 * types become part of the editor's `commands`, `can()` and `chain()`
 * APIs.
 *
 * ```ts skip-type-checking
 * const ext = defineCommands({
 *   insertHello: (times: number) => (state, dispatch) => ...
 * })
 * ```
 *
 * For commands whose argument types depend on the final schema, declare
 * a `CommandSignature` and cast the extension (see `CommandsExtension`).
 *
 * @since 0.1.0
 * @category constructors
 */
export const defineCommands = <const C extends CommandCreators>(
  commands: C
): Extension<SpecTypes<NoKeys, NoKeys, readonly [], NoKeys, C>> => new Extension({ commands }, [], undefined)

/**
 * The type of an extension that only contributes commands, described
 * by command types (argument tuples or `CommandSignature`s).
 *
 * @since 0.1.0
 * @category type-level
 */
export type CommandsExtension<C extends CommandTypes, E = never, R = never> = Extension<{
  readonly nodes: NoKeys
  readonly marks: NoKeys
  readonly commands: C
  readonly E: E
  readonly R: R
}>

// -----------------------------------------------------------------------------
// Flattening
// -----------------------------------------------------------------------------

/**
 * The facets of an extension, flattened and sorted by priority.
 *
 * @internal
 */
export interface Flattened {
  readonly nodes: Record<string, NodeSpec>
  readonly marks: Record<string, MarkSpec>
  readonly plugins: ReadonlyArray<PluginInput>
  readonly commands: Record<string, CommandCreator>
}

const mergeInto = <S extends NodeSpec | MarkSpec>(specs: Record<string, Option.Option<S>>, name: string, over: S) => {
  specs[name] = Option.some(mergeSpec(specs[name] ?? Option.none(), over))
}

const mergeSpec = <S extends NodeSpec | MarkSpec>(prev: Option.Option<S>, over: S): S => {
  if (Option.isNone(prev)) return over
  const base = prev.value
  const attrs = base.attrs || over.attrs ? { ...base.attrs, ...over.attrs } : undefined
  const merged = { ...base, ...over }
  return attrs ? { ...merged, attrs } : merged
}

interface Facet {
  readonly spec: ExtensionSpec
  readonly priority: number
}

// Highest priority first.
const byPriorityDesc: Order.Order<Facet> = (a, b) => Order.Number(b.priority, a.priority)

/**
 * Flatten an extension tree. Facets are sorted by priority (highest
 * first), keeping declaration order for equal priorities. Node and mark
 * specs with the same name are shallow-merged (attributes merged), with
 * the higher-priority spec winning, at the position of the first
 * occurrence; for commands with the same name the higher-priority one
 * wins.
 *
 * @internal
 */
export const flatten = (extension: AnyExtension): Flattened => {
  const collected: Array<Facet> = []
  const seen = new WeakSet<AnyExtension>()
  const visit = (ext: AnyExtension, inherited: number) => {
    if (seen.has(ext)) return
    seen.add(ext)
    const priority = ext.priority ?? inherited
    if (ext.spec) collected.push({ spec: ext.spec, priority })
    for (const child of ext.children) visit(child, priority)
  }
  visit(extension, Priority.default)
  // `Arr.sort` is stable, so equal priorities keep declaration order.
  const facets = Arr.sort(collected, byPriorityDesc)

  const nodes: Record<string, Option.Option<NodeSpec>> = {}
  const marks: Record<string, Option.Option<MarkSpec>> = {}
  const plugins: Array<PluginInput> = []
  const commands: Record<string, CommandCreator> = {}
  // Iterate from lowest to highest priority when merging specs, so the
  // higher-priority spec wins, but keep the key order of the sorted
  // (highest first) facets.
  for (const { spec } of facets) {
    for (const name in spec.nodes) if (!(name in nodes)) nodes[name] = Option.none()
    for (const name in spec.marks) if (!(name in marks)) marks[name] = Option.none()
    if (spec.plugins) plugins.push(...spec.plugins)
    for (const [name, command] of Rec.toEntries(spec.commands ?? {})) if (!(name in commands)) commands[name] = command
  }
  for (let i = facets.length - 1; i >= 0; i--) {
    const spec = facets[i].spec
    for (const name in spec.nodes) mergeInto(nodes, name, spec.nodes[name])
    for (const name in spec.marks) mergeInto(marks, name, spec.marks[name])
  }
  return { nodes: Rec.getSomes(nodes), marks: Rec.getSomes(marks), plugins, commands }
}

/**
 * Resolve plugin inputs against a schema.
 *
 * @internal
 */
export const resolvePlugins = (inputs: ReadonlyArray<PluginInput>, schema: AnySchema): Array<AnyPlugin> => {
  const result: Array<AnyPlugin> = []
  const add = (input: AnyPlugin | ReadonlyArray<AnyPlugin>) => {
    if (Array.isArray(input)) result.push(...input)
    else result.push(input as AnyPlugin)
  }
  for (const input of inputs) add(Predicate.isFunction(input) ? input(schema) : input)
  return result
}
