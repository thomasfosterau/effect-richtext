/**
 * Document schemas.
 *
 * A schema describes the node and mark types that may appear in a
 * document. Schemas are strongly typed: the names of node and mark
 * types, their attributes (described with Effect `Schema`s), and the
 * child types each node type allows (from its [content
 * expression](./content.ts)) are all available at the type level.
 *
 * ```ts skip-type-checking
 * import { Schema } from "effect"
 * import { Content, DocSchema } from "effect-richtext/model"
 *
 * const schema = DocSchema.make({
 *   nodes: {
 *     doc: { content: Content.oneOrMore("block") },
 *     paragraph: { group: "block", content: Content.zeroOrMore("text") },
 *     heading: {
 *       group: "block",
 *       content: Content.zeroOrMore("text"),
 *       attrs: { level: { schema: Schema.Literals([1, 2, 3]), default: 1 } }
 *     },
 *     text: {}
 *   },
 *   marks: { strong: {} }
 * })
 * ```
 *
 * @since 0.1.0
 */
import type * as Effect from "effect/Effect"
import * as Arr from "effect/Array"
import * as Rec from "effect/Record"
import * as Option from "effect/Option"
import * as S from "effect/Schema"
import * as SchemaAST from "effect/SchemaAST"
import { attempt } from "../internal/attempt.ts"
import { showJson } from "../internal/json.ts"
import { type ContentInput, ContentMatch, type SpecRefs } from "./content.ts"
import type { DOMOutputSpec, ParseRule, TagParseRule } from "./dom.ts"
import {
  AttributeError,
  ContentError,
  isModelError,
  type JSONError,
  type ModelError,
  SchemaDefinitionError
} from "./errors.ts"
import { Fragment } from "./fragment.ts"
import * as json from "./json.ts"
import { Mark } from "./mark.ts"
import { Node, TextNode } from "./node.ts"

// -----------------------------------------------------------------------------
// Spec types
// -----------------------------------------------------------------------------

/**
 * Describes a single attribute of a node or mark type.
 *
 * - `schema` is an Effect `Schema` used to validate the value and to
 *   decode/encode it from/to JSON. It also gives the attribute its
 *   static type.
 * - `default` is used when no value is provided. Attributes without a
 *   default are required.
 * - `validate` is accepted for ProseMirror compatibility: either a
 *   `|`-separated list of primitive type names or a function that
 *   throws on invalid values.
 *
 * Supplied values are validated whenever a node or mark is created (as
 * prosemirror-model does since 1.25.12), and again by `Node.check`;
 * defaults are trusted. A `schema` or a type-name `validate` rejects a
 * value with an `AttributeError`; a `validate` function's own exception
 * propagates as thrown (a defect in the Effect API).
 *
 * @since 0.1.0
 * @category models
 */
export interface AttributeSpec<A = any, I = any> {
  readonly schema?: S.Codec<A, I> | undefined
  readonly default?: A
  readonly validate?: string | ((value: unknown) => void) | undefined
}

/**
 * An attribute is either described by an `AttributeSpec` or, as a
 * shorthand for a required attribute, directly by an Effect `Schema`.
 *
 * @since 0.1.0
 * @category models
 */
export type AttributeDefinition = S.Top | AttributeSpec

/**
 * @since 0.1.0
 * @category models
 */
export interface AttributeDefinitions {
  readonly [name: string]: AttributeDefinition
}

/**
 * A description of a node type, used when defining a schema.
 *
 * @since 0.1.0
 * @category models
 */
export interface NodeSpec {
  /**
   * The content expression for this node. When not given, the node
   * does not allow any content. Prefer `Content` combinators, which
   * keep the allowed child types at the type level; a plain string is
   * read as ProseMirror content syntax (`"paragraph block*"`), and is
   * only precisely typed when it is a single bare name.
   */
  readonly content?: ContentInput<string> | undefined
  /**
   * The marks that are allowed inside of this node. May be a
   * space-separated string referring to mark names or groups, `"_"` to
   * explicitly allow all marks, or `""` to disallow marks. When not
   * given, nodes with inline content default to allowing all marks,
   * other nodes default to not allowing marks.
   */
  readonly marks?: string | undefined
  /** The group or space-separated groups to which this node belongs. */
  readonly group?: string | undefined
  /** Should be set to true for inline nodes. (Implied for text nodes.) */
  readonly inline?: boolean | undefined
  /**
   * Can be set to true to indicate that, though this isn't a leaf node,
   * it doesn't have directly editable content and should be treated as
   * a single unit in the view.
   */
  readonly atom?: boolean | undefined
  /** The attributes that nodes of this type get. */
  readonly attrs?: AttributeDefinitions | undefined
  /** Whether nodes of this type can be selected as a node selection. */
  readonly selectable?: boolean | undefined
  /** Whether nodes of this type can be dragged without being selected. */
  readonly draggable?: boolean | undefined
  /** Indicates that this node contains code. */
  readonly code?: boolean | undefined
  /** Controls the way whitespace in this node is parsed. */
  readonly whitespace?: "pre" | "normal" | undefined
  /** Whether this node is considered an important parent during replace operations. */
  readonly definingAsContext?: boolean | undefined
  /** Whether defining parents of inserted content are preserved. */
  readonly definingForContent?: boolean | undefined
  /** Enables both `definingAsContext` and `definingForContent`. */
  readonly defining?: boolean | undefined
  /** Whether the sides of nodes of this type count as editing boundaries. */
  readonly isolating?: boolean | undefined
  /** Defines the default way a node of this type should be serialized to DOM/HTML. */
  readonly toDOM?: ((node: Node<any, any>) => DOMOutputSpec) | undefined
  /** DOM parser rules for this node type. */
  readonly parseDOM?: ReadonlyArray<TagParseRule> | undefined
  /** Defines the way a node of this type is rendered for debugging. */
  readonly toDebugString?: ((node: Node<any, any>) => string) | undefined
  /** Defines the way a leaf node of this type is serialized to a string. */
  readonly leafText?: ((node: Node<any, any>) => string) | undefined
  /** Marks this (inline leaf) node as the schema's linebreak equivalent. */
  readonly linebreakReplacement?: boolean | undefined
  /** Node specs may include arbitrary extra properties. */
  readonly [key: string]: unknown
}

/**
 * Used to define marks when creating a schema.
 *
 * @since 0.1.0
 * @category models
 */
export interface MarkSpec {
  /** The attributes that marks of this type get. */
  readonly attrs?: AttributeDefinitions | undefined
  /** Whether this mark should be active when the cursor is positioned at its end. Defaults to true. */
  readonly inclusive?: boolean | undefined
  /** Space-separated mark names or groups this mark excludes. */
  readonly excludes?: string | undefined
  /** The group or space-separated groups to which this mark belongs. */
  readonly group?: string | undefined
  /** Whether marks of this type can span multiple adjacent nodes when serialized. Defaults to true. */
  readonly spanning?: boolean | undefined
  /** Marks the content of this span as being code. */
  readonly code?: boolean | undefined
  /** Defines the default way marks of this type should be serialized to DOM/HTML. */
  readonly toDOM?: ((mark: Mark<any, any>, inline: boolean) => DOMOutputSpec) | undefined
  /** DOM parser rules for this mark type. */
  readonly parseDOM?: ReadonlyArray<ParseRule> | undefined
  /** Mark specs may include arbitrary extra properties. */
  readonly [key: string]: unknown
}

