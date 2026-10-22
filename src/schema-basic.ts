/**
 * A basic document schema, ported from `prosemirror-schema-basic`.
 *
 * It supports paragraphs, blockquotes, horizontal rules, headings, code
 * blocks, images, hard breaks, and the `link`, `em`, `strong` and
 * `code` marks. It is mostly useful as an example and a starting point
 * for your own schemas.
 *
 * @since 0.1.0
 */
import * as S from "effect/Schema"
import { Content, DocSchema, type DOMOutputSpec, markSpec, nodeSpec } from "./model.ts"

const pDOM: DOMOutputSpec = ["p", 0],
  blockquoteDOM: DOMOutputSpec = ["blockquote", 0],
  hrDOM: DOMOutputSpec = ["hr"],
  preDOM: DOMOutputSpec = ["pre", ["code", 0]],
  brDOM: DOMOutputSpec = ["br"]

/**
 * The node specs of the basic schema.
 *
 * @since 0.1.0
 * @category specs
 */
export const nodes = {
  /** The top level document node. */
  doc: nodeSpec({
    content: Content.oneOrMore("block")
  }),

  /** A plain paragraph textblock. Represented in the DOM as a `<p>` element. */
  paragraph: nodeSpec({
    content: Content.zeroOrMore("inline"),
    group: "block",
    parseDOM: [{ tag: "p" }],
    toDOM() {
      return pDOM
    }
  }),

  /** A blockquote (`<blockquote>`) wrapping one or more blocks. */
  blockquote: nodeSpec({
    content: Content.oneOrMore("block"),
    group: "block",
    defining: true,
    parseDOM: [{ tag: "blockquote" }],
    toDOM() {
      return blockquoteDOM
    }
  }),

  /** A horizontal rule (`<hr>`). */
  horizontal_rule: nodeSpec({
    group: "block",
    parseDOM: [{ tag: "hr" }],
    toDOM() {
      return hrDOM
    }
  }),

  /**
   * A heading textblock, with a `level` attribute that should hold the
   * number 1 to 6. Parsed and serialized as `<h1>` to `<h6>` elements.
   */
  heading: nodeSpec({
    attrs: { level: { schema: S.Number, default: 1 } },
    content: Content.zeroOrMore("inline"),
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

  /**
   * A code listing. Disallows marks or non-text inline nodes by default.
   * Represented as a `<pre>` element with a `<code>` element inside of
   * it.
   */
  code_block: nodeSpec({
    content: Content.zeroOrMore("text"),
    marks: "",
    group: "block",
    code: true,
    defining: true,
    parseDOM: [{ tag: "pre", preserveWhitespace: "full" }],
    toDOM() {
      return preDOM
    }
  }),

  /** The text node. */
  text: nodeSpec({
    group: "inline"
  }),

  /**
   * An inline image (`<img>`) node. Supports `src`, `alt`, and `title`
   * attributes. The latter two default to `null`.
   */
  image: nodeSpec({
    inline: true,
    attrs: {
      src: S.String,
      alt: { schema: S.NullOr(S.String), default: null },
      title: { schema: S.NullOr(S.String), default: null }
    },
    group: "inline",
    draggable: true,
    parseDOM: [
      {
        tag: "img[src]",
        getAttrs(dom: HTMLElement) {
          return {
            src: dom.getAttribute("src"),
            title: dom.getAttribute("title"),
            alt: dom.getAttribute("alt")
          }
        }
      }
    ],
    toDOM(node) {
      const { alt, src, title } = node.attrs
      return ["img", { src, alt, title }]
    }
  }),

  /** A hard line break, represented in the DOM as `<br>`. */
  hard_break: nodeSpec({
    inline: true,
    group: "inline",
    selectable: false,
    parseDOM: [{ tag: "br" }],
    toDOM() {
      return brDOM
    }
  })
}

const emDOM: DOMOutputSpec = ["em", 0],
  strongDOM: DOMOutputSpec = ["strong", 0],
  codeDOM: DOMOutputSpec = ["code", 0]

/**
 * The mark specs of the basic schema.
 *
 * @since 0.1.0
 * @category specs
 */
export const marks = {
  /**
   * A link. Has `href` and `title` attributes. `title` defaults to
   * `null`. Rendered and parsed as an `<a>` element.
   */
  link: markSpec({
    attrs: {
      href: S.String,
      title: { schema: S.NullOr(S.String), default: null }
    },
    inclusive: false,
    parseDOM: [
      {
        tag: "a[href]",
        getAttrs(dom: HTMLElement) {
          return { href: dom.getAttribute("href"), title: dom.getAttribute("title") }
        }
      }
    ],
    toDOM(node) {
      const { href, title } = node.attrs
      return ["a", { href, title }, 0]
    }
  }),

  /** An emphasis mark. Rendered as an `<em>` element. */
  em: markSpec({
    parseDOM: [
      { tag: "i" },
      { tag: "em" },
      { style: "font-style=italic" },
      { style: "font-style=normal", clearMark: (m) => m.type.name === "em" }
    ],
    toDOM() {
      return emDOM
    }
  }),

  /** A strong mark. Rendered as `<strong>`, parse rules also match `<b>` and `font-weight: bold`. */
  strong: markSpec({
    parseDOM: [
      { tag: "strong" },
      // This works around a Google Docs misbehavior where pasted
      // content will be inexplicably wrapped in `<b>` tags with a
      // font-weight normal.
      { tag: "b", getAttrs: (node: HTMLElement) => node.style.fontWeight !== "normal" && null },
      { style: "font-weight=400", clearMark: (m) => m.type.name === "strong" },
      { style: "font-weight", getAttrs: (value: string) => /^(bold(er)?|[5-9]\d{2,})$/.test(value) && null }
    ],
    toDOM() {
      return strongDOM
    }
  }),

  /** Code font mark. Represented as a `<code>` element. */
  code: markSpec({
    code: true,
    parseDOM: [{ tag: "code" }],
    toDOM() {
      return codeDOM
    }
  })
}

/**
 * This schema roughly corresponds to the document schema used by
 * CommonMark, minus the list elements, which are defined in the
 * `schema-list` module.
 *
 * @since 0.1.0
 * @category schemas
 */
export const schema = DocSchema.makeUnsafe({ nodes, marks })

/**
 * @since 0.1.0
 * @category schemas
 */
export type BasicSchema = typeof schema
