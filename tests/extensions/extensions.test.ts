import { assert, describe, it } from "@effect/vitest"
import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import {
  createEditor,
  createEditorUnsafe,
  defineBaseCommands,
  defineBasicExtension,
  defineCommands,
  defineDoc,
  defineExtension,
  defineHistory,
  defineKeymap,
  defineMarkSpec,
  defineNodeSpec,
  defineParagraph,
  definePlugin,
  defineText,
  type Editor,
  type ExtensionTypes,
  Priority,
  union,
  withPriority
} from "effect-richtext/extensions"
import { undoDepth } from "effect-richtext/history"
import { Content } from "effect-richtext/model"
import { type Command, Plugin, TextSelection, Transaction } from "effect-richtext/state"
import ist from "../utils/ist.ts"
import { getSome } from "../utils/option.ts"

const select = <T extends ExtensionTypes>(editor: Editor<T>, anchor: number, head = anchor) =>
  editor.dispatch(editor.state.tr.setSelectionUnsafe(TextSelection.createUnsafe(editor.state.doc, anchor, head)))

const named = (name: string) => new Plugin({ name })
const pluginNames = (editor: Editor<any>) => editor.state.plugins.map((p) => p.spec.name).filter(Boolean)

const minimal = () => union(defineDoc(), defineText(), defineParagraph())

describe("union and priorities", () => {
  it("builds the schema in priority, then declaration order", () => {
    const editor = createEditorUnsafe(
      union(
        defineDoc(),
        defineText(),
        defineNodeSpec("quote", { group: "block", content: Content.oneOrMore("block") }),
        defineParagraph(), // highest priority
        withPriority(defineNodeSpec("aside", { group: "block", content: Content.oneOrMore("block") }), Priority.high),
        defineMarkSpec("a", {}),
        withPriority(defineMarkSpec("b", {}), Priority.high)
      )
    )
    assert.deepStrictEqual(Object.keys(editor.schema.nodes), ["paragraph", "aside", "doc", "text", "quote"])
    assert.deepStrictEqual(Object.keys(editor.schema.marks), ["b", "a"])
    // The paragraph is the default block.
    ist(editor.state.doc.firstChild.pipe(getSome).type.name, "paragraph")
  })

  it("orders plugins and keymaps by priority", () => {
    const editor = createEditorUnsafe(
      union(
        minimal(),
        definePlugin(named("default1")),
        withPriority(definePlugin(named("lowest")), Priority.lowest),
        union(
          definePlugin(named("default2")),
          withPriority(union(definePlugin(named("high1")), definePlugin(named("high2"))), Priority.high)
        ),
        withPriority(
          definePlugin(() => [named("highest")]),
          Priority.highest
        )
      )
    )
    assert.deepStrictEqual(pluginNames(editor), ["highest", "high1", "high2", "default1", "default2", "lowest"])
  })

  it("inner priorities override outer ones", () => {
    const editor = createEditorUnsafe(
      union(
        minimal(),
        definePlugin(named("default")),
        withPriority(
          union(definePlugin(named("low")), withPriority(definePlugin(named("high")), Priority.high)),
          Priority.low
        )
      )
    )
    assert.deepStrictEqual(pluginNames(editor), ["high", "default", "low"])
  })

  it("uses an extension included twice once", () => {
    const plugin = definePlugin(named("once"))
    const editor = createEditorUnsafe(union(minimal(), plugin, union(plugin, minimal())))
    assert.deepStrictEqual(pluginNames(editor), ["once"])
  })

  it("merges specs with the same name, higher priority winning", () => {
    const editor = createEditorUnsafe(
      union(
        minimal(),
        defineMarkSpec("color", { attrs: { color: { default: "red" } }, spanning: false }),
        withPriority(defineMarkSpec("color", { attrs: { alpha: { default: 1 } }, inclusive: true }), Priority.high)
      )
    )
    const mark = editor.marks.color()
    assert.deepStrictEqual({ ...mark.attrs }, { color: "red", alpha: 1 })
    ist(editor.schema.marks.color.spec.inclusive, true)
    ist(editor.schema.marks.color.spec.spanning, false)
  })

  it("lets higher-priority commands win", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const cmd = (name: string) => (): Command => () => Effect.sync(() => (log.push(name), true))
      const editor = createEditorUnsafe(
        union(
          minimal(),
          defineCommands({ hello: cmd("default") }),
          withPriority(defineCommands({ hello: cmd("high") }), Priority.high)
        )
      )
      yield* editor.commands.hello()
      assert.deepStrictEqual(log, ["high"])
    }).pipe(Effect.runSync))

  it("fails with a SchemaDefinitionError for invalid schemas", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(createEditor(union(defineDoc(), defineParagraph())))
      ist(Exit.isFailure(exit))
      const error = Exit.findErrorOption(exit).pipe(getSome)
      ist(error._tag, "SchemaDefinitionError")
    }).pipe(Effect.runSync))
})

