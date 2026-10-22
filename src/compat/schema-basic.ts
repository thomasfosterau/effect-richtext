/**
 * A `prosemirror-schema-basic`-compatible module: the basic schema
 * specs, built with the compat `Schema`.
 *
 * Ported from prosemirror-schema-basic (MIT, Marijn Haverbeke and others).
 *
 * @since 0.1.0
 */
import { type DOMOutputSpec, type MarkSpec, type NodeSpec, Schema } from "./model.ts"

const pDOM: DOMOutputSpec = ["p", 0],
  blockquoteDOM: DOMOutputSpec = ["blockquote", 0],
  hrDOM: DOMOutputSpec = ["hr"],
  preDOM: DOMOutputSpec = ["pre", ["code", 0]],
  brDOM: DOMOutputSpec = ["br"]

/**
 * Specs for the nodes defined in this schema.
 *
 * @since 0.1.0
 * @category specs
 */
export const nodes = {
  doc: {
    content: "block+"
  } as NodeSpec,

  paragraph: {
    content: "inline*",
    group: "block",
    parseDOM: [{ tag: "p" }],
    toDOM() {
      return pDOM
    }
  } as NodeSpec,

  blockquote: {
    content: "block+",
    group: "block",
    defining: true,
    parseDOM: [{ tag: "blockquote" }],
    toDOM() {
      return blockquoteDOM
    }
  } as NodeSpec,

  horizontal_rule: {
    group: "block",
    parseDOM: [{ tag: "hr" }],
    toDOM() {
      return hrDOM
    }
  } as NodeSpec,

  heading: {
    attrs: { level: { default: 1, validate: "number" } },
    content: "inline*",
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
  } as NodeSpec,

  code_block: {
    content: "text*",
    marks: "",
    group: "block",
    code: true,
    defining: true,
    parseDOM: [{ tag: "pre", preserveWhitespace: "full" }],
    toDOM() {
      return preDOM
    }
  } as NodeSpec,

  text: {
    group: "inline"
  } as NodeSpec,

  image: {
    inline: true,
    attrs: {
      src: { validate: "string" },
      alt: { default: null, validate: "string|null" },
      title: { default: null, validate: "string|null" }
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
  } as NodeSpec,

  hard_break: {
    inline: true,
    group: "inline",
    selectable: false,
    parseDOM: [{ tag: "br" }],
    toDOM() {
      return brDOM
    }
  } as NodeSpec
}

const emDOM: DOMOutputSpec = ["em", 0],
  strongDOM: DOMOutputSpec = ["strong", 0],
  codeDOM: DOMOutputSpec = ["code", 0]

/**
 * Specs for the marks in the schema.
 *
 * @since 0.1.0
 * @category specs
 */
export const marks = {
  link: {
    attrs: {
      href: { validate: "string" },
      title: { default: null, validate: "string|null" }
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
  } as MarkSpec,

  em: {
    parseDOM: [
      { tag: "i" },
      { tag: "em" },
      { style: "font-style=italic" },
      { style: "font-style=normal", clearMark: (m) => m.type.name == "em" }
    ],
    toDOM() {
      return emDOM
    }
  } as MarkSpec,

  strong: {
    parseDOM: [
      { tag: "strong" },
      // This works around a Google Docs misbehavior where
      // pasted content will be inexplicably wrapped in `<b>`
      // tags with a font-weight normal.
      { tag: "b", getAttrs: (node: HTMLElement) => node.style.fontWeight != "normal" && null },
      { style: "font-weight=400", clearMark: (m) => m.type.name == "strong" },
      { style: "font-weight", getAttrs: (value: string) => /^(bold(er)?|[5-9]\d{2,})$/.test(value) && null }
    ],
    toDOM() {
      return strongDOM
    }
  } as MarkSpec,

  code: {
    code: true,
    parseDOM: [{ tag: "code" }],
    toDOM() {
      return codeDOM
    }
  } as MarkSpec
}

/**
 * This schema roughly corresponds to the document schema used by
 * CommonMark, minus the list elements.
 *
 * @since 0.1.0
 * @category schemas
 */
export const schema: Schema<keyof typeof nodes, keyof typeof marks> = new Schema({ nodes, marks })
