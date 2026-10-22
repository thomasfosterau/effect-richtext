// Tests for effect-richtext/reactive with a real view, and for the
// view's `subscribe` listener hook.
import { assert, describe, it } from "@effect/vitest"
import { Effect, Exit, Fiber, Option, Scope } from "effect"
import { baseKeymap } from "effect-richtext/commands"
import { keymap } from "effect-richtext/keymap"
import type { AnySchema } from "effect-richtext/model"
import { EditorObserver, observe } from "effect-richtext/reactive"
import { type Command, EditorState, Plugin, TextSelection, type Transaction } from "effect-richtext/state"
import { doc, eq, p, strong } from "effect-richtext/test-builder"
import { EditorView, type ViewUpdate } from "effect-richtext/view"
import { collect, settle } from "../reactive/helpers.ts"
import ist from "../utils/ist.ts"
import { selFor, workspace } from "./helpers.ts"

const stateFor = (d: ReturnType<typeof doc>, plugins?: ReadonlyArray<Plugin<any, any, any, never>>) =>
  EditorState.createUnsafe({ doc: d, selection: selFor(d), plugins })

const keyDown = (view: EditorView<any, any, any>, key: string, keyCode: number) => {
  const event = new KeyboardEvent("keydown", { key, keyCode, bubbles: true, cancelable: true } as KeyboardEventInit)
  view.dom.dispatchEvent(event)
  return event
}

const listenerCount = (view: EditorView<any, any, any>): number => (view as any).listeners.length

describe("EditorView.subscribe", () => {
  it.effect("notifies listeners of state updates with their transactions", () =>
    Effect.gen(function* () {
      const appender = new Plugin({
        appendTransaction: (
          trs: ReadonlyArray<Transaction<AnySchema>>,
          _old,
          state: EditorState<AnySchema, any, any>
        ) => (trs.some((tr) => Option.isSome(tr.getMeta("append"))) ? state.tr.insertTextUnsafe("+") : null)
      })
      const view = yield* EditorView.make(workspace(), { state: stateFor(doc(p("a<a>")), [appender]) })
      const updates: Array<ViewUpdate<any, any, any>> = []
      const unsubscribe = view.subscribe((update) => updates.push(update))
      const prev = view.state
      const tr = view.state.tr.insertTextUnsafe("b").setMeta("append", true)
      yield* view.dispatch(tr)
      ist(updates.length, 1)
      ist(updates[0]!.prevState, prev)
      ist(updates[0]!.state, view.state)
      ist(updates[0]!.transactions.length, 2)
      ist(updates[0]!.transactions[0], tr)
      ist(view.state.doc, doc(p("ab+")), eq)
      // Direct state updates have no transactions.
      view.updateState(stateFor(doc(p("x"))))
      ist(updates.length, 2)
      ist(updates[1]!.transactions.length, 0)
      unsubscribe()
      yield* view.dispatch(view.state.tr.insertTextUnsafe("y"))
      ist(updates.length, 2)
    }).pipe(Effect.scoped)
  )

  it.effect("passes the dispatched transaction with a custom dispatchTransaction", () =>
    Effect.gen(function* () {
      const updates: Array<ViewUpdate<any, any, any>> = []
      const view: EditorView<any, never, any> = yield* EditorView.make(workspace(), {
        state: stateFor(doc(p("a<a>"))),
        dispatchTransaction(tr) {
          view.updateState(view.state.applyUnsafe(tr))
        }
      })
      view.subscribe((update) => updates.push(update))
      const tr = view.state.tr.insertTextUnsafe("b")
      yield* view.dispatch(tr)
      ist(updates.length, 1)
      assert.deepStrictEqual(updates[0]!.transactions, [tr])
    }).pipe(Effect.scoped)
  )

  it.effect("does not attribute transactions to nested updates", () =>
    Effect.gen(function* () {
      const updates: Array<ViewUpdate<any, any, any>> = []
      let nested = false
      const plugin = new Plugin({
        view: () => ({
          update: (view) => {
            if (nested) return
            nested = true
            view.updateState(stateFor(doc(p("nested"))))
          }
        })
      })
      const view = yield* EditorView.make(workspace(), { state: stateFor(doc(p("a<a>")), [plugin]) })
      view.subscribe((update) => updates.push(update))
      yield* view.dispatch(view.state.tr.insertTextUnsafe("b"))
      ist(updates.length, 2)
      // The nested update is notified first (it completes first).
      ist(updates[0]!.transactions.length, 0)
      ist(updates[1]!.transactions.length, 1)
      ist(view.state.doc, doc(p("nested")), eq)
    }).pipe(Effect.scoped)
  )
})

