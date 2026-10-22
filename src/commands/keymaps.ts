/**
 * Base keymaps, ported from `prosemirror-commands`.
 *
 * @since 0.1.0
 */
import * as Predicate from "effect/Predicate"
import type { Command } from "../state.ts"
import {
  chainCommands,
  createParagraphNear,
  deleteSelection,
  exitCode,
  joinBackward,
  joinForward,
  liftEmptyBlock,
  newlineInCode,
  selectAll,
  selectNodeBackward,
  selectNodeForward,
  selectTextblockEnd,
  selectTextblockStart,
  splitBlock
} from "./commands.ts"

/**
 * A keymap: commands keyed by key name (`"Mod-b"`, `"Enter"`), as the base
 * keymaps below and `keymap(...)` from `effect-richtext/keymap` use them.
 *
 * @since 0.1.0
 * @category models
 */
export interface Keymap {
  readonly [key: string]: Command
}

const backspace = chainCommands(deleteSelection, joinBackward, selectNodeBackward)
const del = chainCommands(deleteSelection, joinForward, selectNodeForward)

/**
 * A basic keymap containing bindings not specific to any schema. Binds
 * the following keys (when multiple commands are listed, they are
 * chained with `chainCommands`):
 *
 * - **Enter** to `newlineInCode`, `createParagraphNear`, `liftEmptyBlock`, `splitBlock`
 * - **Mod-Enter** to `exitCode`
 * - **Backspace**, **Mod-Backspace** and **Shift-Backspace** to `deleteSelection`, `joinBackward`, `selectNodeBackward`
 * - **Delete** and **Mod-Delete** to `deleteSelection`, `joinForward`, `selectNodeForward`
 * - **Mod-a** to `selectAll`
 *
 * @since 0.1.0
 * @category keymaps
 */
export const pcBaseKeymap: Keymap = {
  Enter: chainCommands(newlineInCode, createParagraphNear, liftEmptyBlock, splitBlock),
  "Mod-Enter": exitCode,
  Backspace: backspace,
  "Mod-Backspace": backspace,
  "Shift-Backspace": backspace,
  Delete: del,
  "Mod-Delete": del,
  "Mod-a": selectAll
}

/**
 * A copy of `pcBaseKeymap` that also binds **Ctrl-h** like Backspace,
 * **Ctrl-d** like Delete, **Alt-Backspace** like Ctrl-Backspace, and
 * **Ctrl-Alt-Backspace**, **Alt-Delete**, and **Alt-d** like
 * Ctrl-Delete, plus **Ctrl-a** / **Ctrl-e** to `selectTextblockStart` /
 * `selectTextblockEnd`.
 *
 * @since 0.1.0
 * @category keymaps
 */
export const macBaseKeymap: Keymap = {
  "Ctrl-h": backspace,
  "Alt-Backspace": backspace,
  "Ctrl-d": del,
  "Ctrl-Alt-Backspace": del,
  "Alt-Delete": del,
  "Alt-d": del,
  "Ctrl-a": selectTextblockStart,
  "Ctrl-e": selectTextblockEnd,
  ...pcBaseKeymap
}

const mac = !Predicate.isUndefined(globalThis.navigator) && /Mac|iP(hone|[oa]d)/.test(navigator.platform)

/**
 * Depending on the detected platform, this will hold `pcBaseKeymap` or
 * `macBaseKeymap`.
 *
 * @since 0.1.0
 * @category keymaps
 */
export const baseKeymap: Keymap = mac ? macBaseKeymap : pcBaseKeymap
