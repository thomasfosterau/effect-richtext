// ProseKit on the compat facade: the basic extension (its lists are
// prosemirror-flat-list, its tables prosemirror-tables) driven through
// ProseKit's public API, with the prosemirror-* packages resolved to the
// facade (vite.config.ts, the `conformance` project).
import { afterEach, describe, expect, it } from "@effect/vitest"
import { defineBasicExtension } from "@prosekit/basic"
import {
  createEditor,
  defineKeymap,
  defineMarkSpec,
  defineNodeSpec,
  defineUpdateHandler,
  type Editor,
  union
} from "@prosekit/core"
import { createTestEditor } from "@prosekit/core/test"
import { definePlaceholder } from "@prosekit/extensions/placeholder"
import * as compatState from "prosemirror-state"
import { keydown, mod, typeText } from "./input.ts"

type Mountable = Pick<Editor, "mount" | "unmount">

const mounted: Array<{ editor: Mountable; place: HTMLElement }> = []

const mount = <T extends Mountable>(editor: T): T => {
  const place = document.createElement("div")
  document.body.append(place)
  editor.mount(place)
  mounted.push({ editor, place })
  return editor
}

afterEach(() => {
  mounted.splice(0).forEach(({ editor, place }) => {
    editor.unmount()
    place.remove()
  })
})

const basic = () => mount(createTestEditor({ extension: defineBasicExtension() }))