/**
 * @since 0.1.0
 * @category models
 */
export interface NodeSpecs {
  readonly [name: string]: NodeSpec
}

/**
 * @since 0.1.0
 * @category models
 */
export interface MarkSpecs {
  readonly [name: string]: MarkSpec
}

/**
 * An object describing a schema, as passed to `DocSchema.make`.
 *
 * The order of `nodes` and `marks` is significant: it determines which
 * parse rules take precedence by default, which nodes come first in a
 * given group, and the order of marks in mark sets.
 *
 * @since 0.1.0
 * @category models
 */
export interface SchemaSpec<
  N extends NodeSpecs = NodeSpecs,
  M extends MarkSpecs = MarkSpecs,
  Top extends string = string
> {
  readonly nodes: N
  readonly marks?: M | undefined
  /** The name of the default top-level node. Defaults to `"doc"`. */
  readonly topNode?: Top | undefined
}

// -----------------------------------------------------------------------------
// Type-level helpers
// -----------------------------------------------------------------------------

/**
 * A schema of unknown shape.
 *
 * @since 0.1.0
 * @category type-level
 */
export type AnySchema = DocSchema<any, any>

/**
 * The node specs of a schema.
 *
 * @since 0.1.0
 * @category type-level
 */
export type NodeSpecsOf<Sc> = Sc extends DocSchema<infer N, any> ? N : never

/**
 * The mark specs of a schema.
 *
 * @since 0.1.0
 * @category type-level
 */
export type MarkSpecsOf<Sc> = Sc extends DocSchema<any, infer M> ? M : never

/**
 * The names of a schema's node types.
 *
 * @since 0.1.0
 * @category type-level
 */
export type NodeNames<Sc> = keyof NodeSpecsOf<Sc> & string

/**
 * The names of a schema's mark types.
 *
 * @since 0.1.0
 * @category type-level
 */
export type MarkNames<Sc> = keyof MarkSpecsOf<Sc> & string

/**
 * The spec of node type `N` in schema `Sc`.
 *
 * @since 0.1.0
 * @category type-level
 */
export type NodeSpecOf<Sc, N extends string> =
  NodeSpecsOf<Sc> extends infer Specs ? (N extends keyof Specs ? Specs[N] : NodeSpec) : NodeSpec

/**
 * The spec of mark type `M` in schema `Sc`.
 *
 * @since 0.1.0
 * @category type-level
 */
export type MarkSpecOf<Sc, M extends string> =
  MarkSpecsOf<Sc> extends infer Specs ? (M extends keyof Specs ? Specs[M] : MarkSpec) : MarkSpec

type Split<Str extends string> = string extends Str
  ? string
  : Str extends `${infer H} ${infer T}`
    ? (H extends "" ? never : H) | Split<T>
    : Str extends ""
      ? never
      : Str

/**
 * The groups a spec belongs to.
 *
 * @since 0.1.0
 * @category type-level
 */
export type GroupsOf<Spec> = Spec extends { readonly group: infer G extends string } ? Split<G> : never

/**
 * The names (of nodes or groups) referenced in a spec's content
 * expression.
 *
 * @since 0.1.0
 * @category type-level
 */
export type ContentRefsOf<Spec> = Spec extends { readonly content: infer C } ? SpecRefs<C> : never

/**
 * The names of the node types that can appear as children of node type
 * `N` in schema `Sc`.
 *
 * @since 0.1.0
 * @category type-level
 */
export type ChildNames<Sc, N extends string> =
  string extends NodeNames<Sc>
    ? string
    : string extends N
      ? NodeNames<Sc>
      : ResolveRefs<Sc, ContentRefsOf<NodeSpecOf<Sc, N>>>

/**
 * Resolve a set of node/group names to the node names they denote.
 *
 * @since 0.1.0
 * @category type-level
 */
export type ResolveRefs<Sc, R extends string> = string extends R
  ? NodeNames<Sc>
  : {
      [C in NodeNames<Sc>]: C extends R ? C : [GroupsOf<NodeSpecOf<Sc, C>> & R] extends [never] ? never : C
    }[NodeNames<Sc>]

/**
 * The names of node types in schema `Sc` that belong to group `G`.
 *
 * @since 0.1.0
 * @category type-level
 */
export type NodesInGroup<Sc, G extends string> = ResolveRefs<Sc, G>

/**
 * The names of all mark types in group `G` of schema `Sc`.
 *
 * @since 0.1.0
 * @category type-level
 */
export type MarksInGroup<Sc, G extends string> =
  string extends MarkNames<Sc>
    ? string
    : {
        [C in MarkNames<Sc>]: C extends G ? C : [GroupsOf<MarkSpecOf<Sc, C>> & G] extends [never] ? never : C
      }[MarkNames<Sc>]

type Widen<A> = A extends string
  ? string
  : A extends number
    ? number
    : A extends boolean
      ? boolean
      : A extends null | undefined
        ? unknown
        : A

// The value types a `validate` type name admits: the names
// `typeof` returns, plus "null" (see `validateType`).
interface ValidateTypeNames {
  readonly string: string
  readonly number: number
  readonly boolean: boolean
  readonly bigint: bigint
  readonly symbol: symbol
  readonly undefined: undefined
  readonly object: object
  readonly function: (...args: ReadonlyArray<never>) => void
  readonly null: null
}

type SplitBar<V extends string> = V extends `${infer H}|${infer T}` ? H | SplitBar<T> : V

// An unknown type name admits nothing (`never`), as `validateType` rejects
// every value for it.
type ValidateType<V extends string> = string extends V
  ? unknown
  : SplitBar<V> extends infer K
    ? K extends keyof ValidateTypeNames
      ? ValidateTypeNames[K]
      : never
    : never

/**
 * The value type of an attribute definition: its `schema`'s type; else
 * the types its `validate` type names admit (`"string|null"` is
 * `string | null`); else the widened type of its `default`. An attribute
 * with none of these (a ProseMirror-style `{ default: null }`, or a
 * `validate` function) is `unknown`: nothing says what it holds.
 *
 * @since 0.1.0
 * @category type-level
 */
export type AttributeType<D> = D extends S.Top
  ? D["Type"]
  : D extends { readonly schema: infer Sc extends S.Top }
    ? Sc["Type"]
    : D extends { readonly validate: infer V extends string }
      ? ValidateType<V>
      : D extends { readonly default: infer A }
        ? Widen<A>
        : unknown

type AttrDefsOf<Spec> = Spec extends { readonly attrs: infer A extends AttributeDefinitions } ? A : {}

/**
 * The (complete) attributes object for a node or mark spec.
 *
 * @since 0.1.0
 * @category type-level
 */
export type AttrsOfSpec<Spec> = [Spec] extends [never]
  ? Attrs
  : string extends keyof AttrDefsOf<Spec>
    ? Attrs
    : { readonly [K in keyof AttrDefsOf<Spec>]: AttributeType<AttrDefsOf<Spec>[K]> }

type OptionalAttrKeys<D> = { [K in keyof D]: D[K] extends { readonly default?: any } ? K : never }[keyof D]

/**
 * The attributes accepted when creating a node or mark from a spec:
 * attributes with defaults may be omitted.
 *
 * @since 0.1.0
 * @category type-level
 */
