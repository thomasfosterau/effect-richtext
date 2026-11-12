// Ported from prosemirror-transform/test/test-structure.ts (MIT, Marijn Haverbeke and others)
import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { Content, DocSchema, type Node, Slice } from "@thomasfosterau/effect-richtext/model"
import { eq, schema as baseSchema } from "@thomasfosterau/effect-richtext/test-builder"
import { canSplit, findWrapping, liftTarget, Transform } from "@thomasfosterau/effect-richtext/transform"
import ist from "../utils/ist.ts"
import { getSome } from "../utils/option.ts"

const schema = DocSchema.makeUnsafe({
  nodes: {
    doc: { content: Content.parse("head? block* sect* closing?") },
    para: { content: Content.parse("text*"), group: "block" },
    head: { content: Content.parse("text*"), marks: "" },
    figure: { content: Content.parse("caption figureimage"), group: "block" },
    quote: { content: Content.parse("block+"), group: "block" },
    figureimage: {},
    caption: { content: Content.parse("text*"), marks: "" },
    sect: { content: Content.parse("head block* sect*") },
    closing: { content: Content.parse("text*") },
    text: baseSchema.spec.nodes.text,

    fixed: { content: Content.parse("head para closing"), group: "block" }
  },
  marks: {
    em: {}
  }
})

function n(name: string, ...content: Array<Node<any>>) {
  return schema.nodes[name]!.createUnsafe(null, content as any)
}
function t(str: string, em = false) {
  return schema.textUnsafe(str, em ? [schema.markUnsafe("em")] : null)
}

const doc = n(
  "doc", // 0
  n("head", t("Head")), // 6
  n("para", t("Intro")), // 13
  n(
    "sect", // 14
    n("head", t("Section head")), // 28
    n(
      "sect", // 29
      n("head", t("Subsection head")), // 46
      n("para", t("Subtext")), // 55
      n(
        "figure", // 56
        n("caption", t("Figure caption")), // 72
        n("figureimage")
      ), // 74
      n("quote", n("para", t("!")))
    )
  ), // 81
  n(
    "sect", // 82
    n("head", t("S2")), // 86
    n("para", t("Yes"))
  ), // 92
  n("closing", t("fin"))
) // 97

function range(pos: number, end?: number) {
  return doc.resolveUnsafe(pos).blockRange(end == null ? undefined : doc.resolveUnsafe(end))
}

function yesInCansplit(pos: number, depth?: number, after?: string) {
  return () => ist(canSplit(doc, pos, depth, after == null ? undefined : [{ type: schema.nodes[after]! }]))
}

function noInCansplit(pos: number, depth?: number, after?: string) {
  return () => ist(!canSplit(doc, pos, depth, after == null ? undefined : [{ type: schema.nodes[after]! }]))
}

describe("canSplit", () => {
  it("can't at start", noInCansplit(0))
  it("can't in head", noInCansplit(3))
  it("can by making head a para", yesInCansplit(3, 1, "para"))
  it("can't on top level", noInCansplit(6))
  it("can in regular para", yesInCansplit(8))
  it("can't at start of section", noInCansplit(14))
  it("can't in section head", noInCansplit(17))
  it("can if also splitting the section", yesInCansplit(17, 2))
  it("can if making the remaining head a para", yesInCansplit(18, 1, "para"))
  it("can't after the section head", noInCansplit(46))
  it("can in the first section para", yesInCansplit(48))
  it("can't in the figure caption", noInCansplit(60))
  it("can't if it also splits the figure", noInCansplit(62, 2))
  it("can't after the figure caption", noInCansplit(72))
  it("can in the first para in a quote", yesInCansplit(76))
  it("can if it also splits the quote", yesInCansplit(77, 2))
  it("can't at the end of the document", noInCansplit(97))

  it("doesn't return true when the split-off content doesn't fit in the given node type", () => {
    const { doc: _doc, ...rest } = schema.spec.nodes
    const s = DocSchema.makeUnsafe({
      nodes: {
        doc: { content: Content.parse("chapter+") },
        title: { content: Content.parse("text*") },
        ...rest,
        chapter: { content: Content.parse("title scene+") },
        scene: { content: Content.parse("para+") }
      }
    })
    ist(
      !canSplit(
        s.nodeUnsafe(
          "doc",
          null,
          s.nodeUnsafe("chapter", null, [
            s.nodeUnsafe("title", null, s.textUnsafe("title")),
            s.nodeUnsafe("scene", null, s.nodeUnsafe("para", null, s.textUnsafe("scene")))
          ])
        ),
        4,
        1,
        [{ type: s.nodes.scene }]
      )
    )
  })
})

function yesInLifttarget(pos: number) {
  return () => {
    const r = range(pos)
    ist(Option.isSome(r) && Option.isSome(liftTarget(r.value)))
  }
}

function noInLifttarget(pos: number) {
  return () => {
    const r = range(pos)
    ist(!(Option.isSome(r) && Option.getOrNull(liftTarget(r.value))))
  }
}

