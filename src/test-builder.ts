/**
 * Helpers for concisely building documents in tests, ported from
 * `prosemirror-test-builder`.
 *
 * Builders are functions that take an optional attributes object and
 * any number of children (nodes, strings, or the output of mark
 * builders). Strings may contain `<name>` tags, which are removed from
 * the text and recorded (as document positions) in the resulting
 * node's `tag` object.
 *
 * ```ts skip-type-checking
 * const d = doc(p("hello <a>world"))
 * d.tag.a // => 7
 * ```
 *
 * @since 0.1.0
 */
import {
  type AnySchema,
  type Attrs,
  Content,
  DocSchema,
  type MarkNames,
  type MarkType,
  Node,
  type NodeNames,
  type NodeType
} from "./model.ts"
import { marks as basicMarks, nodes as basicNodes } from "./schema-basic.ts"
import { addListNodes } from "./schema-list.ts"

/**
 * Positions recorded from `<name>` markers.
 *
 * @since 0.1.0
 * @category models
 */
export type Tags = { readonly [tag: string]: number }

/**
 * A node with recorded tag positions.
 *
 * @since 0.1.0
 * @category models
 */
export type TaggedNode<Sc extends AnySchema = AnySchema, N extends NodeNames<Sc> = NodeNames<Sc>> = Node<Sc, N> & {
  readonly tag: Tags
}

/**
 * The flattened output of a mark builder.
 *
 * @since 0.1.0
 * @category models
 */
export interface Flat<Sc extends AnySchema = AnySchema> {
  readonly flat: ReadonlyArray<Node<Sc>>
  readonly tag: Tags
}

/**
 * Something that can be passed as a child to a builder.
 *
 * @since 0.1.0
 * @category models
 */
export type ChildSpec<Sc extends AnySchema = AnySchema> = string | Node<Sc> | Flat<Sc> | NodeBuilder<Sc, any>

/**
 * @since 0.1.0
 * @category models
 */
export type NodeBuilder<Sc extends AnySchema = AnySchema, N extends NodeNames<Sc> = NodeNames<Sc>> = ((
  attrsOrFirstChild?: Attrs | ChildSpec<Sc>,
  ...children: Array<ChildSpec<Sc>>
) => TaggedNode<Sc, N>) & { readonly flat?: ReadonlyArray<Node<Sc>> }

/**
 * @since 0.1.0
 * @category models
 */
export type MarkBuilder<Sc extends AnySchema = AnySchema> = (
  attrsOrFirstChild?: Attrs | ChildSpec<Sc>,
  ...children: Array<ChildSpec<Sc>>
) => Flat<Sc>

const noTag: Tags = Object.create(null)
const tags = new WeakMap<Node<any, any>, Tags>()

/**
 * Get the tags recorded for a node built with a builder (empty when
 * none were recorded).
 *
 * @since 0.1.0
 * @category utils
 */
export const tagsOf = (node: Node<any, any>): Tags => tags.get(node) ?? noTag

const withTag = <A extends Node<any, any>>(node: A, tag: Tags): A & { readonly tag: Tags } => {
  if (tag !== noTag) tags.set(node, tag)
  return node as A & { readonly tag: Tags }
}

Object.defineProperty(Node.prototype, "tag", {
  get(this: Node<any, any>) {
    return tagsOf(this)
  },
  configurable: true
})

// Node builders for leaf types (such as `br`) carry a `flat` array too,
// so they can be passed as children without being called.
const isFlat = (u: unknown): u is Flat<any> =>
  (typeof u === "object" || typeof u === "function") && u !== null && Array.isArray((u as Flat<any>).flat)

function flatten<Sc extends AnySchema>(
  schema: Sc,
  children: ReadonlyArray<ChildSpec<Sc>>,
  f: (node: Node<Sc>) => Node<Sc>
): { nodes: Array<Node<Sc>>; tag: Tags } {
  const result: Array<Node<Sc>> = []
  let pos = 0
  let tag: Record<string, number> = noTag as Record<string, number>

  for (let i = 0; i < children.length; i++) {
    const child = children[i]!
    if (typeof child === "string") {
      const re = /<(\w+)>/g
      let m: RegExpExecArray | null
      let at = 0,
        out = ""
      while ((m = re.exec(child))) {
        out += child.slice(at, m.index)
        pos += m.index - at
        at = m.index + m[0].length
        if (tag === noTag) tag = Object.create(null)
        tag[m[1]!] = pos
      }
      out += child.slice(at)
      pos += child.length - at
      if (out) result.push(f(schema.textUnsafe(out) as unknown as Node<Sc>))
    } else if (isFlat(child)) {
      const childTag = child.tag ?? noTag
      if (childTag !== noTag) {
        if (tag === noTag) tag = Object.create(null)
        for (const id in childTag) tag[id] = childTag[id]! + pos
      }
      for (let j = 0; j < child.flat.length; j++) {
        const node = f(child.flat[j]!)
        pos += node.nodeSize
        result.push(node)
      }
    } else {
      const node0 = child as Node<Sc>
      const childTag = tagsOf(node0)
      if (childTag !== noTag) {
        if (tag === noTag) tag = Object.create(null)
        for (const id in childTag) tag[id] = childTag[id]! + (node0.isText ? 0 : 1) + pos
      }
      const node = f(node0)
      pos += node.nodeSize
      result.push(node)
    }
  }
  return { nodes: result, tag }
}