export type AttrsInputOfSpec<Spec> = [Spec] extends [never]
  ? Attrs
  : string extends keyof AttrDefsOf<Spec>
    ? Attrs
    : Simplify<
        {
          readonly [K in Exclude<keyof AttrDefsOf<Spec>, OptionalAttrKeys<AttrDefsOf<Spec>>>]: AttributeType<
            AttrDefsOf<Spec>[K]
          >
        } & { readonly [K in OptionalAttrKeys<AttrDefsOf<Spec>>]?: AttributeType<AttrDefsOf<Spec>[K]> }
      >

type Simplify<A> = { [K in keyof A]: A[K] } & {}

/**
 * The attributes of node type `N` in schema `Sc`.
 *
 * @since 0.1.0
 * @category type-level
 */
export type NodeAttrs<Sc, N extends string> =
  string extends NodeNames<Sc> ? Attrs : N extends any ? AttrsOfSpec<NodeSpecOf<Sc, N>> : never

/**
 * The attributes accepted when creating a node of type `N`.
 *
 * @since 0.1.0
 * @category type-level
 */
export type NodeAttrsInput<Sc, N extends string> =
  string extends NodeNames<Sc> ? Attrs : AttrsInputOfSpec<NodeSpecOf<Sc, N>>

/**
 * The attributes of mark type `M` in schema `Sc`.
 *
 * @since 0.1.0
 * @category type-level
 */
export type MarkAttrs<Sc, M extends string> =
  string extends MarkNames<Sc> ? Attrs : M extends any ? AttrsOfSpec<MarkSpecOf<Sc, M>> : never

/**
 * The attributes accepted when creating a mark of type `M`.
 *
 * @since 0.1.0
 * @category type-level
 */
export type MarkAttrsInput<Sc, M extends string> =
  string extends MarkNames<Sc> ? Attrs : AttrsInputOfSpec<MarkSpecOf<Sc, M>>

/**
 * True when all attributes of the spec have defaults (or there are
 * none), meaning the attrs argument can be omitted.
 *
 * @since 0.1.0
 * @category type-level
 */
export type AttrsOptional<Spec> = {} extends AttrsInputOfSpec<Spec> ? true : false

// -----------------------------------------------------------------------------
// Spec checks
// -----------------------------------------------------------------------------

// The groups the specs in `Specs` declare.
type GroupNames<Specs> = { [K in keyof Specs]: GroupsOf<Specs[K]> }[keyof Specs]

// The references in `Refs` that `Known` does not cover; none when the
// references are not known statically (a ProseMirror content string, an
// untyped spec).
type UnknownRefs<Refs, Known> = string extends Refs ? never : Exclude<Refs, Known>

// The names a space-separated mark expression under `Key` refers to.
type MarkExprRefs<Spec, Key extends string> = Spec extends { readonly [P in Key]: infer E extends string }
  ? Split<E>
  : never

// A required property named by `Message` when `Bad` is not empty, so the
// compiler reports "Property '<Message>' is missing" on the offending spec;
// nothing otherwise.
type Fail<Bad, Message extends string> = [Bad] extends [never] ? unknown : { readonly [P in Message]: true }

// The attributes whose `default` is not a value of their `schema`.
type BadDefaults<Defs> = {
  [K in keyof Defs]: Defs[K] extends { readonly schema: infer Sch extends S.Top; readonly default: infer D }
    ? [D] extends [Sch["Type"]]
      ? never
      : K
    : never
}[keyof Defs] &
  string

type BadDefaultsOf<Spec> = BadDefaults<AttrDefsOf<Spec>>

// The type names in `validate` strings that `validateType` does not know.
type BadValidateNames<Defs> = {
  [K in keyof Defs]: Defs[K] extends { readonly validate: infer V extends string }
    ? string extends V
      ? never
      : Exclude<SplitBar<V>, keyof ValidateTypeNames>
    : never
}[keyof Defs] &
  string

type BadValidateNamesOf<Spec> = BadValidateNames<AttrDefsOf<Spec>>

type MarkRefNames<M> = (keyof M & string) | GroupNames<M> | "_"

type UnknownContent<N, K extends keyof N> = UnknownRefs<ContentRefsOf<N[K]>, (keyof N & string) | GroupNames<N>> &
  string

type UnknownMarks<M, Spec, Key extends string> = UnknownRefs<MarkExprRefs<Spec, Key>, MarkRefNames<M>> & string

type NodeSpecCheck<N, M, K extends keyof N> = Fail<
  UnknownContent<N, K>,
  `Unknown node type or group in content: ${UnknownContent<N, K>}`
> &
  Fail<UnknownMarks<M, N[K], "marks">, `Unknown mark type or group in marks: ${UnknownMarks<M, N[K], "marks">}`> &
  Fail<BadDefaultsOf<N[K]>, `Attribute default is not a value of its schema: ${BadDefaultsOf<N[K]>}`> &
  Fail<BadValidateNamesOf<N[K]>, `Unknown type name in validate: ${BadValidateNamesOf<N[K]>}`>

type MarkSpecCheck<M, K extends keyof M> = Fail<
  UnknownMarks<M, M[K], "excludes">,
  `Unknown mark type or group in excludes: ${UnknownMarks<M, M[K], "excludes">}`
> &
  Fail<BadDefaultsOf<M[K]>, `Attribute default is not a value of its schema: ${BadDefaultsOf<M[K]>}`> &
  Fail<BadValidateNamesOf<M[K]>, `Unknown type name in validate: ${BadValidateNamesOf<M[K]>}`>

/**
 * The static checks `DocSchema.make` applies to a spec, on top of its
 * type: every name a content expression, a `marks` expression or an
 * `excludes` refers to exists; the top node and a `text` node exist; no
 * name is both a node and a mark; every attribute `default` is a value
 * of the attribute's `schema`; and every `validate` type name is one the
 * runtime knows. These are the runtime
 * `SchemaDefinitionError`s, reported where the spec is written. Each check
 * applies only where the names are known statically: a ProseMirror
 * content string with operators, or an untyped spec, is left to the
 * runtime check.
 *
 * @since 0.1.0
 * @category type-level
 */
export type SchemaSpecCheck<N, M, Top extends string> = string extends keyof N
  ? unknown
  : {
      readonly nodes: { readonly [K in keyof N]: NodeSpecCheck<N, M, K> } & {
        readonly [K in (string extends Top ? never : Top) | "text"]: NodeSpec
      }
    } & (string extends keyof M
      ? unknown
      : {
          readonly marks?: { readonly [K in keyof M]: MarkSpecCheck<M, K> } & {
            readonly [K in keyof M & keyof N]: Fail<K, `Name used by both a node and a mark: ${K & string}`>
          }
        })

/**
 * The node types of schema `Sc` whose attributes all have defaults (or
 * that have none), so their constructors may be called without an
 * attributes object. For other types, the attributes are a required
 * argument, so a required attribute cannot be left out by omitting the
 * whole object.
 *
 * @since 0.1.0
 * @category type-level
 */
export type NodesWithOptionalAttrs<Sc> = {
  [K in NodeNames<Sc>]: Partial<NodeAttrsInput<Sc, K>> extends NodeAttrsInput<Sc, K> ? K : never
}[NodeNames<Sc>]

