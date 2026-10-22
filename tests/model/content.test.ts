// Ported from prosemirror-model/test/test-content.ts (MIT, Marijn Haverbeke and others)
import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { Content, type ContentExpr, ContentMatch, DocSchema, type Node } from "effect-richtext/model"
import { br, doc, eq, h1, hr, img, p, pre, schema } from "effect-richtext/test-builder"
import ist from "../utils/ist.ts"
import { getSome } from "../utils/option.ts"

function compile(expr: ContentExpr<string>): ContentMatch {
  return ContentMatch.compile(expr, schema.nodes, "test")
}

function get(expr: string): ContentMatch {
  return compile(Content.parse(expr))
}

function matchTypes(m: ContentMatch | null, types: string): ContentMatch | null {
  const ts = types ? types.split(" ").map((t) => schema.nodes[t]!) : []
  for (let i = 0; m && i < ts.length; i++) m = Option.getOrNull(m.matchType(ts[i]!))
  return m
}

function match(expr: string, types: string): boolean {
  const m = matchTypes(get(expr), types)
  return m !== null && m.validEnd
}

function valid(expr: string, types: string) {
  ist(match(expr, types))
}
function invalid(expr: string, types: string) {
  ist(!match(expr, types))
}

function fill(expr: string, before: Node, after: Node, result: Node | null) {
  const filled = getSome(get(expr).matchFragment(before.content)).fillBefore(after.content, true)
  if (result) ist(getSome(filled), result.content, eq)
  else ist(Option.isNone(filled))
}

function fill3(expr: string, before: Node, mid: Node, after: Node, left: Node | null, right?: Node) {
  const content = get(expr)
  const a = Option.getOrNull(getSome(content.matchFragment(before.content)).fillBefore(mid.content))
  const b =
    a &&
    Option.getOrNull(
      getSome(content.matchFragment(before.content.append(a).append(mid.content))).fillBefore(after.content, true)
    )
  if (left) {
    ist(a!, left.content, eq)
    ist(b!, right!.content, eq)
  } else {
    ist(!b)
  }
}

