/**
 * Extensions: compose schema specs, plugins, keymaps and commands into
 * a strongly typed editor (in the style of ProseKit/TipTap). Purely
 * additive and unopinionated: no UI, no styling, no required node set.
 *
 * ```ts
 * import { Effect } from "effect"
 * import { createEditor, defineBasicExtension, defineCommands, union } from "effect-richtext/extensions"
 * import type { Command } from "effect-richtext/state"
 *
 * const extension = union(
 *   defineBasicExtension(),
 *   defineCommands({
 *     greet: (name: string): Command => (state, dispatch) =>
 *       dispatch ? Effect.as(dispatch(state.tr.insertTextUnsafe(`Hello ${name}`)), true) : Effect.succeed(true)
 *   })
 * )
 *
 * const program = Effect.gen(function*() {
 *   const editor = yield* createEditor(extension)
 *   const { nodes } = editor
 *   yield* editor.setContent(nodes.doc(nodes.heading({ level: 2 }, "Hello"), nodes.paragraph("world")))
 *   yield* editor.commands.selectAll()
 *   yield* editor.commands.greet("you")
 *   yield* editor.commands.toggleMark("strong") // only "link" | "em" | "strong" | "code" type-check
 *   // One transaction (one undo step) for several commands:
 *   yield* editor.chain().setBlockType("paragraph").toggleMark("em").run()
 *   const canUndo = yield* editor.can().undo()
 *   yield* editor.mount(document.body) // EditorView.make; destroyed with the scope
 * }).pipe(Effect.scoped)
 * ```
 *
 * @since 0.1.0
 */

export * from "./extensions/defaults.ts"
export * from "./extensions/editor.ts"
export {
  type AnyExtension,
  type CommandArgsOf,
  type CommandCreator,
  type CommandCreators,
  type CommandsError,
  type CommandsExtension,
  type CommandSignature,
  type CommandsRequirements,
  type CommandType,
  type CommandTypes,
  defineCommands,
  defineExtension,
  defineKeymap,
  defineMarkSpec,
  defineNodeSpec,
  definePlugin,
  type EmptyTypes,
  Extension,
  type ExtensionCommands,
  type ExtensionMarks,
  type ExtensionNodes,
  type ExtensionSpec,
  ExtensionTypeId,
  type ExtensionTypes,
  isExtension,
  type MergeTypes,
  type PluginInput,
  Priority,
  type SpecTypes,
  type TypesOf,
  union,
  withPriority
} from "./extensions/extension.ts"
