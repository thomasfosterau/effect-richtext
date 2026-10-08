// Ported from prosemirror-keymap/test/test-keymap.ts (MIT, Marijn Haverbeke and others)
import { assert, describe, it } from "@effect/vitest"
import { Context, Data, Effect, Layer } from "effect"
import { keydownHandler, keymap, KeymapError, type KeymapView } from "effect-richtext/keymap"
import type { AnySchema } from "effect-richtext/model"
import { type Command, EditorState, type Plugin } from "effect-richtext/state"
import { schema } from "effect-richtext/test-builder"
import ist from "../utils/ist.ts"

const fakeView = { state: {}, dispatch: () => Effect.void } as unknown as KeymapView

type Handler = (view: KeymapView, event: KeyboardEvent) => Effect.Effect<boolean, any, never>

function dispatch(map: Plugin<any, any, any, never>, key: string, props?: { [name: string]: any }): boolean {
  const event: any = {}
  if (props) { for (const prop in props) event[prop] = props[prop] }
  event.key = key
  return Effect.runSync((map.props.handleKeyDown as Handler)(fakeView, event))
}

function counter() {
  const result: Command & { count: number } = Object.assign(() =>
    Effect.sync(() => {
      result.count++
      return true
    }), { count: 0 })
  return result
}

describe("keymap", () => {
  it("calls the correct handler", () => {
    const a = counter(), b = counter()
    dispatch(keymap({ KeyA: a, KeyB: b }), "KeyA")
    ist(a.count, 1)
    ist(b.count, 0)
  })

  it("distinguishes between modifiers", () => {
    const s = counter(), c_s = counter(), s_c_s = counter(), a_s = counter()
    const map = keymap({ "Space": s, "Control-Space": c_s, "s-c-Space": s_c_s, "alt-Space": a_s })
    dispatch(map, " ", { ctrlKey: true })
    dispatch(map, " ", { ctrlKey: true, shiftKey: true })
    ist(s.count, 0)
    ist(c_s.count, 1)
    ist(s_c_s.count, 1)
    ist(a_s.count, 0)
  })

  it("passes the state, dispatch, and view", () => {
    ist(dispatch(
      keymap({
        X: (state, dispatch, view) =>
          Effect.sync(() => {
            ist(state, fakeView.state)
            ist(dispatch, fakeView.dispatch)
            ist(view, fakeView)
            return true
          })
      }),
      "X"
    ))
  })

  it("tries both shifted key and base with shift modifier", () => {
    const percent = counter(), shift5 = counter()
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

// -----------------------------------------------------------------------------
// Effect-specific behaviour
// -----------------------------------------------------------------------------

class Clipboard extends Context.Service<Clipboard, { readonly copied: Array<string> }>()("test/Clipboard") {}

class ReadOnly extends Data.TaggedError("ReadOnly")<{ readonly key: string }> {}

const copy: Command<AnySchema, never, Clipboard> = () =>
  Effect.gen(function*() {
    const clipboard = yield* Clipboard
    clipboard.copied.push("copy")
    return true
  })

const refuse: Command<AnySchema, ReadOnly> = () => Effect.fail(new ReadOnly({ key: "Enter" }))

const unhandled = counter()

describe("keymap (Effect API)", () => {
  it("returns false when no binding matches", () => {
    ist(dispatch(keymap({ "Ctrl-a": unhandled }), "b"), false)
    ist(unhandled.count, 0)
  })

  it("tries the next candidate when a binding returns false", () => {
    const pass: Command = () => Effect.succeed(false)
    const fromCode = counter()
    const map = keymap({ "Ctrl-%": pass, "Ctrl-Shift-5": fromCode })
    // `Ctrl-%` declines, so the keyCode fallback (`Shift-Ctrl-5`) runs.
    ist(dispatch(map, "%", { shiftKey: true, ctrlKey: true, keyCode: 53 }))
    ist(fromCode.count, 1)
    ist(dispatch(keymap({ "Ctrl-%": pass }), "%", { shiftKey: true, ctrlKey: true, keyCode: 53 }), false)
  })

  it("throws a KeymapError for invalid key names", () => {
    ist.throws(() => keymap({ "Hyper-a": unhandled }), (e) => e instanceof KeymapError)
    ist.throws(() => keymap({ "Ctrl-a": unhandled, "c-a": unhandled }), (e) => e instanceof KeymapError)
  })

  it("infers the plugin's requirements and errors from its bindings", () => {
    const plugin = keymap({ "Mod-c": copy, "Enter": refuse, "x": unhandled })
    const _check: Plugin<undefined, AnySchema, ReadOnly, Clipboard> = plugin
    void _check
    // A state with this plugin carries its requirement.
    const program = EditorState.create({ schema, plugins: [plugin] })
    const _program: Effect.Effect<EditorState<any, Clipboard, ReadOnly>, any, Clipboard> = program
    void _program
    // @ts-expect-error -- a plugin requiring services can't be used with createUnsafe
    const _unsafe = () => EditorState.createUnsafe({ schema, plugins: [plugin] })
    void _unsafe
  })

  it.effect("runs bindings that require services", () =>
    Effect.gen(function*() {
      const copied: Array<string> = []
      const handler = keydownHandler({ "Ctrl-c": copy })
      const handled = yield* handler(fakeView, { key: "c", ctrlKey: true } as KeyboardEvent).pipe(
        Effect.provide(Layer.succeed(Clipboard, { copied }))
      )
      ist(handled)
      assert.deepStrictEqual(copied, ["copy"])
    }))

  it.effect("propagates typed command errors", () =>
    Effect.gen(function*() {
      const handler = keydownHandler({ Enter: refuse })
      const error = yield* Effect.flip(handler(fakeView, { key: "Enter" } as KeyboardEvent))
      assert.strictEqual(error._tag, "ReadOnly")
      assert.strictEqual(error.key, "Enter")
    }))
})
