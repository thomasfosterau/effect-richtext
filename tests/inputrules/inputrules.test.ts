// Node-level tests for the transactions produced by input rules.
import { describe, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import {
  emDash,
  InputRule,
  openDoubleQuote,
  textblockTypeInputRule,
  wrappingInputRule
} from "effect-richtext/inputrules"
import type { Node } from "effect-richtext/model"
import { EditorState, TextSelection, type Transaction } from "effect-richtext/state"
import { blockquote, doc, eq, h1, h3, li, ol, p, pre, schema, ul } from "effect-richtext/test-builder"
import ist from "../utils/ist.ts"

const nodes = schema.nodes

const stateFor = (d: Node<any>) => {
  const a = (d as any).tag.a as number
  return EditorState.createUnsafe({ doc: d, selection: TextSelection.createUnsafe(d, a) })
}

// Apply a rule the way the plugin does: the text before the cursor plus
// the typed text is matched, and the handler gets the range of the
// matched text that is already in the document.
function apply(rule: InputRule<any, any, any>, d: Node<any>, typed: string): Transaction<any> | null {
  const state = stateFor(d)
  const { $from, from, to } = state.selection
  const textBefore = $from.parent.textBetween(0, $from.parentOffset, null, "￼") + typed
  const match = rule.match.exec(textBefore)
  if (!match) return null
  const result = rule.handler(state, match, from - (match[0].length - typed.length), to)
  if (Effect.isEffect(result)) return Option.getOrNull(Effect.runSync(result as Effect.Effect<any>))
  return Option.isOption(result) ? Option.getOrNull(result) : (result ?? null)
}

describe("wrappingInputRule", () => {
  const quote = wrappingInputRule(/^\s*>\s$/, nodes.blockquote)
  const list = wrappingInputRule(/^(\d+)\.\s$/, nodes.ordered_list, (m) => ({ order: +m[1]! }))
  const bullets = wrappingInputRule(/^\s*([-+*])\s$/, nodes.bullet_list)

  it("wraps the textblock", () => {
    const tr = apply(quote, doc(p(">", "<a>")), " ")!
    ist(tr.doc, doc(blockquote(p())), eq)
  })

  it("keeps the rest of the textblock", () => {
    const tr = apply(quote, doc(p(">", "<a>", "hello")), " ")!
    ist(tr.doc, doc(blockquote(p("hello"))), eq)
  })

  it("adds the needed inner wrappers", () => {
    const tr = apply(bullets, doc(p("-<a>")), " ")!
    ist(tr.doc, doc(ul(li(p()))), eq)
  })

  it("computes attributes from the match", () => {
    const tr = apply(list, doc(p("4.<a>")), " ")!
    ist(tr.doc, doc(ol({ order: 4 }, li(p()))), eq)
  })

  it("joins with a preceding node of the same type", () => {
    const tr = apply(bullets, doc(ul(li(p("a"))), p("*<a>")), " ")!
    ist(tr.doc, doc(ul(li(p("a")), li(p()))), eq)
  })

  it("respects the join predicate", () => {
    const noJoin = wrappingInputRule(/^\s*([-+*])\s$/, nodes.bullet_list, null, () => false)
    const tr = apply(noJoin, doc(ul(li(p("a"))), p("*<a>")), " ")!
    ist(tr.doc, doc(ul(li(p("a"))), ul(li(p()))), eq)
  })

  it("returns null when no wrapping is possible", () => {
    const intoHeading = wrappingInputRule(/^\s*>\s$/, nodes.heading)
    ist(apply(intoHeading, doc(p(">", "<a>")), " "), null)
  })
})

describe("textblockTypeInputRule", () => {
  const heading = textblockTypeInputRule(/^(#{1,6})\s$/, nodes.heading, (m) => ({ level: m[1]!.length }))
  const code = textblockTypeInputRule(/^```$/, nodes.code_block)

  it("changes the textblock's type", () => {
    const tr = apply(heading, doc(p("###<a>")), " ")!
    ist(tr.doc, doc(h3()), eq)
  })

  it("keeps the textblock's content", () => {
    const tr = apply(heading, doc(p("#<a>", "Title")), " ")!
    ist(tr.doc, doc(h1("Title")), eq)
  })

  it("works without attributes", () => {
    const tr = apply(code, doc(p("``<a>")), "`")!
    ist(tr.doc, doc(pre()), eq)
  })

  it("returns null when the type isn't allowed in the parent", () => {
    ist(apply(heading, doc(ul(li(p("#<a>")))), " "), null)
  })
})

describe("string rules", () => {
  it("replace the matched text", () => {
    const tr = apply(emDash, doc(p("a-<a>")), "-")!
    ist(tr.doc, doc(p("a—")), eq)
  })

  it("replace only the first group", () => {
    const tr = apply(openDoubleQuote, doc(p("a <a>")), '"')!
    ist(tr.doc, doc(p("a “")), eq)
  })

  it("replace a group with a suffix", () => {
    const rule = new InputRule(/(:)\)$/, "☺")
    const tr = apply(rule, doc(p("x:<a>")), ")")!
    ist(tr.doc, doc(p("x☺)")), eq)
  })
})