/**
 * The mark types of schema `Sc` whose attributes all have defaults (see
 * `NodesWithOptionalAttrs`).
 *
 * @since 0.1.0
 * @category type-level
 */
export type MarksWithOptionalAttrs<Sc> = {
  [K in MarkNames<Sc>]: Partial<MarkAttrsInput<Sc, K>> extends MarkAttrsInput<Sc, K> ? K : never
}[MarkNames<Sc>]

/**
 * An untyped attributes object.
 *
 * @since 0.1.0
 * @category models
 */
export type Attrs = { readonly [attr: string]: any }

/**
 * The marks given to a node constructor: a mark set, or nothing (`null`
 * or `undefined`) for none.
 *
 * @since 0.1.0
 * @category models
 */
export type MarksInput<Sc extends AnySchema = AnySchema> = ReadonlyArray<Mark<Sc>> | null | undefined

/**
 * Anything that can be converted to a fragment of `N` nodes.
 *
 * @since 0.1.0
 * @category models
 */
export type FragmentInput<Sc extends AnySchema = AnySchema, N extends string = string> =
  | Fragment<Sc, N>
  | Node<Sc, N>
  | ReadonlyArray<Node<Sc, N>>
  | null
  | undefined

// -----------------------------------------------------------------------------
// Attributes
// -----------------------------------------------------------------------------

/** @internal */
export class Attribute {
  readonly hasDefault: boolean
  readonly default: unknown
  readonly schema: S.Codec<any, any> | undefined
  readonly validate: ((value: unknown) => void) | undefined
  readonly is: ((value: unknown) => boolean) | undefined
  // The schema has no transformation (see attrsCodec).
  readonly identityCodec: boolean

  constructor(typeName: string, attrName: string, definition: AttributeDefinition) {
    const options: AttributeSpec = S.isSchema(definition) ? { schema: definition as S.Codec<any, any> } : definition
    this.hasDefault = Object.prototype.hasOwnProperty.call(options, "default")
    this.default = options.default
    this.schema = options.schema
    this.is = options.schema ? (S.is(options.schema as any) as (value: unknown) => boolean) : undefined
    this.identityCodec = !options.schema || SchemaAST.toEncoded(options.schema.ast) === options.schema.ast
    this.validate =
      typeof options.validate === "string" ? validateType(typeName, attrName, options.validate) : options.validate
  }

  get isRequired(): boolean {
    return !this.hasDefault
  }
}

function validateType(typeName: string, attrName: string, type: string) {
  const types = type.split("|")
  return (value: unknown) => {
    const name = value === null ? "null" : typeof value
    if (types.indexOf(name) < 0) {
      throw new AttributeError({
        message: `Expected value of type ${types.join(",")} for attribute ${attrName} on type ${typeName}, got ${name}`
      })
    }
  }
}

const identityAttrs = (attrs: Record<string, Attribute>): boolean =>
  Arr.every(Rec.values(attrs), (a) => a.identityCodec)

function initAttrs(typeName: string, attrs?: AttributeDefinitions) {
  const result: Record<string, Attribute> = Object.create(null)
  if (attrs) {
    for (const name in attrs) result[name] = new Attribute(typeName, name, attrs[name]!)
  }
  return result
}

// For node types where all attrs have a default value (or which don't
// have any attributes), build up a single reusable default attribute
// object, and use it for all nodes that don't specify specific
// attributes.
function defaultAttrs(attrs: Record<string, Attribute>): Option.Option<Attrs> {
  const defaults = Object.create(null)
  for (const attrName in attrs) {
    const attr = attrs[attrName]!
    if (!attr.hasDefault) return Option.none()
    defaults[attrName] = attr.default
  }
  return Option.some(defaults)
}

/** @internal */
export function computeAttrs(
  attrs: Record<string, Attribute>,
  value: Attrs | null | undefined,
  type: string,
  typeName: string,
  // `value` holds values already decoded by their attribute Schemas (JSON
  // input): the decode validated them, so the Schema guard is skipped.
  decoded = false
): Attrs {
  const built = Object.create(null)
  for (const name in attrs) {
    const attr = attrs[name]!
    let given = value && value[name]
    if (given === undefined) {
      if (attr.hasDefault) given = attr.default
      else throw new AttributeError({ message: "No value supplied for attribute " + name })
    } else {
      // Validate every supplied value at creation, so no way of creating
      // a node or mark can skip it (prosemirror-model 1.25.12). Defaults
      // are trusted.
      if (attr.validate) attr.validate(given)
      if (!decoded && attr.is && !attr.is(given)) {
        throw new AttributeError({
          message: `Invalid value for attribute ${name} on ${type} of type ${typeName}: ${showJson(given)}`
        })
      }
    }
    built[name] = given
  }
  return built
}

/** @internal */
export function checkAttrs(attrs: Record<string, Attribute>, values: Attrs, type: string, typeName: string): void {
  for (const name in values) {
    if (!(name in attrs)) {
      throw new AttributeError({ message: `Unsupported attribute ${name} for ${type} of type ${typeName}` })
    }
  }
  for (const name in attrs) {
    const attr = attrs[name]!
    if (attr.validate) attr.validate(values[name])
    if (attr.is && !attr.is(values[name])) {
      throw new AttributeError({
        message: `Invalid value for attribute ${name} on ${type} of type ${typeName}: ${showJson(values[name])}`
      })
    }
  }
}

// -----------------------------------------------------------------------------
// NodeType
// -----------------------------------------------------------------------------

/**
 * Node types are objects allocated once per schema and used to tag
 * `Node` instances. They contain information about the node type, such
 * as its name and what kind of node it represents.
 *
 * @since 0.1.0
 * @category models
 */
export class NodeType<Sc extends AnySchema = AnySchema, out N extends NodeNames<Sc> = NodeNames<Sc>> {
  /** @internal */
  readonly groups: ReadonlyArray<string>
  /** @internal */
  readonly attrs: Record<string, Attribute>
  /** @internal */
  readonly defaultAttrs: Attrs | null
  /** @internal Every attribute's codec is the identity: JSON attrs are the attrs. */
  readonly identityAttrs: boolean
  /** True if this is a block type. */
  readonly isBlock: boolean
  /** True if this is the text node type. */
  readonly isText: boolean
  /** True if this node type has inline content. */
  inlineContent!: boolean
  /** The starting match of the node type's content expression. */
  contentMatch!: ContentMatch
  /** The set of marks allowed in this node. `null` means all marks are allowed. */
  markSet: ReadonlyArray<MarkType<Sc>> | null = null

  /** @internal */
  constructor(
    /** The name the node type has in this schema. */
    readonly name: N,
    /** A link back to the schema the node type belongs to. */
    readonly schema: Sc,
    /** The spec that this type is based on. */
    readonly spec: NodeSpecOf<Sc, N> & NodeSpec
  ) {
    this.groups = spec.group ? spec.group.split(" ") : []
    this.attrs = initAttrs(name, spec.attrs)
    this.defaultAttrs = Option.getOrNull(defaultAttrs(this.attrs))
    this.identityAttrs = identityAttrs(this.attrs)
    this.isBlock = !(spec.inline || name === "text")
    this.isText = name === "text"
  }

  /** True if this is an inline type. */
  get isInline(): boolean {
    return !this.isBlock
  }

