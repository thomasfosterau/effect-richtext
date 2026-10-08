/**
 * Document schemas.
 *
 * A schema describes the node and mark types that may appear in a
 * document. Schemas are strongly typed: the names of node and mark
 * types, their attributes (described with Effect `Schema`s), and the
 * child types each node type allows (from its [content
 * expression](./content.ts)) are all available at the type level.
 *
 * ```ts
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
import * as Option from "effect/Option"
import * as S from "effect/Schema"
import { attempt } from "../internal/attempt.ts"
import { type ContentInput, ContentMatch, type Refs } from "./content.ts"
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
 * - `schema` is an Effect `Schema` used to validate the value (in
 *   `Node.check`) and to decode/encode it from/to JSON. It also gives
 *   the attribute its static type.
 * - `default` is used when no value is provided. Attributes without a
 *   default are required.
 * - `validate` is accepted for ProseMirror compatibility: either a
 *   `|`-separated list of primitive type names or a function that
 *   throws on invalid values.
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
   * does not allow any content.
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
export interface SchemaSpec<N extends NodeSpecs = NodeSpecs, M extends MarkSpecs = MarkSpecs> {
  readonly nodes: N
  readonly marks?: M | undefined
  /** The name of the default top-level node. Defaults to `"doc"`. */
  readonly topNode?: string | undefined
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
export type NodeSpecOf<Sc, N extends string> = NodeSpecsOf<Sc> extends infer Specs ?
  N extends keyof Specs ? Specs[N] : NodeSpec
  : NodeSpec

/**
 * The spec of mark type `M` in schema `Sc`.
 *
 * @since 0.1.0
 * @category type-level
 */
export type MarkSpecOf<Sc, M extends string> = MarkSpecsOf<Sc> extends infer Specs ?
  M extends keyof Specs ? Specs[M] : MarkSpec
  : MarkSpec

type Split<Str extends string> = string extends Str ? string
  : Str extends `${infer H} ${infer T}` ? (H extends "" ? never : H) | Split<T>
  : Str extends "" ? never
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
export type ContentRefsOf<Spec> = Spec extends { readonly content: infer C } ? Refs<C> : never

/**
 * The names of the node types that can appear as children of node type
 * `N` in schema `Sc`.
 *
 * @since 0.1.0
 * @category type-level
 */
export type ChildNames<Sc, N extends string> = string extends NodeNames<Sc> ? string
  : string extends N ? NodeNames<Sc>
  : ResolveRefs<Sc, ContentRefsOf<NodeSpecOf<Sc, N>>>

/**
 * Resolve a set of node/group names to the node names they denote.
 *
 * @since 0.1.0
 * @category type-level
 */
