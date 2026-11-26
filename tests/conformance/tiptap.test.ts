// TipTap 3 on the compat facade: each scenario drives TipTap's public API the
// way an application does, with every prosemirror-* package TipTap imports
// resolved to the facade (vite.config.ts, the `conformance` project).
import { afterEach, describe, expect, it } from "@effect/vitest"
import { Editor, Extension, InputRule, Mark, mergeAttributes, Node } from "@tiptap/core"
import { CharacterCount, Placeholder } from "@tiptap/extensions"
import { pasteHTML } from "@prosekit/core/test"
import { NodeSelection, TextSelection } from "@tiptap/pm/state"
import { Decoration, DecorationSet } from "@tiptap/pm/view"
import { StarterKit } from "@tiptap/starter-kit"
import * as compatState from "prosemirror-state"
import { keydown, mod, typeText } from "./input.ts"

const editors: Array<Editor> = []

// Without the trailing paragraph StarterKit adds, so the HTML stays short.
const Starter = StarterKit.configure({ trailingNode: false })

const make = (options: Partial<ConstructorParameters<typeof Editor>[0]> = {}) => {
  const element = document.createElement("div")
  document.body.append(element)
  const editor = new Editor({ element, extensions: [Starter], ...options })
  editors.push(editor)
  return editor
}

afterEach(() => {
  editors.splice(0).forEach((editor) => {
    const { element } = editor.options
    editor.destroy()
    if (element instanceof HTMLElement) element.remove()
  })
})

