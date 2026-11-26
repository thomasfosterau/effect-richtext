/**
 * A `prosemirror-test-builder`-compatible module, built on the compat
 * facades: helpers for building documents in tests, with `<tag>`
 * position markers.
 *
 * Ported from prosemirror-test-builder (MIT, Marijn Haverbeke and others).
 *
 * @since 0.1.0
 */
import * as Predicate from "effect/Predicate"
import { type Attrs, type MarkType, Node, type NodeType, Schema } from "./model.ts"
import { schema as bSchema } from "./schema-basic.ts"
import { addListNodes } from "./schema-list.ts"

type Tags = { [tag: string]: number }

/**
 * A child argument of a builder.
 *
 * @since 0.1.0
 * @category models
 */
export type ChildSpec = string | Node | { flat: ReadonlyArray<Node>; tag: Tags }

const noTag: Tags = Object.create(null)
Reflect.set(Node.prototype, "tag", noTag)

// SAFETY: nodes read `tag` from `Node.prototype` unless a builder gave them their own; leaf builders have none.
const tagOf = (child: Node | { readonly tag: Tags }): Tags => (child as { readonly tag?: Tags }).tag ?? noTag

function flatten(
  schema: Schema,
  children: Array<ChildSpec>,
  f: (node: Node) => Node
): { nodes: Array<Node>; tag: Tags } {
  const result = []
  let pos = 0,
    tag = noTag

  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    if (Predicate.isString(child)) {
      const re = /<(\w+)>/g
      let m,
        at = 0,
        out = ""
      while ((m = re.exec(child))) {
        out += child.slice(at, m.index)
        pos += m.index - at
        at = m.index + m[0].length
        if (tag == noTag) tag = Object.create(null)
        tag[m[1]] = pos
      }
      out += child.slice(at)
      pos += child.length - at
      if (out) result.push(f(schema.text(out)))
    } else {
      const childTag = tagOf(child)
      if (childTag != noTag) {
        if (tag == noTag) tag = Object.create(null)
        for (const key in childTag) {
          tag[key] = childTag[key] + ("flat" in child || child.isText ? 0 : 1) + pos
        }
      }
      if ("flat" in child) {
        for (let j = 0; j < child.flat.length; j++) {
          const node = f(child.flat[j])
          pos += node.nodeSize
          result.push(node)
        }
      } else {
        const node = f(child)
        pos += node.nodeSize
        result.push(node)
      }
    }
  }
  return { nodes: result, tag }
}

function id<T>(x: T): T {
  return x
}

function takeAttrs(attrs: Attrs | null, args: [a?: Attrs | ChildSpec | undefined, ...b: Array<ChildSpec>]) {
  const a0 = args[0]
  if (!args.length || (a0 && (Predicate.isString(a0) || a0 instanceof Node || "flat" in a0))) return attrs

  args.shift()
  // SAFETY: a first argument that isn't a child holds the attributes.
  const given = a0 as Attrs
  if (!attrs) return given
  if (!given) return attrs
  return { ...attrs, ...given }
}

/**
 * A node builder.
 *
 * @since 0.1.0
 * @category models
 */
export type NodeBuilder = (attrsOrFirstChild?: Attrs | ChildSpec, ...children: Array<ChildSpec>) => Node & { tag: Tags }

/**
 * A mark builder.
 *
 * @since 0.1.0
 * @category models
 */
export type MarkBuilder = (attrsOrFirstChild?: Attrs | ChildSpec, ...children: Array<ChildSpec>) => ChildSpec

type Builders<S extends Schema> = {
  schema: S
} & {
  [key in keyof S["nodes"]]: NodeBuilder
} & {
  [key in keyof S["marks"]]: MarkBuilder
} & {
  [name: string]: NodeBuilder | MarkBuilder
}