export type ResolveRefs<Sc, R extends string> = string extends R ? NodeNames<Sc> : {
  [C in NodeNames<Sc>]: C extends R ? C
    : [GroupsOf<NodeSpecOf<Sc, C>> & R] extends [never] ? never
    : C
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
export type MarksInGroup<Sc, G extends string> = string extends MarkNames<Sc> ? string : {
  [C in MarkNames<Sc>]: C extends G ? C
    : [GroupsOf<MarkSpecOf<Sc, C>> & G] extends [never] ? never
    : C
}[MarkNames<Sc>]

type Widen<A> = A extends string ? string
  : A extends number ? number
  : A extends boolean ? boolean
  : A extends null | undefined ? any
  : A

/**
 * The value type of an attribute definition.
 *
 * @since 0.1.0
 * @category type-level
 */
export type AttributeType<D> = D extends S.Top ? D["Type"]
  : D extends { readonly schema: infer Sc extends S.Top } ? Sc["Type"]
  : D extends { readonly default: infer A } ? Widen<A>
  : any

type AttrDefsOf<Spec> = Spec extends { readonly attrs: infer A extends AttributeDefinitions } ? A : {}

/**
 * The (complete) attributes object for a node or mark spec.
 *
 * @since 0.1.0
 * @category type-level
 */
export type AttrsOfSpec<Spec> = [Spec] extends [never] ? Attrs
  : string extends keyof AttrDefsOf<Spec> ? Attrs
  : { readonly [K in keyof AttrDefsOf<Spec>]: AttributeType<AttrDefsOf<Spec>[K]> }

type OptionalAttrKeys<D> = { [K in keyof D]: D[K] extends { readonly default?: any } ? K : never }[keyof D]

/**
 * The attributes accepted when creating a node or mark from a spec:
 * attributes with defaults may be omitted.
 *
 * @since 0.1.0
 * @category type-level
 */
export type AttrsInputOfSpec<Spec> = [Spec] extends [never] ? Attrs
  : string extends keyof AttrDefsOf<Spec> ? Attrs
  : Simplify<
    & {
      readonly [K in Exclude<keyof AttrDefsOf<Spec>, OptionalAttrKeys<AttrDefsOf<Spec>>>]: AttributeType<
        AttrDefsOf<Spec>[K]
      >
    }
    & { readonly [K in OptionalAttrKeys<AttrDefsOf<Spec>>]?: AttributeType<AttrDefsOf<Spec>[K]> }
  >

type Simplify<A> = { [K in keyof A]: A[K] } & {}

/**
 * The attributes of node type `N` in schema `Sc`.
 *
 * @since 0.1.0
 * @category type-level
 */
export type NodeAttrs<Sc, N extends string> = string extends NodeNames<Sc> ? Attrs
  : N extends any ? AttrsOfSpec<NodeSpecOf<Sc, N>>
  : never

/**
 * The attributes accepted when creating a node of type `N`.
 *
 * @since 0.1.0
 * @category type-level
 */
export type NodeAttrsInput<Sc, N extends string> = string extends NodeNames<Sc> ? Attrs
  : AttrsInputOfSpec<NodeSpecOf<Sc, N>>

/**
 * The attributes of mark type `M` in schema `Sc`.
 *
 * @since 0.1.0
 * @category type-level
 */
export type MarkAttrs<Sc, M extends string> = string extends MarkNames<Sc> ? Attrs
  : M extends any ? AttrsOfSpec<MarkSpecOf<Sc, M>>
  : never

/**
 * The attributes accepted when creating a mark of type `M`.
 *
 * @since 0.1.0
 * @category type-level
 */
export type MarkAttrsInput<Sc, M extends string> = string extends MarkNames<Sc> ? Attrs
  : AttrsInputOfSpec<MarkSpecOf<Sc, M>>

/**
 * True when all attributes of the spec have defaults (or there are
 * none), meaning the attrs argument can be omitted.
 *
 * @since 0.1.0
 * @category type-level
 */
export type AttrsOptional<Spec> = {} extends AttrsInputOfSpec<Spec> ? true : false

/**
 * An untyped attributes object.
 *
 * @since 0.1.0
 * @category models
 */
export type Attrs = { readonly [attr: string]: any }

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

  constructor(typeName: string, attrName: string, definition: AttributeDefinition) {
    const options: AttributeSpec = S.isSchema(definition) ? { schema: definition as S.Codec<any, any> } : definition
    this.hasDefault = Object.prototype.hasOwnProperty.call(options, "default")
    this.default = options.default
    this.schema = options.schema
    this.is = options.schema ? S.is(options.schema as any) as (value: unknown) => boolean : undefined
    this.validate = typeof options.validate === "string"
      ? validateType(typeName, attrName, options.validate)
      : options.validate
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
        message: `Expected value of type ${types} for attribute ${attrName} on type ${typeName}, got ${name}`
      })
    }
  }
}

function initAttrs(typeName: string, attrs?: AttributeDefinitions) {
  const result: Record<string, Attribute> = Object.create(null)
  if (attrs) { for (const name in attrs) result[name] = new Attribute(typeName, name, attrs[name]!) }
  return result
}

// For node types where all attrs have a default value (or which don't
// have any attributes), build up a single reusable default attribute
// object, and use it for all nodes that don't specify specific
// attributes.
function defaultAttrs(attrs: Record<string, Attribute>): Attrs | null {
  const defaults = Object.create(null)
  for (const attrName in attrs) {
    const attr = attrs[attrName]!
    if (!attr.hasDefault) return null
    defaults[attrName] = attr.default
  }
  return defaults
}

/** @internal */
export function computeAttrs(attrs: Record<string, Attribute>, value: Attrs | null | undefined): Attrs {
  const built = Object.create(null)
  for (const name in attrs) {
    let given = value && value[name]
    if (given === undefined) {
      const attr = attrs[name]!
      if (attr.hasDefault) given = attr.default
      else throw new AttributeError({ message: "No value supplied for attribute " + name })
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
        message: `Invalid value for attribute ${name} on ${type} of type ${typeName}: ${safeString(values[name])}`
      })
    }
  }
}

