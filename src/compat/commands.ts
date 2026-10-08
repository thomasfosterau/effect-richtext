/**
 * A `prosemirror-commands`-compatible module: the core editing commands
 * (`effect-richtext/commands`), bridged to ProseMirror-style
 * `(state, dispatch?, view?) => boolean` commands.
 *
 * Ported API surface from prosemirror-commands (MIT, Marijn Haverbeke and others).
 *
 * @since 0.1.0
 */
import * as C from "../commands.ts"
import type * as S from "../state.ts"
import { CORE, wrap } from "./internal/core.ts"
import type { Attrs, MarkType, Node, NodeType, ResolvedPos } from "./model.ts"
import { type Command, fromCoreCommand, toCoreCommand } from "./state.ts"

export {
  /**
   * @since 0.1.0
   */
  fromCoreCommand,
  /**
   * @since 0.1.0
   */
  toCoreCommand
}

/**
 * Delete the selection, if there is one.
 *
 * @since 0.1.0
 * @category commands
 */
export const deleteSelection: Command = fromCoreCommand(C.deleteSelection)

/**
 * If the selection is empty and at the start of a textblock, try to
 * reduce the distance between that block and the one before it.
 *
 * @since 0.1.0
 * @category commands
 */
export const joinBackward: Command = fromCoreCommand(C.joinBackward)

/**
 * A more limited form of `joinBackward` that only tries to join the
 * current textblock to the one before it, if the cursor is at the
 * start of a textblock.
 *
 * @since 0.1.0
 * @category commands
 */
export const joinTextblockBackward: Command = fromCoreCommand(C.joinTextblockBackward)

/**
 * A more limited form of `joinForward` that only tries to join the
 * current textblock to the one after it, if the cursor is at the end
 * of a textblock.
 *
 * @since 0.1.0
 * @category commands
 */
export const joinTextblockForward: Command = fromCoreCommand(C.joinTextblockForward)

/**
 * When the selection is empty and at the start of a textblock, select
 * the node before that textblock, if possible.
 *
 * @since 0.1.0
 * @category commands
 */
export const selectNodeBackward: Command = fromCoreCommand(C.selectNodeBackward)

/**
 * If the selection is empty and the cursor is at the end of a
 * textblock, try to reduce or remove the boundary between that block
 * and the one after it.
 *
 * @since 0.1.0
 * @category commands
 */
export const joinForward: Command = fromCoreCommand(C.joinForward)

/**
 * When the selection is empty and at the end of a textblock, select
 * the node coming after that textblock, if possible.
 *
 * @since 0.1.0
 * @category commands
 */
export const selectNodeForward: Command = fromCoreCommand(C.selectNodeForward)

/**
 * Join the selected block or, if there is a text selection, the
 * closest ancestor block of the selection that can be joined, with the
 * sibling above it.
 *
 * @since 0.1.0
 * @category commands
 */
export const joinUp: Command = fromCoreCommand(C.joinUp)

/**
 * Join the selected block, or the closest ancestor of the selection
 * that can be joined, with the sibling after it.
 *
 * @since 0.1.0
 * @category commands
 */
export const joinDown: Command = fromCoreCommand(C.joinDown)

/**
 * Lift the selected block, or the closest ancestor block of the
 * selection that can be lifted, out of its parent node.
 *
 * @since 0.1.0
 * @category commands
 */
export const lift: Command = fromCoreCommand(C.lift)

/**
 * If the selection is in a node whose type has a truthy `code`
 * property in its spec, replace the selection with a newline
 * character.
 *
 * @since 0.1.0
 * @category commands
 */
export const newlineInCode: Command = fromCoreCommand(C.newlineInCode)

/**
 * When the selection is in a node with a truthy `code` property in its
 * spec, create a default block after the code block, and move the
 * cursor there.
 *
 * @since 0.1.0
 * @category commands
 */
export const exitCode: Command = fromCoreCommand(C.exitCode)

/**
 * If a block node is selected, create an empty paragraph before (if it
 * is its parent's first child) or after it.
 *
 * @since 0.1.0
 * @category commands
 */
export const createParagraphNear: Command = fromCoreCommand(C.createParagraphNear)

/**
 * If the cursor is in an empty textblock that can be lifted, lift the
 * block.
 *
 * @since 0.1.0
 * @category commands
 */
export const liftEmptyBlock: Command = fromCoreCommand(C.liftEmptyBlock)

/**
 * Create a variant of `splitBlock` that uses a custom function to
 * determine the type of the newly split off block.
 *
 * @since 0.1.0
 * @category commands
 */
