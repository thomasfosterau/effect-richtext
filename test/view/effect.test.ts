// Tests for the Effect-specific API of the view: scoped creation,
// context capture, Effect-returning handlers and error reporting.
import { assert, describe, it } from "@effect/vitest"
import { Cause, Context, Data, Deferred, Effect, Exit, Layer, Option } from "effect"
import { baseKeymap } from "effect-richtext/commands"
import { history } from "effect-richtext/history"
import { keymap } from "effect-richtext/keymap"
import type { AnySchema } from "effect-richtext/model"
import { EditorState, Plugin, type Transaction } from "effect-richtext/state"
import { doc, eq, p, schema } from "effect-richtext/test-builder"
import { EditorView } from "effect-richtext/view"
import ist from "../utils/ist.ts"
import { selFor, workspace } from "./helpers.ts"

class Counter extends Context.Service<Counter, { readonly step: number }>()("test/Counter") {}

class Boom extends Data.TaggedError("Boom")<{ readonly reason: string }> {}

// A plugin whose state hook requires a service.
const stepCountPlugin = new Plugin({
  state: {
    init: () => 0,
    apply: (_tr: Transaction<AnySchema>, value: number) =>
      Effect.map(Effect.service(Counter), (counter) => value + counter.step)
  }
})

const count = (state: EditorState<any, any, any>) => Option.getOrThrow(stepCountPlugin.getState(state))

const keyDown = (view: EditorView<any, any, any>, key: string, keyCode: number) => {
  const event = new KeyboardEvent("keydown", { key, keyCode, bubbles: true, cancelable: true } as KeyboardEventInit)
  view.dom.dispatchEvent(event)
  return event
}

const startDoc = () => doc(p("foo<a>"))