// Create a builder function for nodes with content.
function block(type: NodeType, attrs: Attrs | null = null): NodeBuilder {
  const result = function (...args: [a?: Attrs | ChildSpec, ...b: Array<ChildSpec>]) {
    const myAttrs = takeAttrs(attrs, args)
    // SAFETY: `takeAttrs` removed the attributes, leaving the children.
    const { nodes, tag } = flatten(type.schema, args as Array<ChildSpec>, id)
    const node = type.create(myAttrs, nodes)
    return tag != noTag ? Object.assign(node, { tag }) : node
  }
  if (type.isLeaf) {
    try {
      Object.assign(result, { flat: [type.create(attrs)] })
    } catch {
      // Types with required attributes can't be created without them.
    }
  }
  // SAFETY: untagged nodes read `tag` from `Node.prototype`.
  return result as NodeBuilder
}

// Create a builder function for marks.
function mark(type: MarkType, attrs: Attrs | null): MarkBuilder {
  return function (...args) {
    const m = type.create(takeAttrs(attrs, args))
    // SAFETY: `takeAttrs` removed the attributes, leaving the children.
    const { nodes, tag } = flatten(type.schema, args as Array<ChildSpec>, (n) => {
      const newMarks = m.addToSet(n.marks)
      return newMarks.length > n.marks.length ? n.mark(newMarks) : n
    })
    return { flat: nodes, tag }
  }
}

/**
 * Create a set of builder functions for the given schema.
 *
 * @since 0.1.0
 * @category constructors
 */
export function builders<Nodes extends string = any, Marks extends string = any>(
  schema: Schema<Nodes, Marks>,
  names?: { [name: string]: Attrs }
): Builders<Schema<Nodes, Marks>> {
  const result: { [name: string]: unknown } = { schema }
  for (const name in schema.nodes) result[name] = block(schema.nodes[name], {})
  for (const name in schema.marks) result[name] = mark(schema.marks[name], {})

  if (names) {
    for (const name in names) {
      const value = names[name],
        typeName = value.nodeType || value.markType || name
      let type
      if ((type = schema.nodes[typeName])) result[name] = block(type, value)
      else if ((type = schema.marks[typeName])) result[name] = mark(type, value)
    }
  }
  // SAFETY: holds `schema`, a builder for each node and mark type, and one for each name.
  return result as Builders<Schema<Nodes, Marks>>
}

/**
 * The test schema: the basic schema plus list nodes.
 *
 * @since 0.1.0
 * @category schemas
 */
export const schema = new Schema({
  nodes: addListNodes(bSchema.spec.nodes, "paragraph block*", "block"),
  marks: bSchema.spec.marks
})

const b: { [name: string]: any } = builders(schema, {
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
 * Compare two values with their `eq` method.
 *
 * @since 0.1.0
 * @category utils
 */
export function eq<T extends { eq(other: T): boolean }>(x: T, y: T): boolean {
  return x.eq(y)
}

/** @since 0.1.0 */
export const doc: NodeBuilder = b.doc
/** @since 0.1.0 */
export const p: NodeBuilder = b.p
/** @since 0.1.0 */
export const code_block: NodeBuilder = b.code_block
/** @since 0.1.0 */
export const pre: NodeBuilder = b.pre
/** @since 0.1.0 */
export const h1: NodeBuilder = b.h1
/** @since 0.1.0 */
export const h2: NodeBuilder = b.h2
/** @since 0.1.0 */
export const h3: NodeBuilder = b.h3
/** @since 0.1.0 */
export const li: NodeBuilder = b.li
/** @since 0.1.0 */
export const ul: NodeBuilder = b.ul
/** @since 0.1.0 */
export const ol: NodeBuilder = b.ol
/** @since 0.1.0 */
export const img: NodeBuilder = b.img
/** @since 0.1.0 */
export const hr: NodeBuilder = b.hr
/** @since 0.1.0 */
export const br: NodeBuilder = b.br
/** @since 0.1.0 */
export const blockquote: NodeBuilder = b.blockquote
/** @since 0.1.0 */
export const a: MarkBuilder = b.a
/** @since 0.1.0 */
export const em: MarkBuilder = b.em
/** @since 0.1.0 */
export const strong: MarkBuilder = b.strong
/** @since 0.1.0 */
export const code: MarkBuilder = b.code
