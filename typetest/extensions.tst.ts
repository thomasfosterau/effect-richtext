import { Context, Data, Effect, Schema } from "effect"
import {
  createEditor,
  createEditorUnsafe,
  defineBaseCommands,
  defineBasicExtension,
  defineCommands,
  defineDoc,
  defineExtension,
  defineHistory,
  defineMarkSpec,
  defineNodeSpec,
  defineParagraph,
  definePlugin,
  defineText,
  type Editor,
  type ExtensionCommands,
  type ExtensionMarks,
  type ExtensionNodes,
  type TypesOf,
  union
} from "effect-richtext/extensions"
import type { Mark, Node as PMNode, NodeNames } from "effect-richtext/model"
import { type Command, Plugin, type Transaction } from "effect-richtext/state"
import { describe, expect, test } from "tstyche"

class Svc extends Context.Service<Svc, { readonly n: number }>()("typetest/Svc") {}
class Boom extends Data.TaggedError("Boom")<{}> {}

const basic = defineBasicExtension()
const editor = createEditorUnsafe(basic)
type Sc = typeof editor.schema

describe("schema", () => {
  test("merged node and mark names", () => {
    expect<NodeNames<Sc>>().type.toBe<
      | "doc"
      | "text"
      | "paragraph"
      | "heading"
      | "blockquote"
      | "horizontal_rule"
      | "code_block"
      | "image"
      | "hard_break"
      | "ordered_list"
      | "bullet_list"
      | "list_item"
    >()
    expect<keyof ExtensionMarks<typeof basic>>().type.toBe<"link" | "em" | "strong" | "code">()
  })

  test("union intersects specs", () => {
    const ext = union(defineDoc(), defineText(), defineParagraph(), defineMarkSpec("bold", {}))
    expect<keyof ExtensionNodes<typeof ext>>().type.toBe<"doc" | "text" | "paragraph">()
    expect<keyof ExtensionMarks<typeof ext>>().type.toBe<"bold">()
    expect<keyof ExtensionCommands<typeof ext>>().type.toBe<never>()
  })
})

describe("builders", () => {
  test("node attrs and children are typed", () => {
    expect(editor.nodes.heading({ level: 2 }, "Title")).type.toBe<PMNode<Sc, "heading">>()
    expect(editor.nodes.heading("Title")).type.toBe<PMNode<Sc, "heading">>()
    expect(editor.nodes.heading).type.not.toBeCallableWith({ level: "2" })
    expect(editor.nodes.image).type.toBeCallableWith({ src: "x.png" })
    expect(editor.nodes.image).type.not.toBeCallableWith()
    expect(editor.nodes.doc).type.toBeCallableWith(editor.nodes.paragraph("a"))
    // A doc doesn't contain text or list items directly.
    expect(editor.nodes.doc).type.not.toBeCallableWith("text")
    expect(editor.nodes.doc).type.not.toBeCallableWith(editor.nodes.list_item(editor.nodes.paragraph()))
    expect(editor.nodes).type.not.toHaveProperty("table")
  })

  test("mark builders", () => {
    expect(editor.marks.strong()).type.toBe<Mark<Sc, "strong">>()
    expect(editor.marks.link).type.toBeCallableWith({ href: "https://x" })
    expect(editor.marks.link).type.not.toBeCallableWith()
  })
})