describe("EditorObserver", () => {
  it.effect("follows the view's state and transactions", () =>
    Effect.gen(function* () {
      const view = yield* EditorView.make(workspace(), {
        state: stateFor(doc(p("foo<a>bar")), [keymap(baseKeymap)])
      })
      const observer = yield* observe(view)
      ist(observer.view, view)
      ist(observer.state.getUnsafe(), view.state)
      const states = yield* collect(observer.state.changes, 3)
      const transactions = yield* collect(observer.transactions, 2)
      const docs = yield* collect(observer.docChanges, 3)
      const tr = view.state.tr.insertTextUnsafe("!")
      yield* view.dispatch(tr)
      // A DOM-triggered transaction.
      ist(keyDown(view, "Enter", 13).defaultPrevented)
      ist(view.state.doc, doc(p("foo!"), p("bar")), eq)

      const seen = yield* Fiber.join(states)
      ist(seen[2], view.state)
      const [first, second] = yield* Fiber.join(transactions)
      ist(first!.tr, tr)
      ist(first!.state, seen[1])
      ist(first!.prevState, seen[0])
      ist(second!.state, view.state)
      ist(second!.tr.docChanged)
      const ds = yield* Fiber.join(docs)
      ist(ds[2], doc(p("foo!"), p("bar")), eq)
      ist(yield* observer.state.get, view.state)
    }).pipe(Effect.scoped)
  )

  it.effect("derives selectors from the view's state", () =>
    Effect.gen(function* () {
      const view = yield* EditorView.make(workspace(), { state: stateFor(doc(p("<a>foo ", strong("bar<b>")))) })
      const observer = yield* EditorObserver.make(view)
      const strongActive = yield* collect(observer.isMarkActive("strong"), 2)
      const seenViews: Array<unknown> = []
      const notEmpty: Command<any> = (state, _dispatch, view) =>
        Effect.sync(() => {
          seenViews.push(view)
          return !state.selection.empty
        })
      const canRun = yield* collect(observer.canExecute(notEmpty), 2)
      const selections = yield* collect(observer.selection, 2)
      yield* view.dispatch(view.state.tr.setSelectionUnsafe(TextSelection.createUnsafe(view.state.doc, 2)))
      assert.deepStrictEqual(yield* Fiber.join(strongActive), [true, false])
      assert.deepStrictEqual(yield* Fiber.join(canRun), [true, false])
      ist(seenViews[0], view)
      ist((yield* Fiber.join(selections))[1]!.head, 2)
    }).pipe(Effect.scoped)
  )

  it.effect("tracks focus", () =>
    Effect.gen(function* () {
      const view = yield* EditorView.make(workspace(), { state: stateFor(doc(p("foo"))) })
      const button = document.createElement("button")
      workspace().appendChild(button)
      yield* Effect.addFinalizer(() => Effect.sync(() => button.remove()))
      const observer = yield* observe(view)
      const focus = yield* collect(observer.focus, 3)
      view.focus()
      ist(view.hasFocus())
      view.focus() // no change
      button.focus()
      ist(!view.hasFocus())
      assert.deepStrictEqual(yield* Fiber.join(focus), [false, true, false])
    }).pipe(Effect.scoped)
  )

  it.effect("unsubscribes and ends its streams when its scope closes", () =>
    Effect.gen(function* () {
      const view = yield* EditorView.make(workspace(), { state: stateFor(doc(p("foo<a>"))) })
      ist(listenerCount(view), 0)
      const scope = yield* Scope.make()
      const observer = yield* observe(view).pipe(Scope.provide(scope))
      ist(listenerCount(view), 1)
      const states = yield* collect(observer.state.changes)
      const transactions = yield* collect(observer.transactions)
      const focus = yield* collect(observer.focus)
      yield* view.dispatch(view.state.tr.insertTextUnsafe("!"))
      yield* Scope.close(scope, Exit.void)
      ist(listenerCount(view), 0)
      ist((yield* Fiber.join(states)).length, 2)
      ist((yield* Fiber.join(transactions)).length, 1)
      ist((yield* Fiber.join(focus)).length, 1)
      // The view keeps working, and the observer no longer follows it.
      yield* view.dispatch(view.state.tr.insertTextUnsafe("?"))
      view.focus()
      yield* settle
      ist(view.state.doc, doc(p("foo!?")), eq)
      ist(observer.state.getUnsafe().doc, doc(p("foo!")), eq)
    }).pipe(Effect.scoped)
  )
})
