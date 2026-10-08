/**
 * Extensions: compose schema specs, plugins, keymaps and commands into
 * a strongly typed editor (in the style of ProseKit/TipTap). Purely
 * additive and unopinionated: no UI, no styling, no required node set.
 *
 * ```ts skip-type-checking
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

/** @since 0.1.0 */
export * from "./extensions/defaults.ts"
/** @since 0.1.0 */
export * from "./extensions/editor.ts"
export {
  /** @since 0.1.0 */
  type AnyExtension,
  /** @since 0.1.0 */
  type CommandArgsOf,
  /** @since 0.1.0 */
  type CommandCreator,
  /** @since 0.1.0 */
  type CommandCreators,
  /** @since 0.1.0 */
  type CommandsError,
  /** @since 0.1.0 */
  type CommandsExtension,
  /** @since 0.1.0 */
  type CommandSignature,
  /** @since 0.1.0 */
  type CommandsRequirements,
  /** @since 0.1.0 */
  type CommandType,
  /** @since 0.1.0 */
  type CommandTypes,
  /** @since 0.1.0 */
  defineCommands,
  /** @since 0.1.0 */
  defineExtension,
  /** @since 0.1.0 */
  defineKeymap,
  /** @since 0.1.0 */
  defineMarkSpec,
  /** @since 0.1.0 */
  defineNodeSpec,
  /** @since 0.1.0 */
  definePlugin,
  /** @since 0.1.0 */
  type EmptyTypes,
  /** @since 0.1.0 */
  Extension,
  /** @since 0.1.0 */
  type ExtensionCommands,
  /** @since 0.1.0 */
  type ExtensionMarks,
  /** @since 0.1.0 */
  type ExtensionNodes,
  /** @since 0.1.0 */
  type ExtensionSpec,
  /** @since 0.1.0 */
  ExtensionTypeId,
  /** @since 0.1.0 */
  type ExtensionTypes,
  /** @since 0.1.0 */
  isExtension,
  /** @since 0.1.0 */
  type MergeTypes,
  /** @since 0.1.0 */
  type PluginInput,
  /** @since 0.1.0 */
  Priority,
  /** @since 0.1.0 */
  type SpecTypes,
  /** @since 0.1.0 */
  type TypesOf,
  /** @since 0.1.0 */
  union,
  /** @since 0.1.0 */
  withPriority
} from "./extensions/extension.ts"