describe("TipTap", () => {
  describe("setup", () => {
    it("runs on the facade's classes", () => {
      const editor = make()
      expect(editor.state).toBeInstanceOf(compatState.EditorState)
      expect(TextSelection).toBe(compatState.TextSelection)
    })

    it("mounts a contenteditable view", () => {
      const editor = make({ content: "<p>Hi</p>" })
      expect(editor.view.dom.getAttribute("contenteditable")).toBe("true")
      expect(editor.view.dom.classList.contains("ProseMirror")).toBe(true)
      expect(editor.view.dom.innerHTML).toContain("<p>Hi</p>")
    })

    it("can be created headless, without an element", () => {
      const editor = new Editor({ element: null, extensions: [Starter], content: "<p>a</p>" })
      editors.push(editor)
      expect(editor.getText()).toBe("a")
    })
  })

  describe("content", () => {
    it("parses and serializes HTML", () => {
      const html =
        "<h2>Title</h2><p>Some <strong>bold</strong>, <em>italic</em> and <code>code</code>.</p>" +
        "<ul><li><p>one</p></li><li><p>two</p></li></ul><blockquote><p>quote</p></blockquote>" +
        '<pre><code class="language-js">let x</code></pre><hr><p>a<br>b</p>'
      expect(make({ content: html }).getHTML()).toBe(html)
    })

    it("round-trips JSON", () => {
      const json = {
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 1, textAlign: null }, content: [{ type: "text", text: "T" }] },
          {
            type: "paragraph",
            content: [
              { type: "text", text: "x" },
              { type: "text", marks: [{ type: "bold" }], text: "y" }
            ]
          }
        ]
      }
      const editor = make({ content: json })
      const again = make({ content: editor.getJSON() })
      expect(again.getJSON()).toEqual(editor.getJSON())
      expect(editor.getText()).toBe("T\n\nxy")
    })

    it("setContent, insertContent and clearContent", () => {
      const editor = make({ content: "<p>one</p>" })
      editor.commands.setContent("<p>two</p>")
      expect(editor.getHTML()).toBe("<p>two</p>")
      editor.commands.focus("end")
      editor.commands.insertContent(" <em>three</em>")
      expect(editor.getHTML()).toBe("<p>two <em>three</em></p>")
      editor.commands.insertContentAt(0, "<h1>head</h1>")
      expect(editor.getHTML()).toBe("<h1>head</h1><p>two <em>three</em></p>")
      editor.commands.clearContent()
      expect(editor.isEmpty).toBe(true)
    })
  })

  describe("commands", () => {
    it("toggles marks over a selection", () => {
      const editor = make({ content: "<p>Hello world</p>" })
      editor.chain().setTextSelection({ from: 7, to: 12 }).toggleBold().run()
      expect(editor.getHTML()).toBe("<p>Hello <strong>world</strong></p>")
      expect(editor.isActive("bold")).toBe(true)
      editor.chain().selectAll().toggleItalic().toggleStrike().run()
      expect(editor.getHTML()).toBe("<p><em><s>Hello </s></em><strong><em><s>world</s></em></strong></p>")
      editor.commands.unsetAllMarks()
      expect(editor.getHTML()).toBe("<p>Hello world</p>")
    })

    it("sets stored marks on an empty selection", () => {
      const editor = make({ content: "<p>ab</p>" })
      editor.chain().setTextSelection(2).toggleBold().run()
      typeText(editor.view, "X")
      expect(editor.getHTML()).toBe("<p>a<strong>X</strong>b</p>")
    })

    it("changes block types", () => {
      const editor = make({ content: "<p>text</p>" })
      editor.chain().setTextSelection(2).toggleHeading({ level: 2 }).run()
      expect(editor.getHTML()).toBe("<h2>text</h2>")
      expect(editor.isActive("heading", { level: 2 })).toBe(true)
      editor.commands.setParagraph()
      expect(editor.getHTML()).toBe("<p>text</p>")
      editor.commands.toggleCodeBlock()
      expect(editor.getHTML()).toBe("<pre><code>text</code></pre>")
    })

    it("wraps and lifts", () => {
      const editor = make({ content: "<p>text</p>" })
      editor.chain().setTextSelection(2).toggleBlockquote().run()
      expect(editor.getHTML()).toBe("<blockquote><p>text</p></blockquote>")
      editor.commands.toggleBlockquote()
      expect(editor.getHTML()).toBe("<p>text</p>")
    })

    it("builds and edits lists", () => {
      const editor = make({ content: "<p>one</p><p>two</p>" })
      editor.chain().selectAll().toggleBulletList().run()
      expect(editor.getHTML()).toBe("<ul><li><p>one</p></li><li><p>two</p></li></ul>")
      editor.chain().setTextSelection(13).sinkListItem("listItem").run()
      expect(editor.getHTML()).toBe("<ul><li><p>one</p><ul><li><p>two</p></li></ul></li></ul>")
      editor.commands.liftListItem("listItem")
      expect(editor.getHTML()).toBe("<ul><li><p>one</p></li><li><p>two</p></li></ul>")
      editor.chain().selectAll().toggleOrderedList().run()
      expect(editor.getHTML()).toBe("<ol><li><p>one</p></li><li><p>two</p></li></ol>")
    })

    it("splits list items with Enter", () => {
      const editor = make({ content: "<ul><li><p>onetwo</p></li></ul>" })
      editor.commands.setTextSelection(6)
      keydown(editor.view, "Enter")
      expect(editor.getHTML()).toBe("<ul><li><p>one</p></li><li><p>two</p></li></ul>")
    })

    it("dry-runs with can()", () => {
      const editor = make({ content: "<pre><code>x</code></pre>" })
      editor.commands.setTextSelection(1)
      expect(editor.can().toggleBold()).toBe(false)
      expect(editor.can().setParagraph()).toBe(true)
      expect(editor.getHTML()).toBe("<pre><code>x</code></pre>")
    })

    it("selects nodes and deletes them", () => {
      const editor = make({ content: "<p>a</p><hr><p>b</p>" })
      editor.commands.setNodeSelection(3)
      expect(editor.state.selection).toBeInstanceOf(NodeSelection)
      editor.commands.deleteSelection()
      expect(editor.getHTML()).toBe("<p>a</p><p>b</p>")
    })

    it("inserts a horizontal rule and a hard break", () => {
      const editor = make({ content: "<p>ab</p>" })
      editor.chain().setTextSelection(2).setHardBreak().run()
      expect(editor.getHTML()).toBe("<p>a<br>b</p>")
      editor.chain().setTextSelection(editor.state.doc.content.size).setHorizontalRule().run()
      expect(editor.getHTML()).toMatch(/^<p>a<br>b<\/p><hr>/)
    })

    it("sets and removes links", () => {
      const editor = make({ content: "<p>site</p>" })
      editor.chain().selectAll().setLink({ href: "https://example.com" }).run()
      expect(editor.getHTML()).toContain('href="https://example.com"')
      editor.chain().selectAll().unsetLink().run()
      expect(editor.getHTML()).toBe("<p>site</p>")
    })
  })

  describe("history", () => {
    it("undoes and redoes", () => {
      const editor = make({ content: "<p>a</p>" })
      editor.chain().focus("end").insertContent("b").run()
      editor.chain().selectAll().toggleBold().run()
      expect(editor.getHTML()).toBe("<p><strong>ab</strong></p>")
      editor.commands.undo()
      expect(editor.getHTML()).toBe("<p>ab</p>")
      editor.commands.undo()
      expect(editor.getHTML()).toBe("<p>a</p>")
      editor.commands.redo()
      expect(editor.getHTML()).toBe("<p>ab</p>")
    })

    it("undoes with Mod-z", () => {
      const editor = make({ content: "<p>a</p>" })
      editor.chain().focus("end").insertContent("b").run()
      keydown(editor.view, "z", mod)
      expect(editor.getHTML()).toBe("<p>a</p>")
    })
  })

  describe("keyboard and input", () => {
    it("runs mark shortcuts", () => {
      const editor = make({ content: "<p>bold</p>" })
      editor.commands.selectAll()
      keydown(editor.view, "b", mod)
      expect(editor.getHTML()).toBe("<p><strong>bold</strong></p>")
    })

    it("runs block input rules", () => {
      const editor = make()
      editor.commands.focus()
      typeText(editor.view, "## Title")
      expect(editor.getHTML()).toBe("<h2>Title</h2>")
    })

    it("runs list and quote input rules", () => {
      const editor = make()
      typeText(editor.view, "- item")
      expect(editor.getHTML()).toBe("<ul><li><p>item</p></li></ul>")
      editor.commands.setContent("")
      typeText(editor.view, "> q")
      expect(editor.getHTML()).toBe("<blockquote><p>q</p></blockquote>")
    })

    it("runs mark input rules", () => {
      const editor = make()
      typeText(editor.view, "a **b** ")
      expect(editor.getHTML()).toBe("<p>a <strong>b</strong> </p>")
    })

    it("joins blocks with Backspace and Delete", () => {
      const editor = make({ content: "<p>a</p><p>b</p><p>c</p>" })
      editor.commands.setTextSelection(4)
      keydown(editor.view, "Backspace")
      expect(editor.getHTML()).toBe("<p>ab</p><p>c</p>")
      editor.commands.setTextSelection(3)
      keydown(editor.view, "Delete")
      expect(editor.getHTML()).toBe("<p>abc</p>")
    })

    it("clears an empty heading at the start with Backspace", () => {
      const editor = make({ content: "<h1></h1>" })
      editor.commands.setTextSelection(1)
      keydown(editor.view, "Backspace")
      expect(editor.getHTML()).toBe("<p></p>")
    })
  })

  describe("events", () => {
    it("emits create, update, selectionUpdate and transaction", () => {
      const seen: Array<string> = []
      const editor = make({
        content: "<p>a</p>",
        onCreate: () => seen.push("create"),
        onUpdate: () => seen.push("update"),
        onSelectionUpdate: () => seen.push("selectionUpdate"),
        onTransaction: () => seen.push("transaction")
      })
      seen.length = 0
      editor.commands.setTextSelection(2)
      editor.commands.insertContent("b")
      expect(seen).toContain("selectionUpdate")
      expect(seen).toContain("update")
      expect(seen).toContain("transaction")
    })
  })

  describe("custom extensions", () => {
    it("defines a node with attributes, parse rules and a node view", () => {
      const Callout = Node.create({
        name: "callout",
        group: "block",
        content: "inline*",
        addAttributes: () => ({ tone: { default: "info" } }),
        parseHTML: () => [{ tag: "div[data-callout]" }],
        renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes({ "data-callout": "" }, HTMLAttributes), 0],
        addNodeView: () => () => {
          const dom = document.createElement("aside")
          const contentDOM = document.createElement("span")
          dom.append(contentDOM)
          return { dom, contentDOM }
        }
      })
      const editor = make({
        extensions: [Starter, Callout],
        content: '<div data-callout tone="warn">careful</div>'
      })
      expect(editor.getHTML()).toBe('<div data-callout="" tone="warn">careful</div>')
      expect(editor.view.dom.querySelector("aside span")?.textContent).toBe("careful")
      editor.commands.setContent("<p>x</p>")
      editor.chain().setTextSelection(1).setNode("callout").run()
      expect(editor.getJSON().content?.[0]).toMatchObject({ type: "callout", attrs: { tone: "info" } })
    })

    it("defines a mark with an input rule", () => {
      const Highlight = Mark.create({
        name: "highlight",
        parseHTML: () => [{ tag: "mark" }],
        renderHTML: ({ HTMLAttributes }) => ["mark", HTMLAttributes, 0],
        addInputRules() {
          return [
            new InputRule({
              find: /==([^=]+)==$/,
              handler: ({ state, range, match }) => {
                const text = match[1] ?? ""
                state.tr.replaceWith(range.from, range.to, state.schema.text(text, [this.type.create()]))
              }
            })
          ]
        }
      })
      const editor = make({ extensions: [Starter, Highlight] })
      typeText(editor.view, "a ==hi==")
      expect(editor.getHTML()).toBe("<p>a <mark>hi</mark></p>")
    })

    it("adds ProseMirror plugins and keyboard shortcuts", () => {
      let applied = 0
      const Counter = Extension.create({
        name: "counter",
        addKeyboardShortcuts: () => ({ "Mod-k": ({ editor }) => editor.commands.insertContent("K") }),
        addProseMirrorPlugins: () => [
          new compatState.Plugin({
            key: new compatState.PluginKey("counter"),
            state: { init: () => 0, apply: (tr, n: number) => (tr.docChanged ? n + 1 : n) },
            view: () => ({ update: () => void applied++ })
          })
        ]
      })
      const editor = make({ extensions: [Starter, Counter], content: "<p>a</p>" })
      editor.commands.focus("end")
      keydown(editor.view, "k", mod)
      expect(editor.getHTML()).toBe("<p>aK</p>")
      expect(new compatState.PluginKey("counter").getState(editor.state)).toBe(undefined)
      expect(applied).toBeGreaterThan(0)
    })

    it("updates and destroys node views", () => {
      const calls: Array<string> = []
      const Box = Node.create({
        name: "box",
        group: "block",
        atom: true,
        addAttributes: () => ({ n: { default: 0 } }),
        parseHTML: () => [{ tag: "div[data-box]" }],
        renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes({ "data-box": "" }, HTMLAttributes)],
        addNodeView:
          () =>
          ({ node }) => {
            const dom = document.createElement("div")
            dom.textContent = `box ${node.attrs.n}`
            return {
              dom,
              update: (next) => {
                if (next.type.name !== "box") return false
                calls.push("update")
                dom.textContent = `box ${next.attrs.n}`
                return true
              },
              selectNode: () => void calls.push("select"),
              destroy: () => void calls.push("destroy")
            }
          }
      })
      const editor = make({ extensions: [Starter, Box], content: '<p>a</p><div data-box n="1"></div>' })
      expect(editor.view.dom.textContent).toContain("box 1")
      editor.commands.command(({ tr }) => (tr.setNodeMarkup(3, undefined, { n: 2 }), true))
      expect(editor.view.dom.textContent).toContain("box 2")
      editor.commands.setNodeSelection(3)
      editor.commands.deleteSelection()
      expect(calls).toEqual(["update", "select", "destroy"])
    })

    it("renders widget decorations from a plugin", () => {
      const Widget = Extension.create({
        name: "widget",
        addProseMirrorPlugins: () => [
          new compatState.Plugin({
            props: {
              decorations: (state) =>
                DecorationSet.create(state.doc, [
                  Decoration.widget(1, () => Object.assign(document.createElement("span"), { className: "w" })),
                  Decoration.inline(1, 2, { class: "hl" })
                ])
            }
          })
        ]
      })
      const editor = make({ extensions: [Starter, Widget], content: "<p>ab</p>" })
      expect(editor.view.dom.querySelector("span.w")).not.toBe(null)
      expect(editor.view.dom.querySelector(".hl")?.textContent).toBe("a")
    })

    it("extends a mark range", () => {
      const editor = make({ content: '<p>go <a href="https://x.test">there</a> now</p>' })
      editor.chain().setTextSelection(6).extendMarkRange("link").run()
      expect([editor.state.selection.from, editor.state.selection.to]).toEqual([4, 9])
    })

    it("handles pasted HTML", () => {
      const editor = make({ content: "<p>ab</p>" })
      editor.commands.setTextSelection(2)
      pasteHTML(editor.view, "<p>x<em>y</em></p>")
      expect(editor.getHTML()).toBe("<p>ax<em>y</em>b</p>")
    })

    it("renders placeholder decorations", () => {
      const editor = make({ extensions: [Starter, Placeholder.configure({ placeholder: "Write…" })] })
      const p = editor.view.dom.querySelector("p")
      expect(p?.getAttribute("data-placeholder")).toBe("Write…")
      expect(p?.classList.contains("is-editor-empty")).toBe(true)
    })

    it("counts characters", () => {
      const editor = make({ extensions: [Starter, CharacterCount.configure({ limit: 5 })], content: "<p>abc</p>" })
      expect(editor.storage.characterCount.characters()).toBe(3)
      editor.chain().focus("end").insertContent("de").run()
      expect(editor.storage.characterCount.characters()).toBe(5)
      editor.commands.insertContent("f")
      expect(editor.getText()).toBe("abcde")
    })
  })

  describe("editable", () => {
    it("toggles editability", () => {
      const editor = make({ content: "<p>a</p>" })
      editor.setEditable(false)
      expect(editor.view.dom.getAttribute("contenteditable")).toBe("false")
      expect(editor.isEditable).toBe(false)
      editor.setEditable(true)
      expect(editor.view.dom.getAttribute("contenteditable")).toBe("true")
    })
  })
})
