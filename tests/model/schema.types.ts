// Compile-time assertions for the document schema's types. Never executed:
// `vp run check` type-checks this file (tsconfig.test.json), and every
// `@ts-expect-error` directive is an assertion that the statement below it
// must NOT compile.
import * as Schema from "effect/Schema"
import {
  type AttributeType,
  Content,
  DocSchema,
  type MarksWithOptionalAttrs,
  type MarkType,
  type Node,
  type NodeAttrs,
  type NodeSpecs,
  type NodesWithOptionalAttrs,
  type NodeType
} from "effect-richtext/model"
import type { Equals, Expect } from "../utils/types.ts"
import { toggleMark } from "effect-richtext/commands"

const schema = DocSchema.makeUnsafe({
  nodes: {
    doc: { content: Content.oneOrMore("block") },
    paragraph: { content: Content.zeroOrMore("inline"), group: "block", marks: "_" },
    heading: {
      content: "inline*",
      group: "block",
      marks: "emphasis",
      attrs: { level: { schema: Schema.Int, default: 1 } }
    },
    image: { inline: true, group: "inline", attrs: { src: Schema.String, alt: { default: null } } },
    legacy: { group: "block", attrs: { kind: { default: "x", validate: "string|null" } } },
    text: { group: "inline" }
  },
  marks: {
    em: { group: "emphasis" },
    strong: { group: "emphasis", excludes: "" },
    link: { attrs: { href: Schema.String }, excludes: "_" }
  }
})
type Sc = typeof schema

// ---------------------------------------------------------------------------
// Required attributes cannot be left out by omitting the attributes object
// ---------------------------------------------------------------------------

type _optionalNodes = Expect<Equals<NodesWithOptionalAttrs<Sc>, "doc" | "paragraph" | "heading" | "legacy" | "text">>
type _optionalMarks = Expect<Equals<MarksWithOptionalAttrs<Sc>, "em" | "strong">>

schema.nodes.paragraph.createUnsafe()
schema.nodes.heading.createUnsafe({ level: 2 })
schema.nodes.image.createUnsafe({ src: "a.png" })
schema.marks.em.createUnsafe()
schema.marks.link.createUnsafe({ href: "https://x.y" })
schema.nodeUnsafe("paragraph")
schema.nodeUnsafe("image", { src: "a.png" })
schema.markUnsafe("link", { href: "https://x.y" })

// Mark constructors take `undefined`, not ProseMirror's `null`, for no
// attributes (the compat facade maps one to the other).
// @ts-expect-error no attributes is `undefined`
schema.marks.em.createUnsafe(null)
// @ts-expect-error no attributes is `undefined`
schema.markUnsafe("em", null)
// @ts-expect-error no attributes is `undefined`
toggleMark(schema.marks.em, null)
toggleMark(schema.marks.em, undefined, { removeWhenPresent: false })

// @ts-expect-error `src` is required
schema.nodes.image.createUnsafe()
// @ts-expect-error `src` is required
export const _effect0 = schema.nodes.image.create()
// @ts-expect-error `src` is required
export const _effect1 = schema.nodes.image.createChecked()
// @ts-expect-error `src` is required
schema.nodes.image.createCheckedUnsafe()
// @ts-expect-error `src` is required
export const _effect2 = schema.nodes.image.createAndFill()
// @ts-expect-error `src` is required
schema.nodes.image.createUnsafe(null)
// @ts-expect-error `src` is required
schema.nodes.image.createUnsafe({})
// @ts-expect-error `src` is required
schema.nodeUnsafe("image")
// @ts-expect-error `src` is required
export const _effect3 = schema.node("image")
// @ts-expect-error `href` is required
schema.marks.link.createUnsafe()
// @ts-expect-error `href` is required
export const _effect4 = schema.marks.link.create()
// @ts-expect-error `href` is required
schema.markUnsafe("link")
// @ts-expect-error `href` is required
export const _effect5 = schema.mark("link")

// Without a known schema, every constructor keeps ProseMirror's optional
// attributes.
declare const anyType: NodeType
declare const anyMark: MarkType
anyType.createUnsafe()
anyMark.createUnsafe()

// ---------------------------------------------------------------------------
// Lookups by unknown names may come back empty
// ---------------------------------------------------------------------------