describe("Editor", () => {
  it("creates a default document and builds typed nodes and marks", () => {
    const editor = createEditorUnsafe(defineBasicExtension())
    ist(editor.state.doc.toString(), "doc(paragraph)")
    const { nodes, marks } = editor
    const doc = nodes.doc(
      nodes.heading({ level: 2 }, "Title"),
      nodes.paragraph("a ", editor.text("b", marks.strong()), nodes.image({ src: "x.png" })),
      nodes.bullet_list(nodes.list_item(nodes.paragraph("item")))
    )
    ist(
      doc.toString(),
      `doc(heading("Title"), paragraph("a ", strong("b"), image), bullet_list(list_item(paragraph("item"))))`
    )
    ist(nodes.heading("x").attrs.level, 1)
    ist.throws(() => (nodes.doc as any)("text"), "Invalid content")
    ist.throws(() => (marks.link as any)(), "No value supplied")
  })

  it("accepts initial content as a node, JSON or HTML", () =>
    Effect.gen(function* () {
      const ext = defineBasicExtension()
      const fromHTML = yield* createEditor(ext, { doc: "<h2>Hi</h2><p>there</p>" })
      ist(fromHTML.state.doc.toString(), `doc(heading("Hi"), paragraph("there"))`)
      ist((fromHTML.state.doc.childUnsafe(0).attrs as any).level, 2)
      const fromJSON = yield* createEditor(ext, { doc: fromHTML.getDocJSON() })
      assert.deepStrictEqual(fromJSON.getDocJSON(), fromHTML.getDocJSON())
      const fromNode = yield* createEditor(ext, {
        doc: fromJSON.state.doc as any,
        selection: (doc) => TextSelection.atEnd(doc)
      })
      ist(fromNode.state.selection.from, fromNode.state.doc.content.size - 1)
      // Nodes of another schema are converted.
      ist(fromNode.state.doc.type.schema, fromNode.schema)
      const bad = yield* Effect.exit(createEditor(ext, { doc: { type: "nope" } }))
      ist(Exit.isFailure(bad))
    }).pipe(Effect.runSync))

  it("runs commands against the current state", () =>
    Effect.gen(function* () {
      const editor = createEditorUnsafe(defineBasicExtension(), { doc: "<p>hello</p>" })
      ist(yield* editor.commands.insertText("!", 6))
      ist(editor.state.doc.toString(), `doc(paragraph("hello!"))`)
      yield* select(editor, 1, 6)
      ist(yield* editor.commands.toggleMark("strong"))
      ist(editor.state.doc.toString(), `doc(paragraph(strong("hello"), "!"))`)
      ist(yield* editor.commands.setBlockType("heading", { level: 3 }))
      ist(editor.state.doc.toString(), `doc(heading(strong("hello"), "!"))`)
      ist((editor.state.doc.childUnsafe(0).attrs as any).level, 3)
      ist(yield* editor.commands.wrapIn("blockquote"))
      ist(editor.state.doc.toString(), `doc(blockquote(heading(strong("hello"), "!")))`)
      ist(yield* editor.commands.lift())
      yield* select(editor, 7)
      ist(yield* editor.commands.insertNode("horizontal_rule"))
      ist(editor.state.doc.toString(), `doc(heading(strong("hello"), "!"), horizontal_rule)`)
      ist(yield* editor.commands.selectAll())
      ist(editor.state.selection.to, editor.state.doc.content.size)
      // Commands referring to types the schema lacks don't apply.
      const untyped = editor.commands as unknown as Record<string, (name: string) => Effect.Effect<boolean>>
      ist(!(yield* untyped.toggleMark!("underline")))
      ist(!(yield* untyped.setBlockType!("table")))
    }).pipe(Effect.runSync))

  it("checks commands with can() without dispatching", () =>
    Effect.gen(function* () {
      const editor = createEditorUnsafe(defineBasicExtension(), { doc: "<p>hello</p>" })
      const before = editor.state
      ist(yield* editor.can().setBlockType("heading", { level: 1 }))
      ist(yield* editor.can().wrapInList("bullet_list"))
      ist(!(yield* editor.can().undo()))
      ist(!(yield* editor.can().joinUp()))
      ist(editor.state, before)
      yield* editor.commands.insertText("x", 1)
      ist(yield* editor.can().undo())
    }).pipe(Effect.runSync))

  it("applies chained commands as one transaction", () =>
    Effect.gen(function* () {
      const editor = createEditorUnsafe(defineBasicExtension(), { doc: "<p>hello</p>" })
      const before = editor.state
      const ok = yield* editor
        .chain()
        .insertText(" world", 6)
        .setBlockType("heading", { level: 2 })
        .selectAll()
        .toggleMark("em")
        .run()
      ist(ok)
      ist(editor.state.doc.toString(), `doc(heading(em("hello world")))`)
      ist(undoDepth(editor.state), 1)
      ist(yield* editor.commands.undo())
      ist(editor.state.doc.eq(before.doc))
    }).pipe(Effect.runSync))

  it("lets chained commands see earlier steps and reports failing ones", () =>
    Effect.gen(function* () {
      const seen: Array<string> = []
      const editor = createEditorUnsafe(
        union(
          defineBasicExtension(),
          defineCommands({
            record: (): Command => (state) =>
              Effect.sync(() => {
                seen.push(`${state.doc.textContent}@${state.selection.from}`)
                return true
              }),
            // Dispatches a transaction of its own (not created from
            // `state.tr`), which is folded into the chain's transaction.
            appendOwn:
              (text: string): Command =>
              (state, dispatch) => {
                if (!dispatch) return Effect.succeed(true)
                const own = new Transaction(state).insertTextUnsafe(text, state.doc.content.size - 1)
                return Effect.as(dispatch(own), true)
              }
          })
        ),
        { doc: "<p>ab</p>", selection: (doc) => TextSelection.atEnd(doc) }
      )
      const ok = yield* editor
        .chain()
        .record()
        .insertText("c")
        .record()
        .joinUp() // doesn't apply
        .appendOwn("d")
        .record()
        .run()
      ist(!ok)
      assert.deepStrictEqual(seen, ["ab@3", "abc@4", "abcd@5"])
      ist(editor.state.doc.toString(), `doc(paragraph("abcd"))`)
      ist(undoDepth(editor.state), 1)
    }).pipe(Effect.runSync))

  it("doesn't dispatch empty chains", () =>
    Effect.gen(function* () {
      const editor = createEditorUnsafe(defineBasicExtension())
      const before = editor.state
      ist(!(yield* editor.chain().joinUp().run()))
      ist(editor.state, before)
      ist(yield* editor.chain().run())
    }).pipe(Effect.runSync))

  it("replaces content with setContent, undoably", () =>
    Effect.gen(function* () {
      const editor = createEditorUnsafe(defineBasicExtension(), { doc: "<p>one</p>" })
      yield* editor.setContent("<h1>two</h1>")
      ist(editor.state.doc.toString(), `doc(heading("two"))`)
      yield* editor.setContent(editor.nodes.doc(editor.nodes.paragraph("three")))
      ist(editor.state.doc.toString(), `doc(paragraph("three"))`)
      yield* editor.setContent({
        type: "doc",
        content: [{ type: "code_block", content: [{ type: "text", text: "4" }] }]
      })
      assert.deepStrictEqual(editor.getDocJSON(), {
        type: "doc",
        content: [{ type: "code_block", content: [{ type: "text", text: "4" }] }]
      })
      // Changes in quick succession are grouped by the history.
      ist(yield* editor.commands.undo())
      ist(editor.state.doc.toString(), `doc(paragraph("one"))`)
      const exit = yield* Effect.exit(editor.setContent({ type: "doc", content: [{ type: "table" }] }))
      ist(Exit.isFailure(exit))
    }).pipe(Effect.runSync))
})