describe("commands", () => {
  test("base commands are typed against the merged schema", () => {
    expect(editor.commands.toggleMark("strong")).type.toBe<Effect.Effect<boolean, never, never>>()
    expect(editor.commands.toggleMark("link", { href: "https://x" })).type.toBe<Effect.Effect<boolean, never, never>>()
    expect(editor.commands.toggleMark).type.not.toBeCallableWith("link")
    expect(editor.commands.toggleMark).type.not.toBeCallableWith("underline")
    expect(editor.commands.setBlockType("heading", { level: 2 })).type.toBe<Effect.Effect<boolean, never, never>>()
    expect(editor.commands.setBlockType).type.not.toBeCallableWith("heading", { level: "2" })
    expect(editor.commands.wrapInList("bullet_list")).type.toBe<Effect.Effect<boolean, never, never>>()
    expect(editor.commands.insertText("abc", 1)).type.toBe<Effect.Effect<boolean, never, never>>()
    expect(editor.commands.insertText).type.not.toBeCallableWith(1)
    expect(editor.commands.undo()).type.toBe<Effect.Effect<boolean, never, never>>()
  })

  test("schema-dependent commands reject marks the schema lacks", () => {
    const small = createEditorUnsafe(union(defineDoc(), defineText(), defineParagraph(), defineHistory()))
    expect(small.commands).type.not.toHaveProperty("toggleMark")
    const withBase = createEditorUnsafe(
      union(defineDoc(), defineText(), defineParagraph(), defineMarkSpec("bold", {}), defineBaseCommands())
    )
    expect(withBase.commands.toggleMark("bold")).type.toBe<Effect.Effect<boolean, never, never>>()
    expect(withBase.commands.toggleMark).type.not.toBeCallableWith("strong")
  })

  test("unknown command names are errors", () => {
    expect(editor.commands).type.not.toHaveProperty("doesNotExist")
    expect(editor.can()).type.not.toHaveProperty("doesNotExist")
    expect(editor.chain()).type.not.toHaveProperty("doesNotExist")
  })

  test("user commands carry their argument types, errors and requirements", () => {
    const ext = union(
      basic,
      defineCommands({
        repeat: (_text: string, _times: number): Command => () => Effect.succeed(true),
        withService: (): Command<any, Boom, Svc> => () =>
          Effect.flatMap(Effect.service(Svc), (svc) => svc.n > 0 ? Effect.succeed(true) : Effect.fail(new Boom()))
      })
    )
    const program = createEditor(ext)
    expect<Effect.Services<typeof program>>().type.toBe<Svc>()
    type E = Editor<TypesOf<typeof ext>>
    const e = null as unknown as E
    expect(e.commands.repeat).type.not.toBeCallableWith("a")
    expect(e.commands.repeat("a", 2)).type.toBe<Effect.Effect<boolean, Boom, Svc>>()
    expect(e.chain().repeat("a", 1).toggleMark("em").run()).type.toBe<Effect.Effect<boolean, Boom, Svc>>()
    expect(e.chain().repeat("a", 1).toggleMark).type.not.toBeCallableWith("nope")
    // createEditorUnsafe needs R = never
    expect(createEditorUnsafe).type.not.toBeCallableWith(ext)
  })
})

describe("plugins", () => {
  test("plugin errors and requirements are collected", () => {
    const plugin = new Plugin({
      state: {
        init: () => 0,
        apply: (_tr: Transaction, v: number) => Effect.map(Effect.service(Svc), (s) => v + s.n)
      }
    })
    const ext = union(basic, definePlugin(plugin), definePlugin(() => [plugin]))
    expect(createEditor(ext)).type.toBeAssignableTo<Effect.Effect<unknown, unknown, Svc>>()
  })

  test("defineExtension records everything", () => {
    const ext = defineExtension({
      nodes: { note: { content: "text*", group: "block", attrs: { id: Schema.String } } },
      marks: { highlight: {} },
      commands: { noop: (_n: number): Command => () => Effect.succeed(false) }
    })
    expect<keyof ExtensionNodes<typeof ext>>().type.toBe<"note">()
    expect<keyof ExtensionMarks<typeof ext>>().type.toBe<"highlight">()
    expect<ExtensionCommands<typeof ext>["noop"]>().type.toBe<[_n: number]>()
    const e = createEditorUnsafe(union(basic, ext))
    expect(e.nodes.note).type.toBeCallableWith({ id: "a" }, "text")
    expect(e.nodes.note).type.not.toBeCallableWith()
  })
})