export function splitBlockAs(
  splitNode?: (node: Node, atEnd: boolean, $from: ResolvedPos) => { type: NodeType; attrs?: Attrs } | null
): Command {
  return fromCoreCommand(C.splitBlockAs(
    splitNode && ((node, atEnd, $from) => {
      const result = splitNode(wrap(node), atEnd, wrap($from))
      return result && { type: result.type[CORE], attrs: result.attrs ?? null }
    })
  ))
}

/**
 * Split the parent block of the selection.
 *
 * @since 0.1.0
 * @category commands
 */
export const splitBlock: Command = fromCoreCommand(C.splitBlock)

/**
 * Acts like `splitBlock`, but without resetting the set of active
 * marks at the cursor.
 *
 * @since 0.1.0
 * @category commands
 */
export const splitBlockKeepMarks: Command = fromCoreCommand(C.splitBlockKeepMarks)

/**
 * Move the selection to the node wrapping the current selection, if
 * any.
 *
 * @since 0.1.0
 * @category commands
 */
export const selectParentNode: Command = fromCoreCommand(C.selectParentNode)

/**
 * Select the whole document.
 *
 * @since 0.1.0
 * @category commands
 */
export const selectAll: Command = fromCoreCommand(C.selectAll)

/**
 * Moves the cursor to the start of current text block.
 *
 * @since 0.1.0
 * @category commands
 */
export const selectTextblockStart: Command = fromCoreCommand(C.selectTextblockStart)

/**
 * Moves the cursor to the end of current text block.
 *
 * @since 0.1.0
 * @category commands
 */
export const selectTextblockEnd: Command = fromCoreCommand(C.selectTextblockEnd)

/**
 * Wrap the selection in a node of the given type with the given
 * attributes.
 *
 * @since 0.1.0
 * @category commands
 */
export function wrapIn(nodeType: NodeType, attrs: Attrs | null = null): Command {
  return fromCoreCommand(C.wrapIn(nodeType[CORE], attrs))
}

/**
 * Returns a command that tries to set the selected textblocks to the
 * given node type with the given attributes.
 *
 * @since 0.1.0
 * @category commands
 */
export function setBlockType(nodeType: NodeType, attrs: Attrs | null = null): Command {
  return fromCoreCommand(C.setBlockType(nodeType[CORE], attrs))
}

/**
 * Create a command function that toggles the given mark with the given
 * attributes.
 *
 * @since 0.1.0
 * @category commands
 */
export function toggleMark(markType: MarkType, attrs: Attrs | null = null, options?: {
  removeWhenPresent?: boolean
  enterInlineAtoms?: boolean
  includeWhitespace?: boolean
}): Command {
  return fromCoreCommand(C.toggleMark(markType[CORE], attrs, options))
}

/**
 * Wrap a command so that, when it produces a transform that causes two
 * joinable nodes to end up next to each other, those are joined.
 *
 * @since 0.1.0
 * @category commands
 */
export function autoJoin(
  command: Command,
  isJoinable: ((before: Node, after: Node) => boolean) | ReadonlyArray<string>
): Command {
  return fromCoreCommand(C.autoJoin(
    toCoreCommand(command),
    typeof isJoinable === "function" ? (a, b) => isJoinable(wrap(a), wrap(b)) : isJoinable
  ))
}

/**
 * Combine a number of command functions into a single function (which
 * calls them one by one until one returns true).
 *
 * @since 0.1.0
 * @category commands
 */
export function chainCommands(...commands: ReadonlyArray<Command>): Command {
  return function(state, dispatch, view) {
    for (let i = 0; i < commands.length; i++) if (commands[i]!(state, dispatch, view)) return true
    return false
  }
}

const fromCoreKeymap = (map: { readonly [key: string]: S.Command }): { [key: string]: Command } => {
  const result: { [key: string]: Command } = {}
  for (const key in map) result[key] = fromCoreCommand(map[key]!)
  return result
}

/**
 * A basic keymap containing bindings not specific to any schema.
 *
 * @since 0.1.0
 * @category keymaps
 */
export const pcBaseKeymap: { [key: string]: Command } = fromCoreKeymap(C.pcBaseKeymap)

/**
 * A copy of `pcBaseKeymap` that also binds **Ctrl-h** like Backspace,
 * **Ctrl-d** like Delete, **Alt-Backspace** like Ctrl-Backspace, and
 * **Ctrl-Alt-Backspace**, **Alt-Delete**, and **Alt-d** like
 * Ctrl-Delete.
 *
 * @since 0.1.0
 * @category keymaps
 */
export const macBaseKeymap: { [key: string]: Command } = fromCoreKeymap(C.macBaseKeymap)

/**
 * Depending on the detected platform, this will hold `pcBasekeymap` or
 * `macBaseKeymap`.
 *
 * @since 0.1.0
 * @category keymaps
 */
export const baseKeymap: { [key: string]: Command } = C.baseKeymap === C.macBaseKeymap ? macBaseKeymap : pcBaseKeymap
