/**
 * Ready-made extensions wrapping the core modules: base schema nodes
 * and marks, base commands and keymap, history and lists.
 *
 * @since 0.1.0
 */
import * as Effect from "effect/Effect"
import {
  baseKeymap,
  deleteSelection,
  joinBackward,
  joinDown,
  joinForward,
  joinUp,
  lift,
  selectAll,
  selectParentNode,
  setBlockType,
  splitBlock,
  toggleMark,
  type ToggleMarkOptions,
  wrapIn
} from "../commands.ts"
import { history, type HistoryOptions, redo, undo } from "../history.ts"
import {
  type AttrsOptional,
  Content,
  type MarkAttrsInput,
  type MarkNames,
  type MarkSpecOf,
  type NodeAttrsInput,
  type NodeNames,
  type NodeSpecOf,
  type NodeType
} from "../model.ts"
import { marks as basicMarks, nodes as basicNodes } from "../schema-basic.ts"
import { addListNodes, liftListItem, sinkListItem, splitListItem, wrapInList } from "../schema-list.ts"
import type { Command } from "../state.ts"
import {
  type CommandsExtension,
  type CommandSignature,
  defineCommands,
  defineKeymap,
  defineMarkSpec,
  defineNodeSpec,
  definePlugin,
  Priority,
  union,
  withPriority
} from "./extension.ts"

const succeedFalse: Effect.Effect<boolean> = Effect.succeed(false)

// A command that looks up a node or mark type by name in the state's
// schema, and doesn't apply when the schema has no such type.
const byNodeName =
  (name: string, f: (type: NodeType<any, any>) => Command<any>): Command<any> =>
  (state, dispatch, view) => {
    const type = state.schema.nodes[name]
    return type ? f(type)(state, dispatch, view) : succeedFalse
  }

// -----------------------------------------------------------------------------
// Schema
// -----------------------------------------------------------------------------

/**
 * The top-level `doc` node, containing one or more `block` nodes.
 *
 * @since 0.1.0
 * @category nodes
 */
export const defineDoc = () => defineNodeSpec("doc", { content: Content.oneOrMore("block") })

/**
 * The `text` node (in the `inline` group).
 *
 * @since 0.1.0
 * @category nodes
 */
export const defineText = () => defineNodeSpec("text", { group: "inline" })

/**
 * The `paragraph` node (`<p>`). It has the highest priority, so that it
 * is the first (and thus default) node of the `block` group.
 *
 * @since 0.1.0
 * @category nodes
 */
export const defineParagraph = () => withPriority(defineNodeSpec("paragraph", basicNodes.paragraph), Priority.highest)

/**
 * The `heading` node, with a `level` attribute (`<h1>`–`<h6>`).
 *
 * @since 0.1.0
 * @category nodes
 */
export const defineHeading = () => defineNodeSpec("heading", basicNodes.heading)

/**
 * The `blockquote` node.
 *
 * @since 0.1.0
 * @category nodes
 */
export const defineBlockquote = () => defineNodeSpec("blockquote", basicNodes.blockquote)

/**
 * The `horizontal_rule` node.
 *
 * @since 0.1.0
 * @category nodes
 */
export const defineHorizontalRule = () => defineNodeSpec("horizontal_rule", basicNodes.horizontal_rule)

/**
 * The `code_block` node.
 *
 * @since 0.1.0
 * @category nodes
 */
export const defineCodeBlock = () => defineNodeSpec("code_block", basicNodes.code_block)

/**
 * The inline `image` node.
 *
 * @since 0.1.0
 * @category nodes
 */
export const defineImage = () => defineNodeSpec("image", basicNodes.image)

/**
 * The inline `hard_break` node.
 *
 * @since 0.1.0
 * @category nodes
 */
export const defineHardBreak = () => defineNodeSpec("hard_break", basicNodes.hard_break)

/**
 * The `link` mark.
 *
 * @since 0.1.0
 * @category marks
 */
export const defineLink = () => defineMarkSpec("link", basicMarks.link)

/**
 * The `em` mark.
 *
 * @since 0.1.0
 * @category marks
 */
export const defineEm = () => defineMarkSpec("em", basicMarks.em)

/**
 * The `strong` mark.
 *
 * @since 0.1.0
 * @category marks
 */
export const defineStrong = () => defineMarkSpec("strong", basicMarks.strong)

