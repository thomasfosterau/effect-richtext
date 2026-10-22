// Browser tests for effect-richtext/extensions: mounting editors and
// keyboard handling through extension keymaps.
import { assert, describe, it } from "@effect/vitest"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import {
  createEditor,
  createEditorUnsafe,
  defineBasicExtension,
  defineKeymap,
  definePlugin,
  Priority,
  union,
  withPriority
} from "effect-richtext/extensions"
import { type Command, Plugin, TextSelection, type Transaction } from "effect-richtext/state"
import ist from "../utils/ist.ts"
import { getSome } from "../utils/option.ts"
import { workspace } from "./helpers.ts"

const mac = typeof navigator !== "undefined" && /Mac|iP(hone|[oa]d)/.test(navigator.platform)

const keyDown = (dom: HTMLElement, key: string, keyCode: number, mods: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent("keydown", { key, keyCode, bubbles: true, cancelable: true, ...mods })
  dom.dispatchEvent(event)
  return event
}
const mod: KeyboardEventInit = mac ? { metaKey: true } : { ctrlKey: true }

const atEnd = <D extends Parameters<typeof TextSelection.atEnd>[0]>(doc: D) => TextSelection.atEnd(doc)

class Tick extends Context.Service<Tick, { readonly by: number }>()("test/Tick") {}