describe("ContentMatch", () => {
  describe("matchType", () => {
    it("accepts empty content for the empty expr", () => valid("", ""))
    it("doesn't accept content in the empty expr", () => invalid("", "image"))

    it("matches nothing to an asterisk", () => valid("image*", ""))
    it("matches one element to an asterisk", () => valid("image*", "image"))
    it("matches multiple elements to an asterisk", () => valid("image*", "image image image image"))
    it("only matches appropriate elements to an asterisk", () => invalid("image*", "image text"))

    it("matches group members to a group", () => valid("inline*", "image text"))
    it("doesn't match non-members to a group", () => invalid("inline*", "paragraph"))
    it("matches an element to a choice expression", () => valid("(paragraph | heading)", "paragraph"))
    it("doesn't match unmentioned elements to a choice expr", () => invalid("(paragraph | heading)", "image"))

    it("matches a simple sequence", () =>
      valid("paragraph horizontal_rule paragraph", "paragraph horizontal_rule paragraph"))
    it("fails when a sequence is too long", () =>
      invalid("paragraph horizontal_rule", "paragraph horizontal_rule paragraph"))
    it("fails when a sequence is too short", () =>
      invalid("paragraph horizontal_rule paragraph", "paragraph horizontal_rule"))
    it("fails when a sequence starts incorrectly", () =>
      invalid("paragraph horizontal_rule", "horizontal_rule paragraph horizontal_rule"))

    it("accepts a sequence asterisk matching zero elements", () => valid("heading paragraph*", "heading"))
    it("accepts a sequence asterisk matching multiple elts", () =>
      valid("heading paragraph*", "heading paragraph paragraph"))
    it("accepts a sequence plus matching one element", () => valid("heading paragraph+", "heading paragraph"))
    it("accepts a sequence plus matching multiple elts", () =>
      valid("heading paragraph+", "heading paragraph paragraph"))
    it("fails when a sequence plus has no elements", () => invalid("heading paragraph+", "heading"))
    it("fails when a sequence plus misses its start", () => invalid("heading paragraph+", "paragraph paragraph"))

    it("accepts an optional element being present", () => valid("image?", "image"))
    it("accepts an optional element being missing", () => valid("image?", ""))
    it("fails when an optional element is present twice", () => invalid("image?", "image image"))

    it("accepts a nested repeat", () => valid("(heading paragraph+)+", "heading paragraph heading paragraph paragraph"))
    it("fails on extra input after a nested repeat", () =>
      invalid("(heading paragraph+)+", "heading paragraph heading paragraph paragraph horizontal_rule"))

    it("accepts a matching count", () => valid("hard_break{2}", "hard_break hard_break"))
    it("rejects a count that comes up short", () => invalid("hard_break{2}", "hard_break"))
    it("rejects a count that has too many elements", () => invalid("hard_break{2}", "hard_break hard_break hard_break"))
    it("accepts a count on the lower bound", () => valid("hard_break{2, 4}", "hard_break hard_break"))
    it("accepts a count on the upper bound", () =>
      valid("hard_break{2, 4}", "hard_break hard_break hard_break hard_break"))
    it("accepts a count between the bounds", () => valid("hard_break{2, 4}", "hard_break hard_break hard_break"))
    it("rejects a sequence with too few elements", () => invalid("hard_break{2, 4}", "hard_break"))
    it("rejects a sequence with too many elements", () =>
      invalid("hard_break{2, 4}", "hard_break hard_break hard_break hard_break hard_break"))
    it("rejects a sequence with a bad element after it", () =>
      invalid("hard_break{2, 4} text*", "hard_break hard_break image"))
    it("accepts a sequence with a matching element after it", () =>
      valid("hard_break{2, 4} image?", "hard_break hard_break image"))
    it("accepts an open range", () => valid("hard_break{2,}", "hard_break hard_break"))
    it("accepts an open range matching many", () =>
      valid("hard_break{2,}", "hard_break hard_break hard_break hard_break"))
    it("rejects an open range with too few elements", () => invalid("hard_break{2,}", "hard_break"))
  })

  describe("fillBefore", () => {
    it("returns the empty fragment when things match", () =>
      fill("paragraph horizontal_rule paragraph", doc(p(), hr()), doc(p()), doc()))

    it("adds a node when necessary", () => fill("paragraph horizontal_rule paragraph", doc(p()), doc(p()), doc(hr())))

    it("accepts an asterisk across the bound", () => fill("hard_break*", p(br()), p(br()), p()))

    it("accepts an asterisk only on the left", () => fill("hard_break*", p(br()), p(), p()))

    it("accepts an asterisk only on the right", () => fill("hard_break*", p(), p(br()), p()))

    it("accepts an asterisk with no elements", () => fill("hard_break*", p(), p(), p()))

    it("accepts a plus across the bound", () => fill("hard_break+", p(br()), p(br()), p()))

    it("adds an element for a content-less plus", () => fill("hard_break+", p(), p(), p(br())))

    it("fails for a mismatched plus", () => fill("hard_break+", p(), p(img()), null))

    it("accepts asterisk with content on both sides", () => fill("heading* paragraph*", doc(h1()), doc(p()), doc()))

    it("accepts asterisk with no content after", () => fill("heading* paragraph*", doc(h1()), doc(), doc()))

    it("accepts plus with content on both sides", () => fill("heading+ paragraph+", doc(h1()), doc(p()), doc()))

    it("accepts plus with no content after", () => fill("heading+ paragraph+", doc(h1()), doc(), doc(p())))

    it("adds elements to match a count", () => fill("hard_break{3}", p(br()), p(br()), p(br())))

    it("fails when there are too many elements", () => fill("hard_break{3}", p(br(), br()), p(br(), br()), null))

    it("adds elements for two counted groups", () =>
      fill("code_block{2} paragraph{2}", doc(pre()), doc(p()), doc(pre(), p())))

    it("doesn't include optional elements", () =>
      fill("heading paragraph? horizontal_rule", doc(h1()), doc(), doc(hr())))

    it("completes a sequence", () =>
      fill3(
        "paragraph horizontal_rule paragraph horizontal_rule paragraph",
        doc(p()),
        doc(p()),
        doc(p()),
        doc(hr()),
        doc(hr())
      ))

    it("accepts plus across two bounds", () =>
      fill3("code_block+ paragraph+", doc(pre()), doc(pre()), doc(p()), doc(), doc()))

    it("fills a plus from empty input", () =>
      fill3("code_block+ paragraph+", doc(), doc(), doc(), doc(), doc(pre(), p())))

    it("completes a count", () =>
      fill3("code_block{3} paragraph{3}", doc(pre()), doc(p()), doc(), doc(pre(), pre()), doc(p(), p())))

    it("fails on non-matching elements", () => fill3("paragraph*", doc(p()), doc(pre()), doc(p()), null))

    it("completes a plus across two bounds", () => fill3("paragraph{4}", doc(p()), doc(p()), doc(p()), doc(), doc(p())))

    it("refuses to complete an overflown count across two bounds", () =>
      fill3("paragraph{2}", doc(p()), doc(p()), doc(p()), null))
  })
})