describe("liftTarget", () => {
  it("can't at the start of the doc", noInLifttarget(0))
  it("can't in the heading", noInLifttarget(3))
  it("can't in a subsection para", noInLifttarget(52))
  it("can't in a figure caption", noInLifttarget(70))
  it("can from a quote", yesInLifttarget(76))
  it("can't in a section head", noInLifttarget(86))

  it("notices unliftable content after or before", () => {
    const s = DocSchema.makeUnsafe({
      nodes: {
        doc: { content: Content.parse("section+") },
        section: { content: Content.parse("heading? p+") },
        heading: { content: Content.parse("p+") },
        p: { content: Content.parse("text*") },
        text: { inline: true }
      }
    })
    const p = s.nodeUnsafe("p", null, [s.textUnsafe("A")])
    const d = s.nodeUnsafe("doc", null, [s.nodeUnsafe("section", null, [s.nodeUnsafe("heading", null, [p, p, p]), p])])
    const block = (a: number, b?: number) =>
      getSome(d.resolveUnsafe(a).blockRange(b === undefined ? undefined : d.resolveUnsafe(b)))
    ist(Option.getOrNull(liftTarget(block(3))), null)
    ist(Option.getOrNull(liftTarget(block(6))), null)
    ist(Option.getOrNull(liftTarget(block(3, 6))), null)
    ist(Option.getOrNull(liftTarget(block(9))), 1)
  })
})

function yesInFindwrapping(pos: number, end: number, type: string) {
  return () => {
    const r = range(pos, end)
    ist(Option.isSome(r) && Option.isSome(findWrapping(r.value, schema.nodes[type]!)))
  }
}

function noInFindwrapping(pos: number, end: number, type: string) {
  return () => {
    const r = range(pos, end)
    ist(Option.isNone(r) || Option.isNone(findWrapping(r.value, schema.nodes[type]!)))
  }
}

describe("findWrapping", () => {
  it("can wrap the whole doc in a section", yesInFindwrapping(0, 92, "sect"))
  it("can't wrap a head before a para in a section", noInFindwrapping(4, 4, "sect"))
  it("can wrap a top paragraph in a quote", yesInFindwrapping(8, 8, "quote"))
  it("can't wrap a section head in a quote", noInFindwrapping(18, 18, "quote"))
  it("can wrap a figure in a quote", yesInFindwrapping(55, 74, "quote"))
  it("can't wrap a head in a figure", noInFindwrapping(90, 90, "figure"))
})

function repl(
  doc: Node<any>,
  from: number,
  to: number,
  content: Node<any> | null,
  openStart: number,
  openEnd: number,
  result: Node<any>
) {
  return () => {
    const slice = content ? new Slice(content.content, openStart, openEnd) : Slice.empty
    const tr = new Transform(doc).replaceUnsafe(from, to, slice)
    ist(tr.doc, result, eq)
  }
}

describe("Transform", () => {
  describe("replace", () => {
    it(
      "automatically adds a heading to a section",
      repl(
        n("doc", n("sect", n("head", t("foo")), n("para", t("bar")))),
        6,
        6,
        n("doc", n("sect"), n("sect")),
        1,
        1,
        n("doc", n("sect", n("head", t("foo"))), n("sect", n("head"), n("para", t("bar"))))
      )
    )

    it(
      "suppresses impossible inputs",
      repl(
        n("doc", n("para", t("a")), n("para", t("b"))),
        3,
        3,
        n("doc", n("closing", t("."))),
        0,
        0,
        n("doc", n("para", t("a")), n("para", t("b")))
      )
    )

    it(
      "adds necessary nodes to the left",
      repl(
        n("doc", n("sect", n("head", t("foo")), n("para", t("bar")))),
        1,
        3,
        n("doc", n("sect"), n("sect", n("head", t("hi")))),
        1,
        2,
        n("doc", n("sect", n("head")), n("sect", n("head", t("hioo")), n("para", t("bar"))))
      )
    )

    it(
      "adds a caption to a figure",
      repl(
        n("doc"),
        0,
        0,
        n("doc", n("figure", n("figureimage"))),
        1,
        0,
        n("doc", n("figure", n("caption"), n("figureimage")))
      )
    )

    it(
      "adds an image to a figure",
      repl(
        n("doc"),
        0,
        0,
        n("doc", n("figure", n("caption"))),
        0,
        1,
        n("doc", n("figure", n("caption"), n("figureimage")))
      )
    )

    it(
      "can join figures",
      repl(
        n("doc", n("figure", n("caption"), n("figureimage")), n("figure", n("caption"), n("figureimage"))),
        3,
        8,
        null,
        0,
        0,
        n("doc", n("figure", n("caption"), n("figureimage")))
      )
    )

    it(
      "adds necessary nodes to a parent node",
      repl(
        n("doc", n("sect", n("head"), n("figure", n("caption"), n("figureimage")))),
        7,
        9,
        n("doc", n("para", t("hi"))),
        0,
        0,
        n("doc", n("sect", n("head"), n("figure", n("caption"), n("figureimage")), n("para", t("hi"))))
      )
    )
  })

  it.effect("reports invalid positions through the Effect API", () =>
    Effect.gen(function* () {
      const tr = new Transform(n("doc", n("para", t("a"))))
      const err = yield* Effect.flip(tr.replace(1, 200))
      assert.strictEqual(err._tag, "PositionError")
      ist(tr.steps.length, 0)
    })
  )
})