/**
 * The `code` mark.
 *
 * @since 0.1.0
 * @category marks
 */
export const defineCode = () => defineMarkSpec("code", basicMarks.code)

// -----------------------------------------------------------------------------
// Base commands and keymap
// -----------------------------------------------------------------------------

type MarkArgs<Sc, M extends string> =
  AttrsOptional<MarkSpecOf<Sc, M>> extends true
    ? [attrs?: MarkAttrsInput<Sc, M> | null, options?: ToggleMarkOptions]
    : [attrs: MarkAttrsInput<Sc, M>, options?: ToggleMarkOptions]

type NodeArgs<Sc, N extends string> =
  AttrsOptional<NodeSpecOf<Sc, N>> extends true
    ? [attrs?: NodeAttrsInput<Sc, N> | null]
    : [attrs: NodeAttrsInput<Sc, N>]

/**
 * `toggleMark(name, attrs?, options?)`: toggles a mark of the editor's
 * schema, by name.
 *
 * @since 0.1.0
 * @category type-level
 */
export interface ToggleMarkCommand extends CommandSignature {
  readonly signature: <M extends MarkNames<this["Schema"]>>(
    mark: M,
    ...args: MarkArgs<this["Schema"], M>
  ) => this["Return"]
}

/**
 * A command taking a node name of the editor's schema and its
 * attributes (`setBlockType`, `wrapIn`, `insertNode`).
 *
 * @since 0.1.0
 * @category type-level
 */
export interface NodeTypeCommand extends CommandSignature {
  readonly signature: <N extends NodeNames<this["Schema"]>>(
    node: N,
    ...args: NodeArgs<this["Schema"], N>
  ) => this["Return"]
}

/**
 * The commands added by `defineBaseCommands`.
 *
 * @since 0.1.0
 * @category type-level
 */
export type BaseCommands = {
  readonly toggleMark: ToggleMarkCommand
  readonly setBlockType: NodeTypeCommand
  readonly wrapIn: NodeTypeCommand
  readonly insertNode: NodeTypeCommand
  readonly insertText: readonly [text: string, from?: number, to?: number]
  readonly deleteSelection: readonly []
  readonly selectAll: readonly []
  readonly selectParentNode: readonly []
  readonly joinUp: readonly []
  readonly joinDown: readonly []
  readonly joinBackward: readonly []
  readonly joinForward: readonly []
  readonly lift: readonly []
  readonly splitBlock: readonly []
}

const insertNode =
  (type: NodeType<any, any>, attrs: any): Command<any> =>
  (state, dispatch) =>
    Effect.suspend(() => {
      const { $from } = state.selection
      let applies = false
      for (let d = $from.depth; d >= 0 && !applies; d--) {
        const index = $from.index(d)
        applies = $from.node(d).canReplaceWith(index, index, type)
      }
      const node = applies ? type.createAndFillOrNull(attrs) : null
      if (!node) return succeedFalse
      return dispatch
        ? Effect.as(dispatch(state.tr.replaceSelectionWith(node).scrollIntoView()), true)
        : Effect.succeed(true)
    })

/**
 * Commands wrapping the core editing commands. Node and mark types are
 * referenced by name and typed against the editor's final schema:
 * `editor.commands.toggleMark("strong")` only type-checks when the
 * schema has a `strong` mark. Commands referring to a type the schema
 * doesn't have don't apply.
 *
 * @since 0.1.0
 * @category commands
 */
export const defineBaseCommands = (): CommandsExtension<BaseCommands> =>
  defineCommands({
    toggleMark:
      (name: string, attrs?: any, options?: ToggleMarkOptions): Command<any> =>
      (state, dispatch, view) => {
        const type = state.schema.marks[name]
        return type ? toggleMark(type, attrs ?? null, options)(state, dispatch, view) : succeedFalse
      },
    setBlockType: (name: string, attrs?: any) => byNodeName(name, (type) => setBlockType(type, attrs ?? null)),
    wrapIn: (name: string, attrs?: any) => byNodeName(name, (type) => wrapIn(type, attrs ?? null)),
    insertNode: (name: string, attrs?: any) => byNodeName(name, (type) => insertNode(type, attrs ?? null)),
    insertText:
      (text: string, from?: number, to?: number): Command<any> =>
      (state, dispatch) =>
        Effect.suspend(() =>
          dispatch
            ? Effect.as(dispatch(state.tr.insertTextUnsafe(text, from, to).scrollIntoView()), true)
            : Effect.succeed(true)
        ),
    deleteSelection: () => deleteSelection,
    selectAll: () => selectAll,
    selectParentNode: () => selectParentNode,
    joinUp: () => joinUp,
    joinDown: () => joinDown,
    joinBackward: () => joinBackward,
    joinForward: () => joinForward,
    lift: () => lift,
    splitBlock: () => splitBlock
  }) as any