// -----------------------------------------------------------------------------
// Typed content combinators (effect-richtext specific)
// -----------------------------------------------------------------------------

const samples = [
  "",
  "paragraph",
  "heading",
  "image",
  "hard_break",
  "text",
  "image text",
  "heading paragraph",
  "heading paragraph paragraph",
  "paragraph paragraph",
  "paragraph horizontal_rule",
  "paragraph horizontal_rule paragraph",
  "heading paragraph heading paragraph paragraph",
  "hard_break hard_break",
  "hard_break hard_break hard_break",
  "hard_break hard_break hard_break hard_break",
  "hard_break hard_break hard_break hard_break hard_break",
  "hard_break hard_break image",
  "image image"
]

const equivalences: ReadonlyArray<readonly [string, ContentExpr<string>]> = [
  ["image*", Content.zeroOrMore("image")],
  ["inline*", Content.zeroOrMore("inline")],
  ["(paragraph | heading)", Content.choice("paragraph", "heading")],
  ["paragraph horizontal_rule paragraph", Content.seq("paragraph", "horizontal_rule", "paragraph")],
  ["heading paragraph+", Content.seq("heading", Content.oneOrMore("paragraph"))],
  ["image?", Content.optional("image")],
  ["(heading paragraph+)+", Content.oneOrMore(Content.seq("heading", Content.oneOrMore("paragraph")))],
  ["hard_break{2}", Content.repeat("hard_break", 2)],
  ["hard_break{2, 4} image?", Content.seq(Content.repeat("hard_break", 2, 4), Content.optional("image"))],
  ["hard_break{2,}", Content.repeat("hard_break", 2, Infinity)],
  ["hard_break{2, 4} text*", Content.seq(Content.repeat("hard_break", 2, 4), Content.zeroOrMore("text"))]
]