  /** True if this is a textblock type, a block that contains inline content. */
  get isTextblock(): boolean {
    return this.isBlock && this.inlineContent
  }

  /** True for node types that allow no content. */
  get isLeaf(): boolean {
    return this.contentMatch === ContentMatch.empty
  }

  /** True when this node is an atom, i.e. when it does not have directly editable content. */
  get isAtom(): boolean {
    return this.isLeaf || !!this.spec.atom
  }

  /** Return true when this node type is part of the given group. */
  isInGroup(group: string): boolean {
    return this.groups.indexOf(group) > -1
  }

  /** The node type's whitespace option. */
  get whitespace(): "pre" | "normal" {
    return this.spec.whitespace || (this.spec.code ? "pre" : "normal")
  }

  /** Tells you whether this node type has any required attributes. */
  hasRequiredAttrs(): boolean {
    for (const n in this.attrs) if (this.attrs[n]!.isRequired) return true
    return false
  }

  /** Indicates whether this node allows some of the same content as the given node type. */
  compatibleContent(other: NodeType<any, any>): boolean {
    return this === other || this.contentMatch.compatible(other.contentMatch)
  }

  /** @internal */
  computeAttrs(attrs: Attrs | null | undefined): Attrs {
    if (!attrs && this.defaultAttrs) return this.defaultAttrs
    return computeAttrs(this.attrs, attrs, "node", this.name)
  }

  /**
   * Create a node of this type. Attributes are extended with defaults,
   * and supplied attribute values are validated (see `AttributeSpec`);
   * content is not checked against the content expression (see
   * `createChecked`).
   */
  create(
    this: NodeType<Sc, NodesWithOptionalAttrs<Sc>>,
    attrs?: NodeAttrsInput<Sc, N> | null,
    content?: FragmentInput<Sc, ChildNames<Sc, N>>,
    marks?: MarksInput<Sc>
  ): Effect.Effect<Node<Sc, N>, AttributeError | ContentError>
  create(
    attrs: NodeAttrsInput<Sc, N>,
    content?: FragmentInput<Sc, ChildNames<Sc, N>>,
    marks?: MarksInput<Sc>
  ): Effect.Effect<Node<Sc, N>, AttributeError | ContentError>
  create(
    attrs?: NodeAttrsInput<Sc, N> | null,
    content?: FragmentInput<Sc, ChildNames<Sc, N>>,
    marks?: MarksInput<Sc>
  ): Effect.Effect<Node<Sc, N>, AttributeError | ContentError> {
    return attempt(() => this.createUnsafe(attrs, content, marks), isModelError as any)
  }

  /** Like `create`, but throws an `AttributeError` on failure. */
  createUnsafe(
    this: NodeType<Sc, NodesWithOptionalAttrs<Sc>>,
    attrs?: NodeAttrsInput<Sc, N> | null,
    content?: FragmentInput<Sc, ChildNames<Sc, N>>,
    marks?: MarksInput<Sc>
  ): Node<Sc, N>
  createUnsafe(
    attrs: NodeAttrsInput<Sc, N>,
    content?: FragmentInput<Sc, ChildNames<Sc, N>>,
    marks?: MarksInput<Sc>
  ): Node<Sc, N>
  createUnsafe(
    attrs?: NodeAttrsInput<Sc, N> | null,
    content?: FragmentInput<Sc, ChildNames<Sc, N>>,
    marks?: MarksInput<Sc>
  ): Node<Sc, N> {
    if (this.isText) throw new ContentError({ message: "NodeType.create can't construct text nodes" })
    return new Node(this, this.computeAttrs(attrs) as any, Fragment.from(content), Mark.setFrom(marks)) as any
  }

  /**
   * Like `createUnsafe`, for attributes already decoded by their Schemas.
   *
   * @internal
   */
  createDecodedUnsafe(attrs: Option.Option<Attrs>, content: Fragment<Sc>, marks: ReadonlyArray<Mark<Sc>>): Node<Sc, N> {
    if (this.isText) throw new ContentError({ message: "NodeType.create can't construct text nodes" })
    return new Node(this, this.computeDecodedAttrs(attrs) as any, content, Mark.setFrom(marks)) as any
  }

  // Without a decoded attrs object nothing was decoded: compute as usual.
  private computeDecodedAttrs(attrs: Option.Option<Attrs>): Attrs {
    return Option.isSome(attrs)
      ? computeAttrs(this.attrs, attrs.value, "node", this.name, true)
      : this.computeAttrs(Option.getOrNull(attrs))
  }

  /**
   * Like `create`, but check the given content against the node type's
   * content restrictions.
   */
  createChecked(
    this: NodeType<Sc, NodesWithOptionalAttrs<Sc>>,
    attrs?: NodeAttrsInput<Sc, N> | null,
    content?: FragmentInput<Sc, ChildNames<Sc, N>>,
    marks?: MarksInput<Sc>
  ): Effect.Effect<Node<Sc, N>, AttributeError | ContentError>
  createChecked(
    attrs: NodeAttrsInput<Sc, N>,
    content?: FragmentInput<Sc, ChildNames<Sc, N>>,
    marks?: MarksInput<Sc>
  ): Effect.Effect<Node<Sc, N>, AttributeError | ContentError>
  createChecked(
    attrs?: NodeAttrsInput<Sc, N> | null,
    content?: FragmentInput<Sc, ChildNames<Sc, N>>,
    marks?: MarksInput<Sc>
  ): Effect.Effect<Node<Sc, N>, AttributeError | ContentError> {
    return attempt(() => this.createCheckedUnsafe(attrs, content, marks), isModelError as any)
  }

  /** Like `createChecked`, but throws on failure. */
  createCheckedUnsafe(
    this: NodeType<Sc, NodesWithOptionalAttrs<Sc>>,
    attrs?: NodeAttrsInput<Sc, N> | null,
    content?: FragmentInput<Sc, ChildNames<Sc, N>>,
    marks?: MarksInput<Sc>
  ): Node<Sc, N>
  createCheckedUnsafe(
    attrs: NodeAttrsInput<Sc, N>,
    content?: FragmentInput<Sc, ChildNames<Sc, N>>,
    marks?: MarksInput<Sc>
  ): Node<Sc, N>
  createCheckedUnsafe(
    attrs?: NodeAttrsInput<Sc, N> | null,
    content?: FragmentInput<Sc, ChildNames<Sc, N>>,
    marks?: MarksInput<Sc>
  ): Node<Sc, N> {
    const frag = Fragment.from(content)
    this.checkContent(frag)
    return new Node(this, this.computeAttrs(attrs) as any, frag, Mark.setFrom(marks)) as any
  }

