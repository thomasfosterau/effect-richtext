/**
 * JSON (de)serialization of documents, including Effect `Schema` codecs
 * derived from a document schema.
 *
 * @since 0.1.0
 */
import * as Effect from "effect/Effect"
import * as S from "effect/Schema"
import * as SchemaGetter from "effect/SchemaGetter"
import * as SchemaIssue from "effect/SchemaIssue"
import { decodeAttrs } from "./attrsCodec.ts"
import { isModelError, JSONError } from "./errors.ts"
import { Fragment } from "./fragment.ts"
import type { Mark } from "./mark.ts"
import { Node, type NodeJSON } from "./node.ts"
import { Slice } from "./replace.ts"
import type { AnySchema, Attrs } from "./schema.ts"

const fail = (message: string): never => {
  throw new JSONError({ message })
}

const decodeAttrsOrFail = (defs: Parameters<typeof decodeAttrs>[0], attrs: unknown, what: string): Attrs | null => {
  if (attrs == null) return null
  if (typeof attrs !== "object" || Array.isArray(attrs)) fail(`Invalid attributes for ${what}`)
  try {
    return decodeAttrs(defs, attrs as Attrs)
  } catch (e) {
    if (isModelError(e)) throw e
    return fail(`Invalid attributes for ${what}: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/** @internal */
export function markFromJSON<Sc extends AnySchema>(schema: Sc, json: any): Mark<Sc> {
  if (!json || typeof json !== "object") fail("Invalid input for Mark.fromJSON")
  const type = schema.marks[json.type]
  if (!type) fail(`There is no mark type ${json.type} in this schema`)
  const mark = type!.createUnsafe(decodeAttrsOrFail(type!.attrs, json.attrs, `mark ${json.type}`) as any)
  type!.checkAttrs(mark.attrs)
  return mark as Mark<Sc>
}

/** @internal */
export function nodeFromJSON<Sc extends AnySchema>(schema: Sc, json: any): Node<Sc> {
  if (!json || typeof json !== "object") fail("Invalid input for Node.fromJSON")
  let marks: Array<Mark<Sc>> | undefined = undefined
  if (json.marks) {
    if (!Array.isArray(json.marks)) fail("Invalid mark data for Node.fromJSON")
    marks = json.marks.map((m: unknown) => markFromJSON(schema, m))
  }
  if (json.type === "text") {
    if (typeof json.text !== "string") fail("Invalid text node in JSON")
    if (!json.text) fail("Empty text nodes are not allowed")
    return schema.textUnsafe(json.text, marks) as unknown as Node<Sc>
  }
  const content = fragmentFromJSON(schema, json.content)
  const type = schema.nodes[json.type]
  if (!type) fail("Unknown node type: " + json.type)
  const node = type!.createUnsafe(
    decodeAttrsOrFail(type!.attrs, json.attrs, `node ${json.type}`) as any,
    content as any,
    marks
  )
  type!.checkAttrs(node.attrs)
  return node as Node<Sc>
}

/** @internal */
export function fragmentFromJSON<Sc extends AnySchema>(schema: Sc, value: any): Fragment<Sc> {
  if (!value) return Fragment.empty
  if (!Array.isArray(value)) fail("Invalid input for Fragment.fromJSON")
  return Fragment.fromArray(value.map((n: unknown) => nodeFromJSON(schema, n)))
}

/** @internal */
export function sliceFromJSON<Sc extends AnySchema>(schema: Sc, value: any): Slice<Sc> {
  return Slice.fromJSONUnsafe(schema, value)
}

const NodeJSONSchema: S.Codec<NodeJSON> = S.suspend(() =>
  S.Struct({
    type: S.String,
    attrs: S.optionalKey(S.Record(S.String, S.Unknown)),
    content: S.optionalKey(S.Array(NodeJSONSchema)),
    marks: S.optionalKey(S.Array(S.Struct({
      type: S.String,
      attrs: S.optionalKey(S.Record(S.String, S.Unknown))
    }))),
    text: S.optionalKey(S.String)
  })
) as any

const wrap = <A>(f: () => A): Effect.Effect<A, SchemaIssue.Issue> =>
  Effect.suspend(() => {
    try {
      return Effect.succeed(f())
    } catch (e) {
      return Effect.fail(new SchemaIssue.InvalidValue({ message: e instanceof Error ? e.message : String(e) }))
    }
  })

/**
 * An Effect `Schema` that decodes the JSON representation of a node
 * into a `Node` of the given document schema (validating structure,
 * content, and attributes), and encodes nodes back to JSON.
 *
 * ```ts skip-type-checking
 * import { Schema } from "effect"
 * const doc = yield* Schema.decodeUnknownEffect(NodeFromJSON(mySchema))(json)
 * ```
 *
 * @since 0.1.0
 * @category schemas
 */
export const NodeFromJSON = <Sc extends AnySchema>(schema: Sc): S.Codec<Node<Sc>, NodeJSON> => {
  const target = S.declare((u: unknown): u is Node<Sc> => u instanceof Node && u.type.schema === schema, {
    title: "Node"
  })
  return NodeJSONSchema.pipe(
    S.decodeTo(target, {
      decode: SchemaGetter.transformEffect((json: NodeJSON) =>
        wrap(() => {
          const node = nodeFromJSON(schema, json)
          node.checkUnsafe()
          return node
        })
      ),
      encode: SchemaGetter.transform((node: Node<Sc>) => node.toJSON())
    })
  ) as any
}

/**
 * An Effect `Schema` for the top-level document of a schema: like
 * `NodeFromJSON`, but also requires the decoded node to be of the
 * schema's top node type.
 *
 * @since 0.1.0
 * @category schemas
 */
export const DocFromJSON = <Sc extends AnySchema>(schema: Sc): S.Codec<Node<Sc>, NodeJSON> => {
  const target = S.declare(
    (u: unknown): u is Node<Sc> => u instanceof Node && u.type === schema.topNodeType,
    { title: "Document" }
  )
  return NodeJSONSchema.pipe(
    S.decodeTo(target, {
      decode: SchemaGetter.transformEffect((json: NodeJSON) =>
        wrap(() => {
          const node = nodeFromJSON(schema, json)
          if (node.type !== schema.topNodeType) {
            fail(`Expected a ${schema.topNodeType.name} node, got ${node.type.name}`)
          }
          node.checkUnsafe()
          return node
        })
      ),
      encode: SchemaGetter.transform((node: Node<Sc>) => node.toJSON())
    })
  ) as any
}
