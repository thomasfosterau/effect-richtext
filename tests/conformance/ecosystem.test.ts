// ProseMirror's own add-on packages, unmodified, on the compat facade: they
// import prosemirror-model, -state, -transform and -view, which resolve to
// the facade here (vite.config.ts, the `conformance` project).
import { afterEach, describe, expect, it } from "@effect/vitest"
import { pasteHTML } from "@prosekit/core/test"
import { ChangeSet } from "@tiptap/pm/changeset"
import { dropCursor } from "@tiptap/pm/dropcursor"
import { GapCursor, gapCursor } from "@tiptap/pm/gapcursor"
import { closeHistory, history, redo, redoDepth, undo, undoDepth } from "@tiptap/pm/history"
import {
  InputRule,
  inputRules,
  smartQuotes,
  textblockTypeInputRule,
  undoInputRule,
  wrappingInputRule
} from "@tiptap/pm/inputrules"
import {
  addColumnAfter,
  addRowAfter,
  CellSelection,
  deleteColumn,
  fixTables,
  mergeCells,
  TableMap,
  tableEditing,
  tableNodes
} from "@tiptap/pm/tables"
import { baseKeymap } from "prosemirror-commands"
import { keymap } from "prosemirror-keymap"
import { type Node, Schema } from "prosemirror-model"
import { schema as basicSchema } from "prosemirror-schema-basic"
import { EditorState, type Plugin, Selection, TextSelection } from "prosemirror-state"
import { doc, p, schema } from "prosemirror-test-builder"
import { EditorView } from "prosemirror-view"
import { defined, typeText } from "./input.ts"

const views: Array<EditorView> = []

const view = (state: EditorState) => {
  const place = document.createElement("div")
  document.body.append(place)
  const v = new EditorView(place, { state })
  views.push(v)
  return v
}

afterEach(() => {
  views.splice(0).forEach((v) => {
    v.destroy()
    v.dom.parentElement?.remove()
  })
})

const stateWith = (content: Node, plugins: ReadonlyArray<Plugin>, pos = 1) =>
  EditorState.create({ doc: content, plugins, selection: TextSelection.create(content, pos) })

describe("prosemirror-history", () => {
  it("undoes and redoes grouped changes", () => {
    let state = stateWith(doc(p("a")), [history()], 2)
    const run = (command: typeof undo) => command(state, (tr) => void (state = state.apply(tr)))
    state = state.apply(state.tr.insertText("b"))
    state = state.apply(state.tr.insertText("c"))
    state = state.apply(closeHistory(state.tr))
    state = state.apply(state.tr.insertText("d"))
    expect(undoDepth(state)).toBe(2)
    expect(run(undo)).toBe(true)
    expect(state.doc.textContent).toBe("abc")
    expect(run(undo)).toBe(true)
    expect(state.doc.textContent).toBe("a")
    expect(redoDepth(state)).toBe(2)
    run(redo)
    expect(state.doc.textContent).toBe("abc")
  })

  it("undoes in a view", () => {
    const v = view(stateWith(doc(p("a")), [history()], 2))
    v.dispatch(v.state.tr.insertText("b"))
    undo(v.state, v.dispatch)
    expect(v.state.doc.textContent).toBe("a")
  })
})

