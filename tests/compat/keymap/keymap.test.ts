// Ported from prosemirror-keymap/test/test-keymap.ts (MIT, Marijn Haverbeke and others).
// Changes: imports only (ProseMirror packages -> effect-richtext/compat/*, ist ->
// ../../utils/ist.ts, mocha describe/it -> @effect/vitest; type-only imports
// marked as such) and dprint formatting.
import { describe, it } from "@effect/vitest"
import { keymap } from "effect-richtext/compat/keymap"
import type { Plugin } from "effect-richtext/compat/state"
import { type Command } from "effect-richtext/compat/state"
import ist from "../../utils/ist.ts"

const fakeView = { state: {}, dispatch: () => {} }

function dispatch(map: Plugin, key: string, props?: { [name: string]: any }) {
  const event: any = {}
  if (props) {
    for (const prop in props) event[prop] = props[prop]
  }
  event.key = key
  ;(map.props.handleKeyDown as any)(fakeView as any, event)
}

function counter() {
  function result() {
    result.count++
    return true
  }
  result.count = 0
  return result as Command & { count: number }
}

describe("keymap", () => {
  it("calls the correct handler", () => {
    const a = counter(),
      b = counter()
    dispatch(keymap({ KeyA: a, KeyB: b }), "KeyA")
    ist(a.count, 1)
    ist(b.count, 0)
  })

  it("distinguishes between modifiers", () => {
    const s = counter(),
      c_s = counter(),
      s_c_s = counter(),
      a_s = counter()
    const map = keymap({ Space: s, "Control-Space": c_s, "s-c-Space": s_c_s, "alt-Space": a_s })
    dispatch(map, " ", { ctrlKey: true })
    dispatch(map, " ", { ctrlKey: true, shiftKey: true })
    ist(s.count, 0)
    ist(c_s.count, 1)
    ist(s_c_s.count, 1)
    ist(a_s.count, 0)
  })

  it("passes the state, dispatch, and view", () => {
    dispatch(
      keymap({
        X: (state, dispatch, view) => {
          ist(state, fakeView.state)
          ist(dispatch, fakeView.dispatch)
          ist(view, fakeView)
          return true
        }
      }),
      "X"
    )
  })

  it("tries both shifted key and base with shift modifier", () => {
    const percent = counter(),
      shift5 = counter()
    dispatch(keymap({ "Ctrl-%": percent }), "%", { shiftKey: true, ctrlKey: true, keyCode: 53 })
    ist(percent.count, 1)
    dispatch(keymap({ "Ctrl-Shift-5": shift5 }), "%", { shiftKey: true, ctrlKey: true, keyCode: 53 })
    ist(shift5.count, 1)
  })

  it("tries keyCode when modifier active", () => {
    const count = counter()
    dispatch(keymap({ "Shift-Alt-3": count }), "×", { shiftKey: true, altKey: true, keyCode: 51 })
    ist(count.count, 1)
  })

  it("tries keyCode for non-ASCII characters", () => {
    const count = counter()
    dispatch(keymap({ "Mod-s": count }), "ы", { ctrlKey: true, keyCode: 83 })
    ist(count.count, 1)
  })
})