describe("Editor (view)", () => {
  it.effect("mounts in a scope and unmounts when it closes", () =>
    Effect.gen(function* () {
      const editor = createEditorUnsafe(defineBasicExtension(), { doc: "<p>hello</p>" })
      const place = workspace()
      ist(Option.isNone(editor.view))
      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* editor.mount(place)
          const view = getSome(editor.view)
          ist(view.dom.parentNode, place)
          ist(view.dom.innerHTML, "<p>hello</p>")
          // Commands go through the view.
          yield* editor.commands.insertText("!", 6)
          ist(view.state, editor.state)
          ist(view.dom.innerHTML, "<p>hello!</p>")
          yield* editor.chain().selectAll().setBlockType("heading", { level: 2 }).run()
          ist(view.dom.innerHTML, "<h2>hello!</h2>")
        })
      )
      ist(Option.isNone(editor.view))
      ist(!editor.mounted)
      // The editor keeps the view's last state.
      ist(editor.state.doc.toString(), `doc(heading("hello!"))`)
      ist(place.querySelector(".ProseMirror"), null)
    })
  )

  it.effect("unmounts explicitly and can be mounted again", () =>
    Effect.gen(function* () {
      const editor = createEditorUnsafe(defineBasicExtension(), { doc: "<p>a</p>" })
      yield* editor.mount(workspace())
      const first = getSome(editor.view)
      yield* editor.unmount
      ist(first.isDestroyed)
      ist(Option.isNone(editor.view))
      yield* editor.commands.insertText("b", 2)
      yield* editor.mount(workspace())
      const second = getSome(editor.view)
      ist(second.dom.innerHTML, "<p>ab</p>")
      // Mounting again replaces the current view.
      yield* editor.mount(workspace())
      ist(second.isDestroyed)
      ist(getSome(editor.view).dom.innerHTML, "<p>ab</p>")
    }).pipe(Effect.scoped)
  )

  it.effect("passes view props through", () =>
    Effect.gen(function* () {
      const editor = createEditorUnsafe(defineBasicExtension(), { doc: "<p>a</p>" })
      const seen: Array<Transaction> = []
      yield* editor.mount(workspace(), {
        attributes: { "data-test": "yes" },
        dispatchTransaction: (tr) => {
          seen.push(tr)
          const view = getSome(editor.view)
          view.updateState(view.state.applyUnsafe(tr))
        }
      })
      const view = getSome(editor.view)
      ist(view.dom.getAttribute("data-test"), "yes")
      yield* editor.commands.insertText("b", 2)
      ist(seen.length, 1)
      ist(editor.state.doc.textContent, "ab")
    }).pipe(Effect.scoped)
  )

  it.effect("handles keys through extension keymaps", () =>
    Effect.gen(function* () {
      const editor = createEditorUnsafe(defineBasicExtension(), { doc: "<p>foobar</p>" })
      yield* editor.mount(workspace())
      const view = getSome(editor.view)
      yield* editor.dispatch(editor.state.tr.setSelectionUnsafe(TextSelection.createUnsafe(editor.state.doc, 4)))
      // Enter: base keymap (splitBlock)
      ist(keyDown(view.dom, "Enter", 13).defaultPrevented)
      ist(editor.state.doc.toString(), `doc(paragraph("foo"), paragraph("bar"))`)
      // Mod-z: history keymap
      ist(keyDown(view.dom, "z", 90, mod).defaultPrevented)
      ist(editor.state.doc.toString(), `doc(paragraph("foobar"))`)
      // Shift-Mod-z: redo
      ist(keyDown(view.dom, "Z", 90, { ...mod, shiftKey: true }).defaultPrevented)
      ist(editor.state.doc.toString(), `doc(paragraph("foo"), paragraph("bar"))`)
      // Mod-a: selectAll
      ist(keyDown(view.dom, "a", 65, mod).defaultPrevented)
      ist(editor.state.selection.to, editor.state.doc.content.size)
    }).pipe(Effect.scoped)
  )

  it.effect("splits list items with Enter before the base keymap runs", () =>
    Effect.gen(function* () {
      const editor = createEditorUnsafe(defineBasicExtension(), {
        doc: "<ul><li><p>one</p></li></ul>",
        selection: atEnd
      })
      yield* editor.mount(workspace())
      const view = getSome(editor.view)
      ist(keyDown(view.dom, "Enter", 13).defaultPrevented)
      ist(editor.state.doc.toString(), `doc(bullet_list(list_item(paragraph("one")), list_item(paragraph)))`)
    }).pipe(Effect.scoped)
  )

  it.effect("lets keymaps with a higher priority take precedence", () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const logging =
        (name: string, handled: boolean): Command =>
        () =>
          Effect.sync(() => {
            log.push(name)
            return handled
          })
      const editor = createEditorUnsafe(
        union(
          defineBasicExtension(),
          withPriority(defineKeymap({ Enter: logging("lowest", true) }), Priority.lowest),
          defineKeymap({ Enter: logging("default", false) }),
          withPriority(defineKeymap({ Enter: logging("high", false) }), Priority.high)
        ),
        { doc: "<p>ab</p>", selection: atEnd }
      )
      yield* editor.mount(workspace())
      const view = getSome(editor.view)
      ist(keyDown(view.dom, "Enter", 13).defaultPrevented)
      // The base keymap (low) handles Enter before the lowest keymap.
      assert.deepStrictEqual(log, ["high", "default"])
      ist(editor.state.doc.childCount, 2)
    }).pipe(Effect.scoped)
  )

  it.effect("provides the requirements of plugins to the view", () =>
    Effect.gen(function* () {
      const ticks = new Plugin({
        state: {
          init: () => 0,
          apply: (_tr: Transaction, n: number) => Effect.map(Effect.service(Tick), (t) => n + t.by)
        }
      })
      const editor = yield* createEditor(union(defineBasicExtension(), definePlugin(ticks)), { doc: "<p>x</p>" })
      yield* editor.mount(workspace())
      const view = getSome(editor.view)
      yield* editor.dispatch(editor.state.tr.setSelectionUnsafe(TextSelection.createUnsafe(editor.state.doc, 2)))
      ist(keyDown(view.dom, "Enter", 13).defaultPrevented)
      ist(getSome(ticks.getState(editor.state)), 6)
    }).pipe(Effect.scoped, Effect.provide(Layer.succeed(Tick, { by: 3 })))
  )
})