function takeAttrs(attrs: Attrs | null, args: Array<unknown>): Attrs | null {
  const a0 = args[0]
  if (!args.length || (a0 && (typeof a0 === "string" || a0 instanceof Node || isFlat(a0)))) return attrs
  args.shift()
  if (!attrs) return a0 as Attrs
  if (!a0) return attrs
  return { ...attrs, ...(a0 as Attrs) }
}

function block<Sc extends AnySchema, N extends NodeNames<Sc>>(
  type: NodeType<Sc, N>,
  attrs: Attrs | null = null
): NodeBuilder<Sc, N> {
  const result = function (...args: Array<any>) {
    const myAttrs = takeAttrs(attrs, args)
    const { nodes, tag } = flatten(type.schema, args as Array<ChildSpec<Sc>>, (n) => n)
    return withTag(type.createUnsafe(myAttrs as any, nodes as any), tag)
  }
  if (type.isLeaf) {
    try {
      ;(result as any).flat = [type.createUnsafe(attrs as any)]
    } catch {
      // Leaf types with required attributes have no default instance.
    }
  }
  return result as NodeBuilder<Sc, N>
}

function mark<Sc extends AnySchema>(type: MarkType<Sc>, attrs: Attrs | null): MarkBuilder<Sc> {
  return function (...args: Array<any>) {
    const m = type.createUnsafe(takeAttrs(attrs, args) as any)
    const { nodes, tag } = flatten(type.schema, args as Array<ChildSpec<Sc>>, (n) => {
      const newMarks = m.addToSet(n.marks)
      return newMarks.length > n.marks.length ? n.mark(newMarks) : n
    })
    return { flat: nodes, tag }
  }
}

/**
 * Typed builders for a schema: one per node type and mark type, plus
 * any extra named builders.
 *
 * @since 0.1.0
 * @category models
 */
export type Builders<Sc extends AnySchema, Extra extends Record<string, Attrs> = {}> = { readonly schema: Sc } & {
  readonly [K in NodeNames<Sc>]: NodeBuilder<Sc, K>
} & { readonly [K in MarkNames<Sc>]: MarkBuilder<Sc> } & {
  readonly [K in keyof Extra]: Extra[K] extends { readonly nodeType: infer T extends NodeNames<Sc> }
    ? NodeBuilder<Sc, T>
    : MarkBuilder<Sc>
}

/**
 * Create builders for the given schema. `names` can be used to define
 * additional builders with preset attributes, using `nodeType` or
 * `markType` to specify the underlying type:
 *
 * ```ts skip-type-checking
 * builders(schema, { h1: { nodeType: "heading", level: 1 } })
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export function builders<Sc extends AnySchema, const Extra extends Record<string, Attrs> = {}>(
  schema: Sc,
  names?: Extra
): Builders<Sc, Extra> {
  const result: Record<string, unknown> = { schema }
  for (const name in schema.nodes) result[name] = block(schema.nodes[name]!, {})
  for (const name in schema.marks) result[name] = mark(schema.marks[name]!, {})
  if (names) {
    for (const name in names) {
      const value = { ...names[name] } as Record<string, any>
      const typeName = value.nodeType || value.markType || name
      delete value.nodeType
      delete value.markType
      const nodeType = schema.nodes[typeName],
        markType = schema.marks[typeName]
      if (nodeType) result[name] = block(nodeType, value)
      else if (markType) result[name] = mark(markType, value)
    }
  }
  return result as Builders<Sc, Extra>
}

/**
 * The test schema: the basic schema with list nodes added.
 *
 * @since 0.1.0
 * @category schemas
 */
export const schema = DocSchema.makeUnsafe({
  nodes: addListNodes(basicNodes, Content.seq("paragraph", Content.zeroOrMore("block")), "block"),
  marks: basicMarks
})

/**
 * @since 0.1.0
 * @category schemas
 */
export type TestSchema = typeof schema

const b = builders(schema, {
  p: { nodeType: "paragraph" },
  pre: { nodeType: "code_block" },
  h1: { nodeType: "heading", level: 1 },
  h2: { nodeType: "heading", level: 2 },
  h3: { nodeType: "heading", level: 3 },
  li: { nodeType: "list_item" },
  ul: { nodeType: "bullet_list" },
  ol: { nodeType: "ordered_list" },
  br: { nodeType: "hard_break" },
  img: { nodeType: "image", src: "img.png" },
  hr: { nodeType: "horizontal_rule" },
  a: { markType: "link", href: "foo" }
})

/**
 * Structural equality helper.
 *
 * @since 0.1.0
 * @category utils
 */
export function eq<T extends { eq(other: T): boolean }>(a: T, b: T): boolean {
  return a.eq(b)
}

/** @since 0.1.0 */
export const doc = b.doc
/** @since 0.1.0 */
export const p = b.p
/** @since 0.1.0 */
export const code_block = b.code_block
/** @since 0.1.0 */
export const pre = b.pre
/** @since 0.1.0 */
export const h1 = b.h1
/** @since 0.1.0 */
export const h2 = b.h2
/** @since 0.1.0 */
export const h3 = b.h3
/** @since 0.1.0 */
export const li = b.li
/** @since 0.1.0 */
export const ul = b.ul
/** @since 0.1.0 */
export const ol = b.ol
/** @since 0.1.0 */
export const img = b.img
/** @since 0.1.0 */
export const hr = b.hr
/** @since 0.1.0 */
export const br = b.br
/** @since 0.1.0 */
export const blockquote = b.blockquote
/** @since 0.1.0 */
export const a = b.a
/** @since 0.1.0 */
export const em = b.em
/** @since 0.1.0 */
export const strong = b.strong
/** @since 0.1.0 */
export const code = b.code
