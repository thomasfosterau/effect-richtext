// Ported from prosemirror-markdown/test/test-custom-parser.ts (MIT, Marijn Haverbeke and others)
import { describe, it } from "@effect/vitest"
import { MarkdownParser, schema } from "effect-richtext/markdown"
import type { Node } from "effect-richtext/model"
import { eq } from "effect-richtext/test-builder"
import MarkdownIt from "markdown-it"
import ist from "../utils/ist.ts"
import { br, doc, p } from "./build.ts"

const md = new MarkdownIt("commonmark", { html: false })
const ignoreBlockquoteParser = new MarkdownParser(schema, md, {
  blockquote: { ignore: true },
  paragraph: { block: "paragraph" },
  softbreak: { node: "hard_break" }
})

function parseWith(parser: MarkdownParser<any>) {
  return (text: string, doc: Node<any>) => {
    ist(parser.parseUnsafe(text), doc, eq)
  }
}

describe("custom markdown parser", () => {
  it("ignores a blockquote", () => parseWith(ignoreBlockquoteParser)("> hello!", doc(p("hello!"))))

  it("converts softbreaks to hard_break nodes", () =>
    parseWith(ignoreBlockquoteParser)("hello\nworld!", doc(p("hello", br(), "world!"))))
})