  /**
   * Like `create`, but see if it is necessary to add nodes to the start
   * or end of the given fragment to make it fit the node. Fails with a
   * `ContentError` if no fitting wrapping can be found. Note that, due
   * to the fact that required nodes can always be created, this will
   * always succeed if you pass no content.
   */
  createAndFill(
    this: NodeType<Sc, NodesWithOptionalAttrs<Sc>>,
    attrs?: NodeAttrsInput<Sc, N> | null,
    content?: FragmentInput<Sc, ChildNames<Sc, N>>,
    marks?: MarksInput<Sc>
  ): Effect.Effect<Node<Sc, N>, AttributeError | ContentError>
  createAndFill(
    attrs: NodeAttrsInput<Sc, N>,
    content?: FragmentInput<Sc, ChildNames<Sc, N>>,
    marks?: MarksInput<Sc>
  ): Effect.Effect<Node<Sc, N>, AttributeError | ContentError>
  createAndFill(
    attrs?: NodeAttrsInput<Sc, N> | null,
    content?: FragmentInput<Sc, ChildNames<Sc, N>>,
    marks?: MarksInput<Sc>
  ): Effect.Effect<Node<Sc, N>, AttributeError | ContentError> {
    return attempt(() => {
      const node = this.createAndFillOrNull(attrs, content, marks)
      if (!node) {
        throw new ContentError({ message: `Content does not fit node type ${this.name} and cannot be filled` })
      }
      return node
    }, isModelError as any)
  }

  /** @internal */
  createAndFillOrNull(
    attrs?: Attrs | null,
    content?: FragmentInput<any, any>,
    marks?: ReadonlyArray<Mark<any>> | null
  ): Node<Sc, N> | null {
    const computed = this.computeAttrs(attrs)
    let frag = Fragment.from(content)
    if (frag.size) {
      const before = this.contentMatch.fillBeforeOrNull(frag)
      if (!before) return null
      frag = before.append(frag)
    }
    const matched = this.contentMatch.matchFragmentOrNull(frag)
    const after = matched && matched.fillBeforeOrNull(Fragment.empty, true)
    if (!after) return null
    return new Node(this, computed as any, frag.append(after), Mark.setFrom(marks)) as any
  }

  /** Returns true if the given fragment is valid content for this node type. */
  validContent(content: Fragment<any, any>): boolean {
    const result = this.contentMatch.matchFragmentOrNull(content)
    if (!result || !result.validEnd) return false
    for (let i = 0; i < content.childCount; i++) {
      if (!this.allowsMarks(content.content[i]!.marks)) return false
    }
    return true
  }

  /** @internal */
  checkContent(content: Fragment<any, any>): void {
    if (!this.validContent(content)) {
      throw new ContentError({
        message: `Invalid content for node ${this.name}: ${content.toString().slice(0, 50)}`
      })
    }
  }

  /** @internal */
  checkAttrs(attrs: Attrs): void {
    checkAttrs(this.attrs, attrs, "node", this.name)
  }

  /** Check whether the given mark type is allowed in this node. */
  allowsMarkType(markType: MarkType<any, any>): boolean {
    return this.markSet === null || this.markSet.indexOf(markType) > -1
  }

  /** Test whether the given set of marks are allowed in this node. */
  allowsMarks(marks: ReadonlyArray<Mark<any>>): boolean {
    if (this.markSet === null) return true
    for (let i = 0; i < marks.length; i++) if (!this.allowsMarkType(marks[i]!.type)) return false
    return true
  }

  /** Removes the marks that are not allowed in this node from the given set. */
  allowedMarks<M extends Mark<any>>(marks: ReadonlyArray<M>): ReadonlyArray<M> {
    if (this.allowsMarks(marks)) return marks
    const kept = marks.filter((mark) => this.allowsMarkType(mark.type))
    return kept.length ? kept : (Mark.none as ReadonlyArray<M>)
  }

  /** @internal */
  toString(): string {
    return `NodeType(${this.name})`
  }
}

const isAttributeError = (u: unknown): u is AttributeError => u instanceof AttributeError

// -----------------------------------------------------------------------------
// MarkType
// -----------------------------------------------------------------------------

/**
 * Like nodes, marks are tagged with type objects, which are
 * instantiated once per schema.
 *
 * @since 0.1.0
 * @category models
 */
export class MarkType<Sc extends AnySchema = AnySchema, out M extends MarkNames<Sc> = MarkNames<Sc>> {
  /** @internal */
  readonly attrs: Record<string, Attribute>
  /** @internal Every attribute's codec is the identity: JSON attrs are the attrs. */
  readonly identityAttrs: boolean
  /** @internal */
  excluded!: ReadonlyArray<MarkType<Sc>>
  /** @internal */
  readonly instance: Option.Option<Mark<Sc, M>>

  /** @internal */
  constructor(
    /** The name of the mark type. */
    readonly name: M,
    /** @internal */
    readonly rank: number,
    /** The schema that this mark type instance is part of. */
    readonly schema: Sc,
    /** The spec on which the type is based. */
    readonly spec: MarkSpecOf<Sc, M> & MarkSpec
  ) {
    this.attrs = initAttrs(name, spec.attrs)
    this.identityAttrs = identityAttrs(this.attrs)
    this.instance = Option.map(defaultAttrs(this.attrs), (defaults) => new Mark(this, defaults as any))
  }

  /**
   * Create a mark of this type. Attributes that are not given are
   * filled in from their defaults; supplied values are validated (see
   * `AttributeSpec`).
   */
  create(
    this: MarkType<Sc, MarksWithOptionalAttrs<Sc>>,
    attrs?: MarkAttrsInput<Sc, M> | null
  ): Effect.Effect<Mark<Sc, M>, AttributeError>
  create(attrs: MarkAttrsInput<Sc, M>): Effect.Effect<Mark<Sc, M>, AttributeError>
  create(attrs?: MarkAttrsInput<Sc, M> | null): Effect.Effect<Mark<Sc, M>, AttributeError> {
    return attempt(() => this.createUnsafe(attrs), isAttributeError)
  }

  /** Like `create`, but throws an `AttributeError` on failure. */
  createUnsafe(this: MarkType<Sc, MarksWithOptionalAttrs<Sc>>, attrs?: MarkAttrsInput<Sc, M> | null): Mark<Sc, M>
  createUnsafe(attrs: MarkAttrsInput<Sc, M>): Mark<Sc, M>
  createUnsafe(attrs?: MarkAttrsInput<Sc, M> | null): Mark<Sc, M> {
    if (!attrs && Option.isSome(this.instance)) return this.instance.value
    return new Mark(this, computeAttrs(this.attrs, attrs, "mark", this.name) as any)
  }

  /**
   * Like `createUnsafe`, for attributes already decoded by their Schemas.
   *
   * @internal
   */
  createDecodedUnsafe(attrs: Option.Option<Attrs>): Mark<Sc, M> {
    return Option.isSome(attrs)
      ? new Mark(this, computeAttrs(this.attrs, attrs.value, "mark", this.name, true) as any)
      : this.createUnsafe()
  }

  /**
   * When there is a mark of this type in the given set, a new set
   * without it is returned. Otherwise, the input set is returned.
   */
  removeFromSet<Mk extends Mark<any>>(set: ReadonlyArray<Mk>): ReadonlyArray<Mk> {
    for (let i = 0; i < set.length; i++) {
      if (set[i]!.type === this) {
        set = set.slice(0, i).concat(set.slice(i + 1))
        i--
      }
    }
    return set
  }

  /** Find a mark of this type in the given set. */
  isInSet(set: ReadonlyArray<Mark<any>>): Option.Option<Mark<Sc, M>> {
    return Option.fromNullishOr(this.findInSet(set))
  }

  /** @internal */
  findInSet(set: ReadonlyArray<Mark<any>>): Mark<Sc, M> | undefined {
    for (let i = 0; i < set.length; i++) if (set[i]!.type === this) return set[i] as Mark<Sc, M>
    return undefined
  }

