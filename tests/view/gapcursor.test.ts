// Ported from prosemirror-gapcursor/test/test-gapcursor.ts (MIT, Marijn Haverbeke and others),
// plus tests for the plugin.
import { describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { GapCursor, gapCursor, gapCursorCSS } from "effect-richtext/gapcursor"
import { Content, DocSchema, type Node } from "effect-richtext/model"
import { EditorState, NodeSelection, Selection, TextSelection } from "effect-richtext/state"
import { doc, eq, hr, p } from "effect-richtext/test-builder"
import { StepMap } from "effect-richtext/transform"
import { injectCSSUnsafe } from "effect-richtext/view-css"
import ist from "../utils/ist.ts"
import { getSome } from "../utils/option.ts"
import { tempEditor } from "./helpers.ts"

const schema = DocSchema.makeUnsafe({
  nodes: {
    doc: { content: Content.parse("block+") },
    text: { group: "inline" },
    paragraph: { group: "block", content: Content.parse("inline*") },
    section: { group: "block", content: Content.parse("block+") },
    maybe_section: { group: "block", content: Content.parse("block*") },
    atom_block: { group: "block", atom: true, selectable: true }
  },
  marks: {}
})

function docWith(...content: Array<Node<any>>) {
  return schema.nodeUnsafe("doc", null, content as any)
}

describe("GapCursor.valid", () => {
  it("allows a gap cursor at the start and end of a document when adjacent to an atom block", () => {
    const doc = docWith(schema.nodeUnsafe("atom_block"))

    ist(GapCursor.valid(doc.resolveUnsafe(0)))
    ist(GapCursor.valid(doc.resolveUnsafe(doc.content.size)))
  })

  it("disallows a gap cursor at the start and end of a document when adjacent to a textblock", () => {
    const doc = docWith(schema.nodeUnsafe("paragraph", null, [schema.textUnsafe("hi")]))

    ist(GapCursor.valid(doc.resolveUnsafe(0)), false)
    ist(GapCursor.valid(doc.resolveUnsafe(doc.content.size)), false)
  })

  it("allows a gap cursor at the start and end of a block when adjacent to an atom block", () => {
    const section = schema.nodeUnsafe("section", null, [schema.nodeUnsafe("atom_block")])
    const doc = docWith(section)

    const sectionStart = doc.resolveUnsafe(1)
    const sectionEnd = doc.resolveUnsafe(1 + section.content.size)

    ist(sectionStart.parent.type.name, "section")
    ist(sectionEnd.parent.type.name, "section")
    ist(GapCursor.valid(sectionStart))
    ist(GapCursor.valid(sectionEnd))
  })

  it("allows a gap cursor in an empty block", () => {
    const section = schema.nodeUnsafe("maybe_section")
    const doc = docWith(section)

    const maybeSectionStart = doc.resolveUnsafe(1)
    const maybeSectionEnd = doc.resolveUnsafe(1 + section.content.size)

    ist(maybeSectionStart.parent.type.name, "maybe_section")
    ist(maybeSectionEnd.parent.type.name, "maybe_section")
    ist(GapCursor.valid(maybeSectionStart))
    ist(GapCursor.valid(maybeSectionEnd))
  })
})

describe("GapCursor", () => {
  const d = doc(p("foo"), hr(), hr())
  // Between the two horizontal rules
  const between = 6

  it("finds gap cursor positions", () => {
    ist(getSome(GapCursor.findGapCursorFrom(d.resolveUnsafe(between), 1)).pos, between)
    ist(getSome(GapCursor.findGapCursorFrom(d.resolveUnsafe(7), -1)).pos, 7)
    // Selectable atoms stop the search
    ist(Option.isNone(GapCursor.findGapCursorFrom(d.resolveUnsafe(5), 1)))
    ist(Option.isNone(GapCursor.findGapCursorFrom(d.resolveUnsafe(between), 1, true)))
  })

  it("roundtrips through JSON", () => {
    const sel = new GapCursor(d.resolveUnsafe(between))
    const json = sel.toJSON()
    ist(json.type, "gapcursor")
    const back = Effect.runSync(Selection.fromJSON(d, json))
    ist(back instanceof GapCursor)
    ist(back.eq(sel))
  })

  it("rejects invalid JSON", () => {
    ist(Effect.runSync(Effect.exit(Selection.fromJSON(d, { type: "gapcursor" })))._tag, "Failure")
  })

  it("maps through changes", () => {
    const sel = new GapCursor(d.resolveUnsafe(between))
    const mapped = sel.map(doc(p(), p("foo"), hr(), hr()), new StepMap([0, 0, 2]))
    ist(mapped instanceof GapCursor)
    ist(mapped.head, between + 2)
  })

  it("falls back to a nearby selection when mapped to an invalid position", () => {
    const sel = new GapCursor(d.resolveUnsafe(between))
    const d2 = doc(p("foo"), p("bar"))
    const mapped = sel.map(d2, new StepMap([0, 0, 0]))
    ist(!(mapped instanceof GapCursor))
  })

  it("has a bookmark that resolves to a gap cursor", () => {
    const sel = new GapCursor(d.resolveUnsafe(between))
    const resolved = sel.getBookmark().resolve(d)
    ist(resolved instanceof GapCursor)
    ist(resolved.head, between)
  })

  it("is invisible and has empty content", () => {
    const sel = new GapCursor(d.resolveUnsafe(between))
    ist(!sel.visible)
    ist(sel.content().size, 0)
  })

  it("can be replaced with content", () => {
    const state = EditorState.createUnsafe({ doc: d, selection: new GapCursor(d.resolveUnsafe(between)) })
    const tr = state.tr.insertTextUnsafe("x")
    ist(tr.doc, doc(p("foo"), hr(), p("x"), hr()), eq)
  })
})

const keyDown = (view: { dom: HTMLElement }, key: string, keyCode: number) => {
  const event = new KeyboardEvent("keydown", { key, keyCode, bubbles: true, cancelable: true } as KeyboardEventInit)
  view.dom.dispatchEvent(event)
  return event
}

describe("gapCursor plugin", () => {
  it("draws a gap cursor", () => {
    const remove = injectCSSUnsafe(document, gapCursorCSS)
    try {
      const view = tempEditor({ doc: doc(p("foo"), hr(), hr()), plugins: [gapCursor()] })
      ist(view.dom.querySelector(".ProseMirror-gapcursor"), null)
      view.dispatchUnsafe(view.state.tr.setSelectionUnsafe(new GapCursor(view.state.doc.resolveUnsafe(6))))
      const cursor = view.dom.querySelector(".ProseMirror-gapcursor") as HTMLElement
      ist(cursor)
      ist(getComputedStyle(cursor).position, "absolute")
      view.dispatchUnsafe(view.state.tr.setSelectionUnsafe(TextSelection.createUnsafe(view.state.doc, 1)))
      ist(view.dom.querySelector(".ProseMirror-gapcursor"), null)
    } finally {
      remove()
    }
  })

  it("moves into gaps with the arrow keys", () => {
    const view = tempEditor({ doc: doc(p("foo"), hr(), hr()), plugins: [gapCursor()] })
    view.dispatchUnsafe(view.state.tr.setSelectionUnsafe(NodeSelection.createUnsafe(view.state.doc, 5)))
    ist(keyDown(view, "ArrowRight", 39).defaultPrevented)
    ist(view.state.selection instanceof GapCursor)
    ist(view.state.selection.head, 6)
    view.dispatchUnsafe(view.state.tr.setSelectionUnsafe(NodeSelection.createUnsafe(view.state.doc, 6)))
    ist(keyDown(view, "ArrowRight", 39).defaultPrevented)
    ist(view.state.selection instanceof GapCursor)
    ist(view.state.selection.head, 7)
    view.dispatchUnsafe(view.state.tr.setSelectionUnsafe(NodeSelection.createUnsafe(view.state.doc, 6)))
    ist(keyDown(view, "ArrowLeft", 37).defaultPrevented)
    ist(view.state.selection instanceof GapCursor)
    ist(view.state.selection.head, 6)
  })

  it("moves into gaps with vertical arrows", () => {
    const view = tempEditor({ doc: doc(hr(), p("foo")), plugins: [gapCursor()] })
    view.dispatchUnsafe(view.state.tr.setSelectionUnsafe(NodeSelection.createUnsafe(view.state.doc, 0)))
    ist(keyDown(view, "ArrowUp", 38).defaultPrevented)
    ist(view.state.selection instanceof GapCursor)
    ist(view.state.selection.head, 0)
  })

  it("leaves arrow keys inside text alone", () => {
    const view = tempEditor({ doc: doc(p("f<a>oo"), hr()), plugins: [gapCursor()] })
    ist(!keyDown(view, "ArrowRight", 39).defaultPrevented)
    ist(view.state.selection instanceof TextSelection)
  })

  it("creates gap cursors from DOM selections", () => {
    const view = tempEditor({ doc: doc(hr(), hr()), plugins: [gapCursor()] })
    const $pos = view.state.doc.resolveUnsafe(1)
    const sel = view.someProp("createSelectionBetween", (f) => f.call(null, view, $pos, $pos))
    ist(sel instanceof GapCursor)
    const $text = doc(p("foo")).resolveUnsafe(1)
    ist(
      view.someProp("createSelectionBetween", (f) => f.call(null, view, $text, $text)),
      undefined
    )
  })

  it("creates an inline context when composition starts at a gap cursor", () => {
    const view = tempEditor({ doc: doc(hr(), hr()), plugins: [gapCursor()] })
    view.dispatchUnsafe(view.state.tr.setSelectionUnsafe(new GapCursor(view.state.doc.resolveUnsafe(1))))
    const event = new InputEvent("beforeinput", { inputType: "insertCompositionText", bubbles: true, cancelable: true })
    view.dom.dispatchEvent(event)
    ist(view.state.doc, doc(hr(), p(), hr()), eq)
    ist(view.state.selection instanceof TextSelection)
    ist(view.state.selection.head, 2)
  })
})