class Step extends Context.Service<Step, { readonly size: number }>()("test/Step") {}
class Rejected extends Data.TaggedError("Rejected")<{}> {}

describe("Effect requirements and errors", () => {
  const counter = new Plugin({
    state: {
      init: () => 0,
      apply: (_tr: Transaction, n: number) => Effect.map(Effect.service(Step), (s) => n + s.size)
    }
  })

  it("collects plugin requirements and provides them to commands", () =>
    Effect.gen(function* () {
      const editor = yield* createEditor(union(defineBasicExtension(), definePlugin(counter)))
      yield* editor.commands.insertText("a")
      yield* editor.chain().insertText("b").insertText("c").run()
      ist(getSome(counter.getState(editor.state)), 4)
    }).pipe(Effect.provide(Layer.succeed(Step, { size: 2 })), Effect.runSync))

  it("propagates plugin and command failures", () =>
    Effect.gen(function* () {
      const editor = createEditorUnsafe(
        union(
          defineBasicExtension(),
          definePlugin(
            new Plugin({
              filterTransaction: (tr: Transaction) =>
                tr.doc.textContent.includes("!") ? Effect.fail(new Rejected()) : true
            })
          ),
          defineExtension({
            commands: { fail: (): Command<any, Rejected> => () => Effect.fail(new Rejected()) }
          })
        )
      )
      const viaPlugin = yield* Effect.exit(editor.commands.insertText("!"))
      ist(Exit.isFailure(viaPlugin))
      ist(Exit.findErrorOption(viaPlugin).pipe(getSome)._tag, "Rejected")
      ist(editor.state.doc.textContent, "")
      const viaCommand = yield* Effect.exit(editor.commands.fail())
      ist(Exit.findErrorOption(viaCommand).pipe(getSome)._tag, "Rejected")
      const viaChain = yield* Effect.exit(editor.chain().insertText("a").insertText("!").run())
      ist(Exit.isFailure(viaChain))
      ist(editor.state.doc.textContent, "")
    }).pipe(Effect.runSync))

  it("supports keymaps with the base keymap at low priority", () => {
    const editor = createEditorUnsafe(
      union(defineBasicExtension(), defineKeymap({ Enter: () => Effect.succeed(true) }))
    )
    // The list and history keymaps, the user's keymap, then the base keymap.
    ist(editor.state.plugins.filter((p) => p.props.handleKeyDown).length, 4)
  })

  it("rejects including the history twice", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(createEditor(union(minimal(), defineHistory(), defineHistory())))
      ist(Exit.isFailure(exit))
      ist(Exit.findErrorOption(exit).pipe(getSome)._tag, "StateError")
    }).pipe(Effect.runSync))

  it("works with only the base commands", () =>
    Effect.gen(function* () {
      const editor = createEditorUnsafe(union(minimal(), defineMarkSpec("bold", {}), defineBaseCommands()))
      yield* editor.commands.insertText("x")
      yield* select(editor, 1, 2)
      ist(yield* editor.commands.toggleMark("bold"))
      ist(editor.state.doc.toString(), `doc(paragraph(bold("x")))`)
    }).pipe(Effect.runSync))
})