describe("prosemirror-inputrules", () => {
  const rules = inputRules({
    rules: [
      ...smartQuotes,
      wrappingInputRule(/^\s*>\s$/, defined(schema.nodes.blockquote)),
      textblockTypeInputRule(/^(#{1,3})\s$/, defined(schema.nodes.heading), (m) => ({ level: defined(m[1]).length })),
      new InputRule(/--$/, "—")
    ]
  })

  it("wraps, retypes and replaces text", () => {
    const v = view(stateWith(doc(p()), [rules]))
    typeText(v, "> ")
    expect(v.state.doc.firstChild?.type.name).toBe("blockquote")
    const w = view(stateWith(doc(p()), [rules]))
    typeText(w, '## x -- "q"')
    expect(w.state.doc.firstChild?.type.name).toBe("heading")
    expect(w.state.doc.firstChild?.attrs.level).toBe(2)
    expect(w.state.doc.textContent).toBe("x — “q”")
  })

  it("undoes an input rule", () => {
    const v = view(stateWith(doc(p()), [rules]))
    typeText(v, "a--")
    expect(v.state.doc.textContent).toBe("a—")
    expect(undoInputRule(v.state, v.dispatch)).toBe(true)
    expect(v.state.doc.textContent).toBe("a--")
  })
})

const tableOf = (state: EditorState) => defined(state.doc.firstChild)

// A selection from the first cell to the second.
const firstTwoCells = (state: EditorState) => {
  const { map } = TableMap.get(tableOf(state))
  return CellSelection.create(state.doc, defined(map[0]) + 1, defined(map[1]) + 1)
}

describe("prosemirror-tables", () => {
  const tableSchema = new Schema({
    nodes: basicSchema.spec.nodes.append(
      tableNodes({ tableGroup: "block", cellContent: "paragraph+", cellAttributes: {} })
    ),
    marks: basicSchema.spec.marks
  })
  const type = (name: string) => defined(tableSchema.nodes[name])
  const c = (text: string) =>
    type("table_cell").create(null, type("paragraph").create(null, text ? tableSchema.text(text) : null))
  const table = (...rows: Array<Array<string>>) =>
    type("doc").create(
      null,
      type("table").create(
        null,
        rows.map((cells) => type("table_row").create(null, cells.map(c)))
      )
    )
  it("adds and deletes rows and columns", () => {
    let state = EditorState.create({ doc: table(["a", "b"], ["c", "d"]), plugins: [tableEditing()] })
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 4)))
    const run = (command: typeof addRowAfter) => command(state, (tr) => void (state = state.apply(tr)))
    expect(run(addColumnAfter)).toBe(true)
    expect(run(addRowAfter)).toBe(true)
    const map = TableMap.get(tableOf(state))
    expect([map.width, map.height]).toEqual([3, 3])
    expect(run(deleteColumn)).toBe(true)
    expect(TableMap.get(tableOf(state)).width).toBe(2)
  })

  it("selects and merges cells", () => {
    let state = EditorState.create({ doc: table(["a", "b"], ["c", "d"]), plugins: [tableEditing()] })
    state = state.apply(state.tr.setSelection(firstTwoCells(state)))
    expect(state.selection).toBeInstanceOf(CellSelection)
    expect(state.selection).toBeInstanceOf(Selection)
    expect(mergeCells(state, (tr) => void (state = state.apply(tr)))).toBe(true)
    const firstRow = tableOf(state).child(0)
    expect(firstRow.childCount).toBe(1)
    expect(firstRow.child(0).attrs.colspan).toBe(2)
  })

  it("normalizes malformed tables", () => {
    const ragged = table(["a", "b"], ["c"])
    const tr = defined(fixTables(EditorState.create({ doc: ragged })))
    expect(defined(tr.doc.firstChild).child(1).childCount).toBe(2)
  })

  it("renders cell selections in a view", () => {
    const v = view(EditorState.create({ doc: table(["a", "b"]), plugins: [tableEditing()] }))
    v.dispatch(v.state.tr.setSelection(firstTwoCells(v.state)))
    expect(v.dom.querySelectorAll(".selectedCell").length).toBe(2)
  })
})

describe("prosemirror-gapcursor", () => {
  it("places, serializes and maps a gap cursor", () => {
    const content = doc(schema.node("horizontal_rule"), schema.node("horizontal_rule"))
    const state = EditorState.create({ doc: content, plugins: [gapCursor()] })
    const sel = new GapCursor(content.resolve(1))
    expect(sel.visible).toBe(false)
    const next = state.apply(state.tr.setSelection(sel))
    expect(next.selection).toBeInstanceOf(GapCursor)
    expect(Selection.fromJSON(next.doc, next.selection.toJSON())).toBeInstanceOf(GapCursor)
    const v = view(next)
    expect(v.dom.querySelector(".ProseMirror-gapcursor")).not.toBe(null)
  })
})

describe("prosemirror-dropcursor", () => {
  it("mounts and unmounts with a view", () => {
    const v = view(EditorState.create({ doc: doc(p("a")), plugins: [dropCursor()] }))
    expect(v.state.plugins).toHaveLength(1)
  })
})

describe("prosemirror-changeset", () => {
  it("tracks changes over steps", () => {
    const state = stateWith(doc(p("hello")), [], 6)
    const tr = state.tr.insertText(" world").delete(1, 2)
    const set = ChangeSet.create(state.doc).addSteps(tr.doc, tr.mapping.maps, null)
    expect(set.changes.map((ch) => [ch.fromA, ch.toA, ch.fromB, ch.toB])).toEqual([
      [1, 2, 1, 1],
      [6, 6, 5, 11]
    ])
  })
})

describe("prosemirror-view", () => {
  it("handles pasted HTML", () => {
    const v = view(stateWith(doc(p("ab")), [keymap(baseKeymap)], 2))
    pasteHTML(v, "<p>x<strong>y</strong></p>")
    expect(v.state.doc.textContent).toBe("axyb")
    expect(
      defined(v.state.doc.firstChild)
        .child(1)
        .marks.map((m) => m.type.name)
    ).toEqual(["strong"])
  })
})