describe("EditorView (Effect API)", () => {
  it.effect("destroys the view when its scope closes", () =>
    Effect.gen(function*() {
      const d = startDoc()
      const state = EditorState.createUnsafe({ doc: d, selection: selFor(d) })
      const place = workspace()
      const view = yield* Effect.scoped(
        Effect.gen(function*() {
          const view = yield* EditorView.make(place, { state })
          ist(!view.isDestroyed)
          ist(view.dom.parentNode, place)
          return view
        })
      )
      ist(view.isDestroyed)
      ist(view.dom.parentNode, null)
    }))

  it.effect("runs plugins requiring services with the captured context", () =>
    Effect.gen(function*() {
      const d = startDoc()
      const state = yield* EditorState.create({ doc: d, selection: selFor(d), plugins: [stepCountPlugin] })
      const view = yield* EditorView.make(workspace(), { state })
      // Typed dispatch: runs with the captured context, requires nothing.
      yield* view.dispatch(view.state.tr.insertTextUnsafe("a"))
      ist(view.state.doc, doc(p("fooa")), eq)
      ist(count(view.state), 5)
      // DOM-triggered changes go through the captured context too.
      view.dispatchUnsafe(view.state.tr.insertTextUnsafe("b"))
      ist(count(view.state), 10)
      yield* view.tryDispatch(view.state.tr.insertTextUnsafe("c"))
      ist(view.state.doc, doc(p("fooabc")), eq)
      ist(count(view.state), 15)
    }).pipe(Effect.scoped, Effect.provide(Layer.succeed(Counter, { step: 5 }))))

  it.effect("runs Effect-returning handleKeyDown props", () =>
    Effect.gen(function*() {
      const d = startDoc()
      const state = EditorState.createUnsafe({ doc: d, selection: selFor(d) })
      const seen: Array<string> = []
      const view = yield* EditorView.make<AnySchema, Counter>(workspace(), {
        state,
        handleKeyDown: (view, event) =>
          Effect.gen(function*() {
            const counter = yield* Counter
            seen.push(event.key + counter.step)
            if (event.key !== "x") return false
            yield* view.dispatch(view.state.tr.insertTextUnsafe("x"))
            return true
          })
      })
      const handled = keyDown(view, "x", 88)
      ist(handled.defaultPrevented)
      ist(view.state.doc, doc(p("foox")), eq)
      const unhandled = keyDown(view, "y", 89)
      ist(!unhandled.defaultPrevented)
      assert.deepStrictEqual(seen, ["x2", "y2"])
    }).pipe(Effect.scoped, Effect.provide(Layer.succeed(Counter, { step: 2 }))))

  it.live("treats asynchronous handler effects as handled and lets them finish", () =>
    Effect.gen(function*() {
      const d = startDoc()
      const state = EditorState.createUnsafe({ doc: d, selection: selFor(d) })
      const done = yield* Deferred.make<void>()
      const view = yield* EditorView.make(workspace(), {
        state,
        handleKeyDown: (view) =>
          Effect.gen(function*() {
            yield* Effect.sleep("5 millis")
            yield* view.dispatch(view.state.tr.insertTextUnsafe("!"))
            yield* Deferred.succeed(done, undefined)
            return true
          })
      })
      const event = keyDown(view, "a", 65)
      ist(event.defaultPrevented)
      ist(view.state.doc, doc(p("foo")), eq)
      yield* Deferred.await(done)
      ist(view.state.doc, doc(p("foo!")), eq)
    }).pipe(Effect.scoped))

  it.effect("reports failing handlers and dispatches to onError", () =>
    Effect.gen(function*() {
      const d = startDoc()
      const failing = new Plugin({
        filterTransaction: (tr: Transaction<AnySchema>) =>
          Option.isSome(tr.getMeta("boom")) ? Effect.fail(new Boom({ reason: "filter" })) : true
      })
      const state = EditorState.createUnsafe({ doc: d, selection: selFor(d), plugins: [failing] })
      const errors: Array<unknown> = []
      const view = yield* EditorView.make(workspace(), {
        state,
        onError: (cause) => errors.push(Cause.squash(cause)),
        handleKeyDown: (_view, event) => event.key === "q" ? Effect.fail(new Boom({ reason: "handler" })) : false
      })
      // A failing handler is reported and treated as not handled.
      const event = keyDown(view, "q", 81)
      ist(!event.defaultPrevented)
      ist(errors.length, 1)
      ist((errors[0] as Boom).reason, "handler")
      // `dispatch` reports plugin failures instead of failing.
      yield* view.dispatch(view.state.tr.insertTextUnsafe("x").setMeta("boom", true))
      ist(errors.length, 2)
      ist((errors[1] as Boom).reason, "filter")
      ist(view.state.doc, doc(p("foo")), eq)
      // `tryDispatch` fails with the typed error.
      const exit = yield* Effect.exit(view.tryDispatch(view.state.tr.setMeta("boom", true)))
      ist(Exit.isFailure(exit))
      ist(errors.length, 2)
      // `dispatchUnsafe` throws it.
      let thrown: unknown
      try {
        view.dispatchUnsafe(view.state.tr.setMeta("boom", true))
      } catch (e) {
        thrown = e
      }
      ist((thrown as Boom).reason, "filter")
    }).pipe(Effect.scoped))

  it.effect("works with keymap plugins and commands", () =>
    Effect.gen(function*() {
      const d = doc(p("foo<a>bar"))
      const state = EditorState.createUnsafe({ doc: d, selection: selFor(d), plugins: [keymap(baseKeymap)] })
      const view = yield* EditorView.make(workspace(), { state })
      const event = keyDown(view, "Enter", 13)
      ist(event.defaultPrevented)
      ist(view.state.doc, doc(p("foo"), p("bar")), eq)
    }).pipe(Effect.scoped))

  it.effect("runs the history plugin's beforeinput handler", () =>
    Effect.gen(function*() {
      const d = startDoc()
      const state = EditorState.createUnsafe({ doc: d, selection: selFor(d), plugins: [history()] })
      const view = yield* EditorView.make(workspace(), { state })
      yield* view.dispatch(view.state.tr.insertTextUnsafe("!"))
      ist(view.state.doc, doc(p("foo!")), eq)
      const event = new InputEvent("beforeinput", { inputType: "historyUndo", bubbles: true, cancelable: true })
      view.dom.dispatchEvent(event)
      ist(event.defaultPrevented)
      ist(view.state.doc, doc(p("foo")), eq)
    }).pipe(Effect.scoped))

  it("supports makeUnsafe with an explicit context", () => {
    const d = startDoc()
    const state = Effect.runSync(
      EditorState.create({ doc: d, selection: selFor(d), plugins: [stepCountPlugin] }).pipe(
        Effect.provideService(Counter, { step: 3 })
      )
    )
    const view = EditorView.makeUnsafe(workspace(), { state }, Context.make(Counter, { step: 3 }))
    try {
      view.dispatchUnsafe(view.state.tr.insertTextUnsafe("a"))
      ist(count(view.state), 3)
    } finally {
      view.destroy()
    }
  })

  it("rejects direct plugins with state", () => {
    const d = startDoc()
    const state = EditorState.createUnsafe({ doc: d, schema })
    let thrown: unknown
    try {
      EditorView.makeUnsafe(workspace(), {
        state,
        plugins: [new Plugin({ state: { init: () => 0, apply: (_tr: Transaction<AnySchema>, v: number) => v } })]
      })
    } catch (e) {
      thrown = e
    }
    ist(thrown instanceof Error)
  })
})