describe("ProseKit", () => {
  it("runs on the facade's classes", () => {
    const editor = basic()
    expect(editor.state).toBeInstanceOf(compatState.EditorState)
    expect(editor.view.dom.getAttribute("contenteditable")).toBe("true")
  })

  it("builds documents with node builders and selection tags", () => {
    const editor = basic()
    const n = editor.nodes
    editor.set(n.doc(n.paragraph("<a>Hello<b> world")))
    expect(editor.state.selection.from).toBe(1)
    expect(editor.state.selection.to).toBe(6)
    editor.commands.toggleBold()
    expect(editor.getDocHTML()).toBe("<div><p><strong>Hello</strong> world</p></div>")
    expect(editor.marks.bold.isActive()).toBe(true)
  })

  it("sets and reads content as HTML and JSON", () => {
    const editor = basic()
    editor.setContent("<h1>Title</h1><p>a <em>b</em></p>")
    const json = editor.getDocJSON()
    expect(json).toMatchObject({
      type: "doc",
      content: [{ type: "heading", attrs: { level: 1 } }, { type: "paragraph" }]
    })
    const other = basic()
    other.setContent(json)
    expect(other.getDocHTML()).toBe(editor.getDocHTML())
  })

  it("toggles headings and blockquotes", () => {
    const editor = basic()
    const n = editor.nodes
    editor.set(n.doc(n.paragraph("te<a>xt")))
    editor.commands.toggleHeading({ level: 2 })
    expect(editor.nodes.heading.isActive({ level: 2 })).toBe(true)
    editor.commands.toggleHeading({ level: 2 })
    expect(editor.nodes.paragraph.isActive()).toBe(true)
    editor.commands.toggleBlockquote()
    expect(editor.nodes.blockquote.isActive()).toBe(true)
    expect(editor.getDocJSON()).toMatchObject({ content: [{ type: "blockquote", content: [{ type: "paragraph" }] }] })
  })

  it("toggles, indents and splits flat lists", () => {
    const editor = basic()
    const n = editor.nodes
    editor.set(n.doc(n.paragraph("one<a>")))
    editor.commands.toggleList({ kind: "bullet" })
    expect(editor.getDocJSON()).toMatchObject({ content: [{ type: "list", attrs: { kind: "bullet" } }] })
    keydown(editor.view, "Enter")
    typeText(editor.view, "two")
    expect(editor.getDocJSON().content).toHaveLength(2)
    editor.commands.indentList()
    expect(editor.getDocJSON()).toMatchObject({
      content: [{ type: "list", content: [{ type: "paragraph" }, { type: "list" }] }]
    })
    editor.commands.dedentList()
    expect(editor.getDocJSON().content).toHaveLength(2)
  })

  it("inserts and edits tables", () => {
    const editor = basic()
    const n = editor.nodes
    editor.set(n.doc(n.paragraph("<a>")))
    editor.commands.insertTable({ row: 2, col: 2 })
    editor.view.dispatch(editor.state.tr.setSelection(compatState.TextSelection.create(editor.state.doc, 4)))
    const rows = () => editor.view.dom.querySelectorAll("tr").length
    const cols = () => editor.view.dom.querySelector("tr")?.children.length
    expect([rows(), cols()]).toEqual([2, 2])
    editor.commands.addTableRowBelow()
    editor.commands.addTableColumnAfter()
    expect([rows(), cols()]).toEqual([3, 3])
    editor.commands.deleteTable()
    expect(editor.view.dom.querySelector("table")).toBe(null)
  })

  it("undoes and redoes", () => {
    const editor = basic()
    const n = editor.nodes
    editor.set(n.doc(n.paragraph("a<a>")))
    editor.commands.insertText({ text: "b" })
    expect(editor.state.doc.textContent).toBe("ab")
    editor.commands.undo()
    expect(editor.state.doc.textContent).toBe("a")
    editor.commands.redo()
    expect(editor.state.doc.textContent).toBe("ab")
  })

  it("runs input rules", () => {
    const editor = basic()
    const n = editor.nodes
    editor.set(n.doc(n.paragraph("<a>")))
    typeText(editor.view, "## Hi")
    expect(editor.nodes.heading.isActive({ level: 2 })).toBe(true)
    editor.set(n.doc(n.paragraph("<a>")))
    typeText(editor.view, "- item")
    expect(editor.getDocJSON()).toMatchObject({ content: [{ type: "list", attrs: { kind: "bullet" } }] })
  })

  it("runs keymaps, custom specs and update handlers", () => {
    let updates = 0
    const extension = union(
      defineBasicExtension(),
      defineNodeSpec({
        name: "callout",
        group: "block",
        content: "inline*",
        parseDOM: [{ tag: "aside" }],
        toDOM: () => ["aside", 0]
      }),
      defineMarkSpec({ name: "highlight", parseDOM: [{ tag: "mark" }], toDOM: () => ["mark", 0] }),
      defineKeymap({ "Mod-j": (state, dispatch) => (dispatch?.(state.tr.insertText("X")), true) }),
      defineUpdateHandler(() => void updates++)
    )
    const editor = mount(createEditor({ extension }))
    editor.setContent("<aside>note</aside><p><mark>hi</mark></p>")
    expect(editor.getDocHTML()).toBe("<div><aside>note</aside><p><mark>hi</mark></p></div>")
    editor.setContent("<p></p>", "start")
    keydown(editor.view, "j", mod)
    expect(editor.state.doc.textContent).toBe("X")
    expect(updates).toBeGreaterThan(0)
  })

  it("adds and removes extensions at run time", () => {
    const editor = basic()
    const n = editor.nodes
    editor.set(n.doc(n.paragraph("a<a>")))
    const dispose = editor.use(
      defineKeymap({ "Mod-j": (state, dispatch) => (dispatch?.(state.tr.insertText("J")), true) })
    )
    keydown(editor.view, "j", mod)
    expect(editor.state.doc.textContent).toBe("aJ")
    dispose()
    keydown(editor.view, "j", mod)
    expect(editor.state.doc.textContent).toBe("aJ")
  })

  it("renders placeholder decorations", () => {
    const editor = mount(
      createEditor({ extension: union(defineBasicExtension(), definePlaceholder({ placeholder: "Type…" })) })
    )
    editor.setContent("<p></p>", "start")
    expect(editor.view.dom.querySelector("p")?.getAttribute("data-placeholder")).toBe("Type…")
  })
})