  /** @internal */
  checkAttrs(attrs: Attrs): void {
    checkAttrs(this.attrs, attrs, "mark", this.name)
  }

  /** Queries whether a given mark type is excluded by this one. */
  excludes(other: MarkType<any, any>): boolean {
    return this.excluded.indexOf(other) > -1
  }

  /** @internal */
  toString(): string {
    return `MarkType(${this.name})`
  }
}

// -----------------------------------------------------------------------------
// DocSchema
// -----------------------------------------------------------------------------

type NodeTypes<Sc extends AnySchema, N extends NodeSpecs> = {
  readonly [K in keyof N & string]: NodeType<Sc, K>
}

type MarkTypes<Sc extends AnySchema, M extends MarkSpecs> = {
  readonly [K in keyof M & string]: MarkType<Sc, K>
}

/**
 * A document schema. Holds node and mark type objects for the nodes and
 * marks that may occur in conforming documents, and provides
 * functionality for creating and deserializing such documents.
 *
 * @since 0.1.0
 * @category models
 */
export class DocSchema<N extends NodeSpecs = NodeSpecs, M extends MarkSpecs = MarkSpecs> {
  /** The spec on which the schema is based. */
  readonly spec: { readonly nodes: N; readonly marks: M; readonly topNode?: string | undefined }
  /** An object mapping the schema's node names to node type objects. */
  readonly nodes: NodeTypes<DocSchema<N, M>, N> & Readonly<Partial<Record<string, NodeType<DocSchema<N, M>>>>>
  /** A map from mark names to mark type objects. */
  readonly marks: MarkTypes<DocSchema<N, M>, M> & Readonly<Partial<Record<string, MarkType<DocSchema<N, M>>>>>
  /** The linebreak replacement node defined in this schema, if any. */
  readonly linebreakReplacement: Option.Option<NodeType<DocSchema<N, M>>>
  /** The type of the default top node for this schema. */
  readonly topNodeType: NodeType<DocSchema<N, M>>
  /**
   * An object for storing whatever values modules may want to compute
   * and cache per schema.
   */
  readonly cached: Record<string, unknown> = Object.create(null)

  /** @internal */
  constructor(spec: SchemaSpec<N, M>) {
    this.spec = { ...spec, nodes: spec.nodes, marks: (spec.marks ?? {}) as M }
    const nodes: Record<string, NodeType<any, any>> = Object.create(null)
    for (const name in this.spec.nodes) nodes[name] = new NodeType(name, this, this.spec.nodes[name] as any)
    const topType = this.spec.topNode || "doc"
    if (!nodes[topType]) {
      throw new SchemaDefinitionError({ message: "Schema is missing its top node type ('" + topType + "')" })
    }
    if (!nodes.text) throw new SchemaDefinitionError({ message: "Every schema needs a 'text' type" })
    for (const _ in nodes.text.attrs) {
      throw new SchemaDefinitionError({ message: "The text node type should not have attributes" })
    }
    const marks: Record<string, MarkType<any, any>> = Object.create(null)
    let rank = 0
    for (const name in this.spec.marks) marks[name] = new MarkType(name, rank++, this, this.spec.marks[name] as any)
    this.nodes = nodes as any
    this.marks = marks as any

    let linebreak = Option.none<NodeType<any, any>>()
    for (const prop in nodes) {
      if (prop in marks) throw new SchemaDefinitionError({ message: prop + " can not be both a node and a mark" })
      const type = nodes[prop]!
      const markExpr = type.spec.marks
      type.contentMatch = ContentMatch.compile(type.spec.content, nodes, prop)
      type.inlineContent = type.contentMatch.inlineContent
      if (type.spec.linebreakReplacement) {
        if (Option.isSome(linebreak)) throw new SchemaDefinitionError({ message: "Multiple linebreak nodes defined" })
        if (!type.isInline || !type.isLeaf) {
          throw new SchemaDefinitionError({ message: "Linebreak replacement nodes must be inline leaf nodes" })
        }
        linebreak = Option.some(type)
      }
      type.markSet =
        markExpr === "_"
          ? null
          : markExpr
            ? gatherMarks(this, markExpr.split(" "))
            : markExpr === "" || !type.inlineContent
              ? []
              : null
    }
    for (const prop in marks) {
      const type = marks[prop]!
      const excl = type.spec.excludes
      type.excluded = excl == null ? [type] : excl === "" ? [] : gatherMarks(this, excl.split(" "))
    }
    this.linebreakReplacement = linebreak
    this.topNodeType = nodes[topType]!
  }

  /**
   * Construct a schema from a schema specification. A spec with literal
   * names is also checked statically (`SchemaSpecCheck`): an unknown
   * content, `marks` or `excludes` reference, a missing top or `text`
   * node, a name used by both a node and a mark, a `default` outside its
   * `schema` or an unknown `validate` type name fails to compile, where the
   * runtime would fail with a `SchemaDefinitionError`.
   */
  static make<const N extends NodeSpecs, const M extends MarkSpecs = {}, const Top extends string = "doc">(
    spec: SchemaSpec<N, M, Top> & NoInfer<SchemaSpecCheck<N, M, Top>>
  ): Effect.Effect<DocSchema<N, M>, SchemaDefinitionError> {
    return attempt(
      () => new DocSchema(spec),
      (u): u is SchemaDefinitionError => u instanceof SchemaDefinitionError
    )
  }

  /** Like `make`, but throws a `SchemaDefinitionError` for invalid specs. */
  static makeUnsafe<const N extends NodeSpecs, const M extends MarkSpecs = {}, const Top extends string = "doc">(
    spec: SchemaSpec<N, M, Top> & NoInfer<SchemaSpecCheck<N, M, Top>>
  ): DocSchema<N, M> {
    return new DocSchema(spec)
  }

  /**
   * Create a node in this schema. Attributes are extended with
   * defaults and the content is checked against the node type's
   * content expression.
   */
  node<K extends NodesWithOptionalAttrs<DocSchema<N, M>>>(
    type: K | NodeType<DocSchema<N, M>, K>,
    attrs?: NodeAttrsInput<DocSchema<N, M>, K> | null,
    content?: FragmentInput<DocSchema<N, M>, ChildNames<DocSchema<N, M>, K>>,
    marks?: MarksInput<DocSchema<N, M>>
  ): Effect.Effect<Node<DocSchema<N, M>, K>, AttributeError | ContentError>
  node<K extends keyof N & string>(
    type: K | NodeType<DocSchema<N, M>, K>,
    attrs: NodeAttrsInput<DocSchema<N, M>, K>,
    content?: FragmentInput<DocSchema<N, M>, ChildNames<DocSchema<N, M>, K>>,
    marks?: MarksInput<DocSchema<N, M>>
  ): Effect.Effect<Node<DocSchema<N, M>, K>, AttributeError | ContentError>
  node<K extends keyof N & string>(
    type: K | NodeType<DocSchema<N, M>, K>,
    attrs?: NodeAttrsInput<DocSchema<N, M>, K> | null,
    content?: FragmentInput<DocSchema<N, M>, ChildNames<DocSchema<N, M>, K>>,
    marks?: MarksInput<DocSchema<N, M>>
  ): Effect.Effect<Node<DocSchema<N, M>, K>, AttributeError | ContentError> {
    return attempt(() => this.nodeUnsafe(type, attrs, content, marks), isModelError as any)
  }

