/**
 * A `prosemirror-keymap`-compatible module. Key names are normalized
 * and matched by the core keymap; the bound ProseMirror-style commands
 * are called directly with the view's `state`, `dispatch` and the view.
 *
 * Ported API surface from prosemirror-keymap (MIT, Marijn Haverbeke and others).
 *
 * @since 0.1.0
 */
import { matchBindings, normalizeBindings } from "../Keymap.ts"
import { guard } from "./internal/core.ts"
import { type Command, Plugin } from "./state.ts"
import type { EditorView } from "./view.ts"

/**
 * Create a keymap plugin for the given set of bindings.
 *
 * @since 0.1.0
 * @category constructors
 */
export function keymap(bindings: { [key: string]: Command }): Plugin {
  return new Plugin({ props: { handleKeyDown: keydownHandler(bindings) } })
}

/**
 * Given a set of bindings (using the same format as `keymap`), return a
 * keydown handler that handles them.
 *
 * @since 0.1.0
 * @category constructors
 */
export function keydownHandler(bindings: {
  [key: string]: Command
}): (view: EditorView, event: KeyboardEvent) => boolean {
  const map = guard(() => normalizeBindings(bindings))
  return function (view, event) {
    // ProseMirror passes `view.dispatch` itself, which the view binds.
    // oxlint-disable-next-line typescript/unbound-method
    return matchBindings(map, event).some((command) => command(view.state, view.dispatch, view))
  }
}