const safeString = (u: unknown): string => {
  try {
    return JSON.stringify(u) ?? String(u)
  } catch {
    return String(u)
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
    this.defaultAttrs = defaultAttrs(this.attrs)
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
    return computeAttrs(this.attrs, attrs)
  }

  /**
   * Create a node of this type. Attributes are extended with defaults;
   * content is not checked against the content expression (see
   * `createChecked`).
   */
  create(
    attrs?: NodeAttrsInput<Sc, N> | null,
    content?: FragmentInput<Sc, ChildNames<Sc, N>>,
    marks?: ReadonlyArray<Mark<Sc>> | null
  ): Effect.Effect<Node<Sc, N>, AttributeError> {
    return attempt(() => this.createUnsafe(attrs, content, marks), isAttributeError)
  }

  /** Like `create`, but throws an `AttributeError` on failure. */
  createUnsafe(
    attrs?: NodeAttrsInput<Sc, N> | null,
    content?: FragmentInput<Sc, ChildNames<Sc, N>>,
    marks?: ReadonlyArray<Mark<Sc>> | null
  ): Node<Sc, N> {
    if (this.isText) throw new ContentError({ message: "NodeType.create can't construct text nodes" })
    return new Node(this, this.computeAttrs(attrs) as any, Fragment.from(content), Mark.setFrom(marks)) as any
  }

  /**
   * Like `create`, but check the given content against the node type's
   * content restrictions.
   */
  createChecked(
    attrs?: NodeAttrsInput<Sc, N> | null,
    content?: FragmentInput<Sc, ChildNames<Sc, N>>,
    marks?: ReadonlyArray<Mark<Sc>> | null
  ): Effect.Effect<Node<Sc, N>, AttributeError | ContentError> {
    return attempt(() => this.createCheckedUnsafe(attrs, content, marks), isModelError as any)
  }

  /** Like `createChecked`, but throws on failure. */
  createCheckedUnsafe(
    attrs?: NodeAttrsInput<Sc, N> | null,
    content?: FragmentInput<Sc, ChildNames<Sc, N>>,
    marks?: ReadonlyArray<Mark<Sc>> | null
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
    attrs?: NodeAttrsInput<Sc, N> | null,
    content?: FragmentInput<Sc, ChildNames<Sc, N>>,
    marks?: ReadonlyArray<Mark<Sc>> | null
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
    if (this.markSet === null) return marks
    let copy: Array<M> | undefined
    for (let i = 0; i < marks.length; i++) {
      if (!this.allowsMarkType(marks[i]!.type)) {
        if (!copy) copy = marks.slice(0, i)
      } else if (copy) {
        copy.push(marks[i]!)
      }
    }
    return !copy ? marks : copy.length ? copy : Mark.none as ReadonlyArray<M>
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
  /** @internal */
  excluded!: ReadonlyArray<MarkType<Sc>>
  /** @internal */
  readonly instance: Mark<Sc, M> | null

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
    const defaults = defaultAttrs(this.attrs)
    this.instance = defaults ? new Mark(this, defaults as any) : null
  }

  /**
   * Create a mark of this type. Attributes that are not given are
   * filled in from their defaults.
   */
  create(attrs?: MarkAttrsInput<Sc, M> | null): Effect.Effect<Mark<Sc, M>, AttributeError> {
    return attempt(() => this.createUnsafe(attrs), isAttributeError)
  }

  /** Like `create`, but throws an `AttributeError` on failure. */
  createUnsafe(attrs?: MarkAttrsInput<Sc, M> | null): Mark<Sc, M> {
    if (!attrs && this.instance) return this.instance
    return new Mark(this, computeAttrs(this.attrs, attrs) as any)
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
  readonly nodes: NodeTypes<DocSchema<N, M>, N> & { readonly [name: string]: NodeType<DocSchema<N, M>> }
  /** A map from mark names to mark type objects. */
  readonly marks: MarkTypes<DocSchema<N, M>, M> & { readonly [name: string]: MarkType<DocSchema<N, M>> }
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

    let linebreak: NodeType<any, any> | null = null
    for (const prop in nodes) {
      if (prop in marks) throw new SchemaDefinitionError({ message: prop + " can not be both a node and a mark" })
      const type = nodes[prop]!
      const markExpr = type.spec.marks
      type.contentMatch = ContentMatch.compile(type.spec.content, nodes, prop)
      type.inlineContent = type.contentMatch.inlineContent
      if (type.spec.linebreakReplacement) {
        if (linebreak) throw new SchemaDefinitionError({ message: "Multiple linebreak nodes defined" })
        if (!type.isInline || !type.isLeaf) {
          throw new SchemaDefinitionError({ message: "Linebreak replacement nodes must be inline leaf nodes" })
        }
        linebreak = type
      }
      type.markSet = markExpr === "_" ?
        null
        : markExpr ?
        gatherMarks(this, markExpr.split(" "))
        : markExpr === "" || !type.inlineContent ?
        []
        : null
    }
    for (const prop in marks) {
      const type = marks[prop]!
      const excl = type.spec.excludes
      type.excluded = excl == null ? [type] : excl === "" ? [] : gatherMarks(this, excl.split(" "))
    }
    this.linebreakReplacement = Option.fromNullishOr(linebreak)
    this.topNodeType = nodes[topType]!
  }

  /**
   * Construct a schema from a schema specification.
   */
  static make<const N extends NodeSpecs, const M extends MarkSpecs = {}>(
    spec: SchemaSpec<N, M>
  ): Effect.Effect<DocSchema<N, M>, SchemaDefinitionError> {
    return attempt(() => new DocSchema(spec), (u): u is SchemaDefinitionError => u instanceof SchemaDefinitionError)
  }

  /** Like `make`, but throws a `SchemaDefinitionError` for invalid specs. */
  static makeUnsafe<const N extends NodeSpecs, const M extends MarkSpecs = {}>(
    spec: SchemaSpec<N, M>
  ): DocSchema<N, M> {
    return new DocSchema(spec)
  }

  /**
   * Create a node in this schema. Attributes are extended with
   * defaults and the content is checked against the node type's
   * content expression.
   */
  node<K extends keyof N & string>(
    type: K | NodeType<DocSchema<N, M>, K>,
    attrs?: NodeAttrsInput<DocSchema<N, M>, K> | null,
    content?: FragmentInput<DocSchema<N, M>, ChildNames<DocSchema<N, M>, K>>,
    marks?: ReadonlyArray<Mark<DocSchema<N, M>>> | null
  ): Effect.Effect<Node<DocSchema<N, M>, K>, AttributeError | ContentError> {
    return attempt(() => this.nodeUnsafe(type, attrs, content, marks), isModelError as any)
  }

  /** Like `node`, but throws on failure. */
  nodeUnsafe<K extends keyof N & string>(
    type: K | NodeType<DocSchema<N, M>, K>,
    attrs?: NodeAttrsInput<DocSchema<N, M>, K> | null,
    content?: FragmentInput<DocSchema<N, M>, ChildNames<DocSchema<N, M>, K>>,
    marks?: ReadonlyArray<Mark<DocSchema<N, M>>> | null
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
  text(
    text: string,
    marks?: ReadonlyArray<Mark<DocSchema<N, M>>> | null
  ): Effect.Effect<TextNode<DocSchema<N, M>>, ContentError> {
    return attempt(() => this.textUnsafe(text, marks), (u): u is ContentError => u instanceof ContentError)
  }

  /** Like `text`, but throws a `ContentError` for empty strings. */
  textUnsafe(text: string, marks?: ReadonlyArray<Mark<DocSchema<N, M>>> | null): TextNode<DocSchema<N, M>> {
    const type = this.nodes.text as NodeType<any, any>
    return new TextNode(type, type.defaultAttrs!, text, Mark.setFrom(marks)) as any
  }

  /** Create a mark with the given type and attributes. */
  mark<K extends keyof M & string>(
    type: K | MarkType<DocSchema<N, M>, K>,
    attrs?: MarkAttrsInput<DocSchema<N, M>, K> | null
  ): Effect.Effect<Mark<DocSchema<N, M>, K>, AttributeError> {
    return attempt(() => this.markUnsafe(type, attrs), isAttributeError)
  }

  /** Like `mark`, but throws on failure. */
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
          found.push(ok = mark)
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
