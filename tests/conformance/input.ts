// Input as an editor's view receives it, through the props that handle it.
import { assert } from "@effect/vitest"
import type { EditorView } from "prosemirror-view"

/** `Mod-` is Cmd on macOS and Ctrl elsewhere, by `navigator.platform`. */
export const mod: KeyboardEventInit = /Mac|iP(hone|[oa]d)/.test(navigator.platform)
  ? { metaKey: true }
  : { ctrlKey: true }

/** Type `text` one character at a time, running input rules on the way. */
export const typeText = (view: EditorView, text: string): void =>
  Array.from(text).forEach((ch) => {
    const { from, to } = view.state.selection
    const handled = view.someProp("handleTextInput", (f) => f(view, from, to, ch, () => view.state.tr.insertText(ch)))
    if (!handled) view.dispatch(view.state.tr.insertText(ch, from, to))
  })

/** Press a key, through the view's `handleKeyDown` props (keymaps). */
export const keydown = (view: EditorView, key: string, init: KeyboardEventInit = {}): void => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init })
  view.someProp("handleKeyDown", (f) => f(view, event))
}

/** `value`, failing the test when it is `null` or `undefined`. */
export const defined = <T>(value: T): NonNullable<T> => {
  assert.exists(value)
  return value
}