  /** Like `node`, but throws on failure. */
  nodeUnsafe<K extends NodesWithOptionalAttrs<DocSchema<N, M>>>(
    type: K | NodeType<DocSchema<N, M>, K>,
    attrs?: NodeAttrsInput<DocSchema<N, M>, K> | null,
    content?: FragmentInput<DocSchema<N, M>, ChildNames<DocSchema<N, M>, K>>,
    marks?: MarksInput<DocSchema<N, M>>
  ): Node<DocSchema<N, M>, K>
  nodeUnsafe<K extends keyof N & string>(
    type: K | NodeType<DocSchema<N, M>, K>,
    attrs: NodeAttrsInput<DocSchema<N, M>, K>,
    content?: FragmentInput<DocSchema<N, M>, ChildNames<DocSchema<N, M>, K>>,
    marks?: MarksInput<DocSchema<N, M>>
  ): Node<DocSchema<N, M>, K>
  nodeUnsafe<K extends keyof N & string>(
    type: K | NodeType<DocSchema<N, M>, K>,
    attrs?: NodeAttrsInput<DocSchema<N, M>, K> | null,
    content?: FragmentInput<DocSchema<N, M>, ChildNames<DocSchema<N, M>, K>>,
    marks?: MarksInput<DocSchema<N, M>>
  ): Node<DocSchema<N, M>, K> {
    let nodeType: NodeType<any, any>
    if (typeof type === "string") nodeType = this.nodeType(type)
    else if (!(type instanceof NodeType)) throw new ContentError({ message: "Invalid node type: " + type })
    else if (type.schema !== this) {
      throw new ContentError({ message: "Node type from different schema used (" + type.name + ")" })
    } else nodeType = type
    return nodeType.createCheckedUnsafe(attrs, content, marks) as any
  }

  /**
   * Create a text node in the schema. Fails for empty strings, since
   * empty text nodes are not allowed.
   */
  text(text: string, marks?: MarksInput<DocSchema<N, M>>): Effect.Effect<TextNode<DocSchema<N, M>>, ContentError> {
    return attempt(
      () => this.textUnsafe(text, marks),
      (u): u is ContentError => u instanceof ContentError
    )
  }

  /** Like `text`, but throws a `ContentError` for empty strings. */
  textUnsafe(text: string, marks?: ReadonlyArray<Mark<DocSchema<N, M>>> | null): TextNode<DocSchema<N, M>> {
    const type = this.nodes.text as NodeType<any, any>
    return new TextNode(type, type.defaultAttrs!, text, Mark.setFrom(marks)) as any
  }

  /** Create a mark with the given type and attributes. */
  mark<K extends MarksWithOptionalAttrs<DocSchema<N, M>>>(
    type: K | MarkType<DocSchema<N, M>, K>,
    attrs?: MarkAttrsInput<DocSchema<N, M>, K> | null
  ): Effect.Effect<Mark<DocSchema<N, M>, K>, AttributeError>
  mark<K extends keyof M & string>(
    type: K | MarkType<DocSchema<N, M>, K>,
    attrs: MarkAttrsInput<DocSchema<N, M>, K>
  ): Effect.Effect<Mark<DocSchema<N, M>, K>, AttributeError>
  mark<K extends keyof M & string>(
    type: K | MarkType<DocSchema<N, M>, K>,
    attrs?: MarkAttrsInput<DocSchema<N, M>, K> | null
  ): Effect.Effect<Mark<DocSchema<N, M>, K>, AttributeError> {
    return attempt(() => this.markUnsafe(type, attrs), isAttributeError)
  }

  /** Like `mark`, but throws on failure. */
  markUnsafe<K extends MarksWithOptionalAttrs<DocSchema<N, M>>>(
    type: K | MarkType<DocSchema<N, M>, K>,
    attrs?: MarkAttrsInput<DocSchema<N, M>, K> | null
  ): Mark<DocSchema<N, M>, K>
  markUnsafe<K extends keyof M & string>(
    type: K | MarkType<DocSchema<N, M>, K>,
    attrs: MarkAttrsInput<DocSchema<N, M>, K>
  ): Mark<DocSchema<N, M>, K>
  markUnsafe<K extends keyof M & string>(
    type: K | MarkType<DocSchema<N, M>, K>,
    attrs?: MarkAttrsInput<DocSchema<N, M>, K> | null
  ): Mark<DocSchema<N, M>, K> {
    const markType = typeof type === "string" ? this.marks[type] : type
    if (!markType) throw new AttributeError({ message: "Unknown mark type: " + String(type) })
    return markType.createUnsafe(attrs as any) as any
  }

  /** Deserialize a node from its JSON representation. */
  nodeFromJSON(value: unknown): Effect.Effect<Node<DocSchema<N, M>>, JSONError | ModelError> {
    return attempt(() => json.nodeFromJSON(this, value), isModelError)
  }

  /** Like `nodeFromJSON`, but throws on failure. */
  nodeFromJSONUnsafe(value: unknown): Node<DocSchema<N, M>> {
    return json.nodeFromJSON(this, value)
  }

  /** Deserialize a mark from its JSON representation. */
  markFromJSON(value: unknown): Effect.Effect<Mark<DocSchema<N, M>>, JSONError | ModelError> {
    return attempt(() => json.markFromJSON(this, value), isModelError)
  }

  /** Like `markFromJSON`, but throws on failure. */
  markFromJSONUnsafe(value: unknown): Mark<DocSchema<N, M>> {
    return json.markFromJSON(this, value)
  }

  /** @internal */
  nodeType(name: string): NodeType<DocSchema<N, M>> {
    const found = this.nodes[name]
    if (!found) throw new ContentError({ message: "Unknown node type: " + name })
    return found
  }
}

function gatherMarks(schema: DocSchema<any, any>, marks: ReadonlyArray<string>) {
  const found: Array<MarkType<any, any>> = []
  for (let i = 0; i < marks.length; i++) {
    const name = marks[i]!
    const mark = schema.marks[name]
    let ok = mark
    if (mark) {
      found.push(mark)
    } else {
      for (const prop in schema.marks) {
        const mark = schema.marks[prop]!
        if (name === "_" || (mark.spec.group && mark.spec.group.split(" ").indexOf(name) > -1)) {
          found.push((ok = mark))
        }
      }
    }
    if (!ok) throw new SchemaDefinitionError({ message: "Unknown mark type: '" + marks[i] + "'" })
  }
  return found
}

/**
 * Construct a schema from a specification.
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = DocSchema.make

/**
 * Construct a schema from a specification, throwing on invalid specs.
 *
 * @since 0.1.0
 * @category constructors
 */
export const makeUnsafe = DocSchema.makeUnsafe

/**
 * Identity helper that gives a node spec's callbacks access to
 * precisely typed attributes.
 *
 * @since 0.1.0
 * @category constructors
 */
export const nodeSpec = <const Spec extends NodeSpec>(spec: Spec): Spec => spec

/**
 * Identity helper for mark specs.
 *
 * @since 0.1.0
 * @category constructors
 */
export const markSpec = <const Spec extends MarkSpec>(spec: Spec): Spec => spec