/**
 * The platform's base keymap (`baseKeymap` from `effect-richtext/commands`:
 * Enter, Backspace, Delete, Mod-a, …), at low priority so that other
 * keymaps take precedence.
 *
 * @since 0.1.0
 * @category keymaps
 */
export const defineBaseKeymap = () => withPriority(defineKeymap(baseKeymap), Priority.low)

// -----------------------------------------------------------------------------
// History
// -----------------------------------------------------------------------------

/**
 * Undo history: the `history` plugin, `undo`/`redo` commands, and
 * **Mod-z** (undo), **Mod-y** and **Shift-Mod-z** (redo) bindings.
 * Include it at most once per editor (the history plugin is keyed).
 *
 * @since 0.1.0
 * @category history
 */
export const defineHistory = (options?: HistoryOptions) =>
  union(
    definePlugin(history(options)),
    defineKeymap({ "Mod-z": undo, "Mod-y": redo, "Shift-Mod-z": redo }),
    defineCommands({ undo: () => undo, redo: () => redo })
  )

// -----------------------------------------------------------------------------
// Lists
// -----------------------------------------------------------------------------

const listNodes = addListNodes({}, Content.seq("paragraph", Content.zeroOrMore("block")), "block")

/**
 * `wrapInList(name, attrs?)`.
 *
 * @since 0.1.0
 * @category type-level
 */
export type ListCommands = {
  readonly wrapInList: NodeTypeCommand
  readonly splitListItem: readonly []
  readonly liftListItem: readonly []
  readonly sinkListItem: readonly []
}

const listItemCommand = (f: (type: NodeType<any, any>) => Command<any>): Command<any> => byNodeName("list_item", f)

/**
 * Lists: the `ordered_list`, `bullet_list` (both in the `block` group)
 * and `list_item` (`paragraph block*`) nodes, the list commands
 * (`wrapInList(name, attrs?)`, `splitListItem`, `liftListItem`,
 * `sinkListItem`), and **Enter** (split item), **Mod-[** (lift) and
 * **Mod-]** (sink) bindings.
 *
 * @since 0.1.0
 * @category lists
 */
export const defineList = () =>
  union(
    defineNodeSpec("ordered_list", listNodes.ordered_list),
    defineNodeSpec("bullet_list", listNodes.bullet_list),
    defineNodeSpec("list_item", listNodes.list_item),
    defineKeymap({
      Enter: listItemCommand(splitListItem),
      "Mod-[": listItemCommand(liftListItem),
      "Mod-]": listItemCommand(sinkListItem)
    }),
    defineCommands({
      wrapInList: (name: string, attrs?: any) => byNodeName(name, (type) => wrapInList(type, attrs ?? null)),
      splitListItem: () => listItemCommand(splitListItem),
      liftListItem: () => listItemCommand(liftListItem),
      sinkListItem: () => listItemCommand(sinkListItem)
    }) as unknown as CommandsExtension<ListCommands>
  )

// -----------------------------------------------------------------------------
// Basic
// -----------------------------------------------------------------------------

/**
 * Everything above: the nodes and marks of `effect-richtext/schema-basic`,
 * lists, base commands, the base keymap and history.
 *
 * @since 0.1.0
 * @category basic
 */
export const defineBasicExtension = (options?: { readonly history?: HistoryOptions | undefined }) =>
  union(
    defineDoc(),
    defineText(),
    defineParagraph(),
    defineHeading(),
    defineBlockquote(),
    defineHorizontalRule(),
    defineCodeBlock(),
    defineImage(),
    defineHardBreak(),
    defineLink(),
    defineEm(),
    defineStrong(),
    defineCode(),
    defineList(),
    defineBaseCommands(),
    defineBaseKeymap(),
    defineHistory(options?.history)
  )
