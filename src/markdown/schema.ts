/**
 * The document schema used by CommonMark.
 *
 * @since 0.1.0
 */
// Ported from prosemirror-markdown (MIT, Marijn Haverbeke and others)
import * as S from "effect/Schema"
import { Content, DocSchema, markSpec, nodeSpec } from "../model.ts"

/**
 * The node specs of the Markdown schema.
 *
 * @since 0.1.0
 * @category specs
 */
export const nodes = {
  doc: nodeSpec({
    content: Content.oneOrMore("block")
  }),

  paragraph: nodeSpec({
    content: Content.zeroOrMore("inline"),
    group: "block",
    parseDOM: [{ tag: "p" }],
    toDOM() {
      return ["p", 0]
    }
  }),

  blockquote: nodeSpec({
    content: Content.oneOrMore("block"),
    group: "block",
    parseDOM: [{ tag: "blockquote" }],
    toDOM() {
      return ["blockquote", 0]
    }
  }),

  horizontal_rule: nodeSpec({
    group: "block",
    parseDOM: [{ tag: "hr" }],
    toDOM() {
      return ["div", ["hr"]]
    }
  }),

  heading: nodeSpec({
    attrs: { level: { schema: S.Number, default: 1 } },
    content: Content.zeroOrMore(Content.choice("text", "image")),
    group: "block",
    defining: true,
    parseDOM: [
      { tag: "h1", attrs: { level: 1 } },
      { tag: "h2", attrs: { level: 2 } },
      { tag: "h3", attrs: { level: 3 } },
      { tag: "h4", attrs: { level: 4 } },
      { tag: "h5", attrs: { level: 5 } },
      { tag: "h6", attrs: { level: 6 } }
    ],
    toDOM(node) {
      return ["h" + node.attrs.level, 0]
    }
  }),

  code_block: nodeSpec({
    content: Content.zeroOrMore("text"),
    group: "block",
    code: true,
    defining: true,
    marks: "",
    attrs: { params: { schema: S.String, default: "" } },
    parseDOM: [{
      tag: "pre",
      preserveWhitespace: "full",
      getAttrs: (node: HTMLElement) => ({ params: node.getAttribute("data-params") || "" })
    }],
    toDOM(node) {
      return ["pre", node.attrs.params ? { "data-params": node.attrs.params } : {}, ["code", 0]]
    }
  }),

  ordered_list: nodeSpec({
    content: Content.oneOrMore("list_item"),
    group: "block",
    attrs: {
      order: { schema: S.Number, default: 1 },
      tight: { schema: S.Boolean, default: false }
    },
    parseDOM: [{
      tag: "ol",
      getAttrs(dom: HTMLElement) {
        return {
          order: dom.hasAttribute("start") ? +dom.getAttribute("start")! : 1,
          tight: dom.hasAttribute("data-tight")
        }
      }
    }],
    toDOM(node) {
      return ["ol", {
        start: node.attrs.order == 1 ? null : node.attrs.order,
        "data-tight": node.attrs.tight ? "true" : null
      }, 0]
    }
  }),

  bullet_list: nodeSpec({
    content: Content.oneOrMore("list_item"),
    group: "block",
    attrs: { tight: { schema: S.Boolean, default: false } },
    parseDOM: [{ tag: "ul", getAttrs: (dom: HTMLElement) => ({ tight: dom.hasAttribute("data-tight") }) }],
    toDOM(node) {
      return ["ul", { "data-tight": node.attrs.tight ? "true" : null }, 0]
    }
  }),

  list_item: nodeSpec({
    content: Content.oneOrMore("block"),
    defining: true,
    parseDOM: [{ tag: "li" }],
    toDOM() {
      return ["li", 0]
    }
  }),

  text: nodeSpec({
    group: "inline"
  }),

  image: nodeSpec({
    inline: true,
    attrs: {
      src: S.String,
      alt: { schema: S.NullOr(S.String), default: null },
      title: { schema: S.NullOr(S.String), default: null }
    },
    group: "inline",
    draggable: true,
    parseDOM: [{
      tag: "img[src]",
      getAttrs(dom: HTMLElement) {
        return {
          src: dom.getAttribute("src"),
          title: dom.getAttribute("title"),
          alt: dom.getAttribute("alt")
        }
      }
    }],
    toDOM(node) {
      const { alt, src, title } = node.attrs
      return ["img", { src, alt, title }]
    }
  }),

  hard_break: nodeSpec({
    inline: true,
    group: "inline",
    selectable: false,
    parseDOM: [{ tag: "br" }],
    toDOM() {
      return ["br"]
    }
  })
}

/**
 * The mark specs of the Markdown schema.
 *
 * @since 0.1.0
 * @category specs
 */
export const marks = {
  em: markSpec({
    parseDOM: [
      { tag: "i" },
      { tag: "em" },
      { style: "font-style=italic" },
      { style: "font-style=normal", clearMark: (m) => m.type.name === "em" }
    ],
    toDOM() {
      return ["em"]
    }
  }),

  strong: markSpec({
    parseDOM: [
      { tag: "strong" },
      { tag: "b", getAttrs: (node: HTMLElement) => node.style.fontWeight !== "normal" && null },
      { style: "font-weight=400", clearMark: (m) => m.type.name === "strong" },
      { style: "font-weight", getAttrs: (value: string) => /^(bold(er)?|[5-9]\d{2,})$/.test(value) && null }
    ],
    toDOM() {
      return ["strong"]
    }
  }),

  link: markSpec({
    attrs: {
      href: S.String,
      title: { schema: S.NullOr(S.String), default: null }
    },
    inclusive: false,
    parseDOM: [{
      tag: "a[href]",
      getAttrs(dom: HTMLElement) {
        return { href: dom.getAttribute("href"), title: dom.getAttribute("title") }
      }
    }],
    toDOM(node) {
      const { href, title } = node.attrs
      return ["a", { href, title }]
    }
  }),

  code: markSpec({
    code: true,
    parseDOM: [{ tag: "code" }],
    toDOM() {
      return ["code"]
    }
  })
}

/**
 * Document schema for the data model used by CommonMark.
 *
 * @since 0.1.0
 * @category schemas
 */
export const schema = DocSchema.makeUnsafe({ nodes, marks })

/**
 * @since 0.1.0
 * @category schemas
 */
export type MarkdownSchema = typeof schema
