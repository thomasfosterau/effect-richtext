// Ported from prosemirror-markdown/test/build.ts (MIT, Marijn Haverbeke and others)
import { schema } from "effect-richtext/markdown"
import { builders } from "effect-richtext/test-builder"

const b = builders(schema, {
  p: { nodeType: "paragraph" },
  h1: { nodeType: "heading", level: 1 },
  h2: { nodeType: "heading", level: 2 },
  hr: { nodeType: "horizontal_rule" },
  li: { nodeType: "list_item" },
  ol: { nodeType: "ordered_list" },
  ol3: { nodeType: "ordered_list", order: 3 },
  ul: { nodeType: "bullet_list" },
  pre: { nodeType: "code_block" },
  a: { markType: "link", href: "foo" },
  br: { nodeType: "hard_break" },
  img: { nodeType: "image", src: "img.png", alt: "x" }
})

export const doc = b.doc
export const p = b.p
export const h1 = b.h1
export const h2 = b.h2
export const hr = b.hr
export const li = b.li
export const ol = b.ol
export const ol3 = b.ol3
export const ul = b.ul
export const pre = b.pre
export const blockquote = b.blockquote
export const br = b.br
export const img = b.img
export const a = b.a
export const link = b.link
export const em = b.em
export const strong = b.strong
export const code = b.code