describe("Content combinators", () => {
  for (const [source, expr] of equivalences) {
    it(`${source} matches like its string equivalent`, () => {
      const fromString = get(source),
        fromCombinators = compile(expr)
      for (const sample of samples) {
        const a = matchTypes(fromString, sample),
          b = matchTypes(fromCombinators, sample)
        assert.strictEqual(a === null, b === null, `matchability of "${sample}"`)
        if (a && b) assert.strictEqual(a.validEnd, b.validEnd, `validEnd of "${sample}"`)
      }
      assert.strictEqual(fromString.toString(), fromCombinators.toString())
    })
  }

  it("treats a bare name like a reference", () => {
    assert.strictEqual(compile(Content.ref("paragraph")).toString(), get("paragraph").toString())
  })

  it("compiles the empty sequence to the empty match", () => {
    assert.strictEqual(compile(Content.seq()), ContentMatch.empty)
    assert.strictEqual(get(""), ContentMatch.empty)
  })

  describe("format", () => {
    it("formats combinators in ProseMirror syntax", () => {
      assert.strictEqual(Content.format(Content.zeroOrMore("image")), "image*")
      assert.strictEqual(Content.format("paragraph"), "paragraph")
      assert.strictEqual(Content.format(Content.choice("paragraph", "heading")), "paragraph | heading")
      assert.strictEqual(Content.format(Content.seq("heading", Content.oneOrMore("paragraph"))), "heading paragraph+")
      assert.strictEqual(
        Content.format(Content.oneOrMore(Content.seq("heading", Content.oneOrMore("paragraph")))),
        "(heading paragraph+)+"
      )
      assert.strictEqual(Content.format(Content.zeroOrMore(Content.choice("text", "image"))), "(text | image)*")
      assert.strictEqual(Content.format(Content.seq(Content.choice("a", "b"), "c")), "(a | b) c")
      assert.strictEqual(Content.format(Content.repeat("hard_break", 2)), "hard_break{2}")
      assert.strictEqual(Content.format(Content.repeat("hard_break", 2, 4)), "hard_break{2,4}")
      assert.strictEqual(Content.format(Content.repeat("hard_break", 2, Infinity)), "hard_break{2,}")
      assert.strictEqual(Content.format(Content.optional("image")), "image?")
    })

    it("round-trips through parse", () => {
      for (const source of [
        "image*",
        "paragraph | heading",
        "heading paragraph+",
        "(heading paragraph+)+",
        "hard_break{2,4} image?",
        "hard_break{2,}",
        "(text | image)* hard_break{3}"
      ]) {
        assert.strictEqual(Content.format(Content.parse(source)), source)
      }
      for (const [, expr] of equivalences) {
        assert.strictEqual(Content.format(Content.parse(Content.format(expr))), Content.format(expr))
      }
    })
  })

  describe("errors", () => {
    it("rejects syntax errors in parsed expressions", () => {
      ist.throws(() => Content.parse("paragraph{"), /Expected number/)
      ist.throws(() => Content.parse("(paragraph"), /Missing closing paren/)
      ist.throws(() => Content.parse("paragraph{2"), /Unclosed braced range/)
      ist.throws(() => Content.parse("paragraph )"), /Unexpected trailing text/)
    })

    it("tags syntax errors as SchemaDefinitionError", () => {
      try {
        Content.parse("(paragraph")
        assert.fail("expected a throw")
      } catch (e) {
        assert.strictEqual((e as { _tag: string })._tag, "SchemaDefinitionError")
      }
    })

    it.effect("fails schema creation for unknown names", () =>
      Effect.gen(function* () {
        const err = yield* Effect.flip(
          DocSchema.make({
            nodes: { doc: { content: Content.oneOrMore("nope") }, text: {} }
          })
        )
        assert.strictEqual(err._tag, "SchemaDefinitionError")
        assert.match(err.message, /No node type or group 'nope' found/)
      })
    )

    it.effect("fails schema creation for mixed inline and block content", () =>
      Effect.gen(function* () {
        const err = yield* Effect.flip(
          DocSchema.make({
            nodes: {
              doc: { content: Content.zeroOrMore(Content.choice("paragraph", "text")) },
              paragraph: { content: Content.zeroOrMore("text") },
              text: {}
            }
          })
        )
        assert.strictEqual(err._tag, "SchemaDefinitionError")
        assert.match(err.message, /Mixing inline and block content/)
      })
    )

    it.effect("fails schema creation for invalid ranges", () =>
      Effect.gen(function* () {
        const err = yield* Effect.flip(
          DocSchema.make({
            nodes: {
              doc: { content: Content.repeat("paragraph", 3, 2) },
              paragraph: { content: Content.zeroOrMore("text") },
              text: {}
            }
          })
        )
        assert.strictEqual(err._tag, "SchemaDefinitionError")
        assert.match(err.message, /Invalid repetition range/)
      })
    )

    it.effect("fails schema creation for required non-generatable nodes", () =>
      Effect.gen(function* () {
        const err = yield* Effect.flip(
          DocSchema.make({
            nodes: {
              doc: { content: Content.oneOrMore("image") },
              image: { inline: true, attrs: { src: {} } },
              text: {}
            }
          })
        )
        assert.strictEqual(err._tag, "SchemaDefinitionError")
        assert.match(err.message, /Only non-generatable nodes/)
      })
    )
  })
})