type _knownNode = Expect<Equals<typeof schema.nodes.image, NodeType<Sc, "image">>>
type UnknownNode = (typeof schema.nodes)["nope"]
type UnknownMark = (typeof schema.marks)["nope"]
type _unknownNode = Expect<Equals<Exclude<UnknownNode, undefined>, NodeType<Sc>>>
type _unknownNodeMissing = Expect<undefined extends UnknownNode ? true : false>
type _unknownMark = Expect<Equals<Exclude<UnknownMark, undefined>, MarkType<Sc>>>
type _unknownMarkMissing = Expect<undefined extends UnknownMark ? true : false>
// @ts-expect-error there is no `nope` node type
schema.nodes.nope.createUnsafe()
// @ts-expect-error there is no `nope` node type
schema.nodeUnsafe("nope")

// ---------------------------------------------------------------------------
// Attribute types
// ---------------------------------------------------------------------------

type _schemaAttr = Expect<Equals<NodeAttrs<Sc, "heading">, { readonly level: number }>>
// A `validate` type list types the attribute; a bare `null` default says
// nothing about the value.
type Kind = NodeAttrs<Sc, "legacy">["kind"]
type _validateAttr = Expect<Equals<Exclude<Kind, null>, string>>
type _validateAttrNull = Expect<null extends Kind ? true : false>
type _untypedAttr = Expect<Equals<NodeAttrs<Sc, "image">, { readonly src: string; readonly alt: unknown }>>
type _validateNames = Expect<Equals<AttributeType<{ validate: "number|boolean" }>, number | boolean>>
type _validateFunction = Expect<Equals<AttributeType<{ validate: (value: number) => void }>, unknown>>
type _defaultOnly = Expect<Equals<AttributeType<{ default: 0 }>, number>>

declare const image: Node<Sc, "image">
const _src: string = image.attrs.src
// @ts-expect-error `alt` is `unknown` until narrowed
const _alt: string = image.attrs.alt
// @ts-expect-error `kind` admits only what `validate` says
schema.nodes.legacy.createUnsafe({ kind: 1 })

// ---------------------------------------------------------------------------
// Specs are checked where they are written
// ---------------------------------------------------------------------------

const text = { group: "inline" } as const

DocSchema.makeUnsafe({
  // @ts-expect-error no node type or group `paragrph`
  nodes: { doc: { content: Content.oneOrMore("paragrph") }, text }
})
DocSchema.makeUnsafe({
  // @ts-expect-error a bare content string is a reference too
  nodes: { doc: { content: "paragrph" }, text }
})
DocSchema.makeUnsafe({
  // @ts-expect-error no mark type or group `bold`
  nodes: { doc: { content: "text*", marks: "bold" }, text }
})
DocSchema.makeUnsafe({
  nodes: { doc: { content: "text*" }, text },
  // @ts-expect-error no mark type or group `nope`
  marks: { em: { excludes: "nope" } }
})
DocSchema.makeUnsafe({
  // @ts-expect-error `level`'s default is not a number
  nodes: { doc: { content: "text*" }, text, h: { attrs: { level: { schema: Schema.Int, default: "one" } } } }
})
DocSchema.makeUnsafe({
  // @ts-expect-error `strng` is not a type name `validate` knows
  nodes: { doc: { content: "text*" }, text, h: { attrs: { level: { validate: "strng" } } } }
})
DocSchema.makeUnsafe({
  // @ts-expect-error the top node `page` does not exist
  nodes: { doc: { content: "text*" }, text },
  topNode: "page"
})
DocSchema.makeUnsafe({
  // @ts-expect-error without a `topNode`, there must be a `doc`
  nodes: { page: { content: "text*" }, text }
})
DocSchema.makeUnsafe({
  // @ts-expect-error every schema needs a `text` node type
  nodes: { doc: {} }
})
DocSchema.makeUnsafe({
  nodes: { doc: { content: "text*" }, text, em: {} },
  // @ts-expect-error `em` is both a node and a mark
  marks: { em: {} }
})
// The Effect constructor checks the same.
// @ts-expect-error no node type or group `paragrph`
export const _made = DocSchema.make({ nodes: { doc: { content: "paragrph" }, text } })

// Valid specs: a custom top node, ProseMirror content syntax (checked at
// run time only), mark groups and "_".
DocSchema.makeUnsafe({ nodes: { page: { content: "(paragraph | text)+" }, paragraph: {}, text }, topNode: "page" })

// An untyped spec is left to the runtime check, as in ProseMirror.
const untyped: NodeSpecs = { doc: { content: Content.oneOrMore("nope") }, text: {} }
DocSchema.makeUnsafe({ nodes: untyped })
