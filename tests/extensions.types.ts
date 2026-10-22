// Compile-time assertions for `effect-richtext/extensions`. Never executed:
// `vp run check` type-checks this file (tsconfig.test.json), and every
// `@ts-expect-error` directive is an assertion that the statement below it
// must NOT compile.
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

/** `true` exactly when `A` and `B` are the same type. */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
/** Fails to compile unless `T` is `true`. */
type Expect<T extends true> = T

class Svc extends Context.Service<Svc, { readonly n: number }>()("typetest/Svc") {}
class Boom extends Data.TaggedError("Boom")<{}> {}

const basic = defineBasicExtension()
const editor = createEditorUnsafe(basic)
type Sc = typeof editor.schema
type Run = Effect.Effect<boolean, never, never>

// ---- schema: merged node and mark names ------------------------------------

type _nodeNames = Expect<
  Equals<
    NodeNames<Sc>,
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
  >
>
type _markNames = Expect<Equals<keyof ExtensionMarks<typeof basic>, "link" | "em" | "strong" | "code">>

// ---- schema: union intersects specs ----------------------------------------

const small = union(defineDoc(), defineText(), defineParagraph(), defineMarkSpec("bold", {}))
type _unionNodes = Expect<Equals<keyof ExtensionNodes<typeof small>, "doc" | "text" | "paragraph">>
type _unionMarks = Expect<Equals<keyof ExtensionMarks<typeof small>, "bold">>
type _unionCommands = Expect<Equals<keyof ExtensionCommands<typeof small>, never>>

// ---- builders: node attrs and children are typed ---------------------------

const heading = editor.nodes.heading({ level: 2 }, "Title")
type _heading = Expect<Equals<typeof heading, PMNode<Sc, "heading">>>
const headingNoAttrs = editor.nodes.heading("Title")
type _headingNoAttrs = Expect<Equals<typeof headingNoAttrs, PMNode<Sc, "heading">>>
// @ts-expect-error -- `level` is a number
void editor.nodes.heading({ level: "2" })
const image = editor.nodes.image({ src: "x.png" })
// @ts-expect-error -- `src` is required
void editor.nodes.image()
const doc = editor.nodes.doc(editor.nodes.paragraph("a"))
// A doc doesn't contain text or list items directly.
// @ts-expect-error -- text is not a block
void editor.nodes.doc("text")
// @ts-expect-error -- a list item is not a block
void editor.nodes.doc(editor.nodes.list_item(editor.nodes.paragraph()))
// @ts-expect-error -- the basic schema has no table
void editor.nodes.table

// ---- builders: mark builders -----------------------------------------------

const strong = editor.marks.strong()
type _strong = Expect<Equals<typeof strong, Mark<Sc, "strong">>>
const link = editor.marks.link({ href: "https://x" })
// @ts-expect-error -- `href` is required
void editor.marks.link()

// ---- commands: base commands are typed against the merged schema -----------

const toggleStrong = editor.commands.toggleMark("strong")
type _toggleStrong = Expect<Equals<typeof toggleStrong, Run>>
const toggleLink = editor.commands.toggleMark("link", { href: "https://x" })
type _toggleLink = Expect<Equals<typeof toggleLink, Run>>
// @ts-expect-error -- `link` needs its attrs
void editor.commands.toggleMark("link")
// @ts-expect-error -- the schema has no `underline` mark
void editor.commands.toggleMark("underline")
const setHeading = editor.commands.setBlockType("heading", { level: 2 })
type _setHeading = Expect<Equals<typeof setHeading, Run>>
// @ts-expect-error -- `level` is a number
void editor.commands.setBlockType("heading", { level: "2" })
const wrap = editor.commands.wrapInList("bullet_list")
type _wrap = Expect<Equals<typeof wrap, Run>>
const insert = editor.commands.insertText("abc", 1)
type _insert = Expect<Equals<typeof insert, Run>>
// @ts-expect-error -- the text comes first
void editor.commands.insertText(1)
const undo = editor.commands.undo()
type _undo = Expect<Equals<typeof undo, Run>>

// ---- commands: schema-dependent commands reject marks the schema lacks -----

const noMarks = createEditorUnsafe(union(defineDoc(), defineText(), defineParagraph(), defineHistory()))
// @ts-expect-error -- no base commands, so no `toggleMark`
void noMarks.commands.toggleMark
const withBase = createEditorUnsafe(
  union(defineDoc(), defineText(), defineParagraph(), defineMarkSpec("bold", {}), defineBaseCommands())
)
const toggleBold = withBase.commands.toggleMark("bold")
type _toggleBold = Expect<Equals<typeof toggleBold, Run>>
// @ts-expect-error -- the schema has no `strong` mark
void withBase.commands.toggleMark("strong")

// ---- commands: unknown command names are errors ----------------------------

// @ts-expect-error -- unknown command
void editor.commands.doesNotExist
// @ts-expect-error -- unknown command
void editor.can().doesNotExist
// @ts-expect-error -- unknown command
void editor.chain().doesNotExist

// ---- commands: user commands carry their argument types, errors and requirements

const userExt = union(
  basic,
  defineCommands({
    repeat:
      (_text: string, _times: number): Command =>
      () =>
        Effect.succeed(true),
    withService: (): Command<any, Boom, Svc> => () =>
      Effect.flatMap(Effect.service(Svc), (svc) => (svc.n > 0 ? Effect.succeed(true) : Effect.fail(new Boom())))
  })
)
const userProgram = createEditor(userExt)
type _userServices = Expect<Equals<Effect.Services<typeof userProgram>, Svc>>
declare const user: Editor<TypesOf<typeof userExt>>
// @ts-expect-error -- `repeat` takes two arguments
void user.commands.repeat("a")
const repeat = user.commands.repeat("a", 2)
type _repeat = Expect<Equals<typeof repeat, Effect.Effect<boolean, Boom, Svc>>>
const chained = user.chain().repeat("a", 1).toggleMark("em").run()
type _chained = Expect<Equals<typeof chained, Effect.Effect<boolean, Boom, Svc>>>
// @ts-expect-error -- the schema has no `nope` mark
void user.chain().repeat("a", 1).toggleMark("nope")
// @ts-expect-error -- createEditorUnsafe needs R = never
void createEditorUnsafe(userExt)

// ---- plugins: plugin errors and requirements are collected -----------------

const plugin = new Plugin({
  state: {
    init: () => 0,
    apply: (_tr: Transaction, v: number) => Effect.map(Effect.service(Svc), (s) => v + s.n)
  }
})
const pluginExt = union(
  basic,
  definePlugin(plugin),
  definePlugin(() => [plugin])
)
const pluginProgram: Effect.Effect<unknown, unknown, Svc> = createEditor(pluginExt)

// ---- plugins: defineExtension records everything ---------------------------

const noteExt = defineExtension({
  nodes: { note: { content: "text*", group: "block", attrs: { id: Schema.String } } },
  marks: { highlight: {} },
  commands: {
    noop:
      (_n: number): Command =>
      () =>
        Effect.succeed(false)
  }
})
type _noteNodes = Expect<Equals<keyof ExtensionNodes<typeof noteExt>, "note">>
type _noteMarks = Expect<Equals<keyof ExtensionMarks<typeof noteExt>, "highlight">>
type _noteNoop = Expect<Equals<ExtensionCommands<typeof noteExt>["noop"], [_n: number]>>
const noteEditor = createEditorUnsafe(union(basic, noteExt))
const note = noteEditor.nodes.note({ id: "a" }, "text")
// @ts-expect-error -- `id` is required
void noteEditor.nodes.note()

export { doc, image, link, note, pluginProgram, userProgram }
