import { assert, describe, it } from "@effect/vitest"
import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import { lift, toggleMark, wrapIn } from "effect-richtext/commands"
import type { AnySchema, Node } from "effect-richtext/model"
import { StateRef } from "effect-richtext/reactive"
import { EditorState, Plugin, StateError, TextSelection, type Transaction } from "effect-richtext/state"
import { blockquote, doc, eq, h1, p, schema, strong } from "effect-richtext/test-builder"
import { selFor } from "../state/state.ts"
import ist from "../utils/ist.ts"
import { collect } from "./helpers.ts"
import { getSome } from "../utils/option.ts"

const stateFor = (d: Node<any>, plugins?: ReadonlyArray<Plugin<any, any, any, never>>) =>
  EditorState.createUnsafe({ doc: d, selection: selFor(d), plugins })

class Step extends Context.Service<Step, { readonly step: number }>()("test/Step") {}
class Boom extends Data.TaggedError("Boom")<{}> {}

const countPlugin = new Plugin({
  state: {
    init: () => 0,
    apply: (_tr: Transaction<AnySchema>, n: number) => Effect.map(Effect.service(Step), (s) => n + s.step)
  }
})

describe("StateRef", () => {
  it.effect("holds the state and applies dispatched transactions", () =>
    Effect.gen(function* () {
      const ref = yield* StateRef.make(stateFor(doc(p("foo<a>"))))
      const states = yield* collect(ref.state.changes, 3)
      yield* ref.dispatch(ref.state.getUnsafe().tr.insertTextUnsafe("!"))
      ref.dispatchUnsafe(ref.state.getUnsafe().tr.insertTextUnsafe("?"))
      const seen = yield* Fiber.join(states)
      assert.deepStrictEqual(
        seen.map((s) => s.doc.textContent),
        ["foo", "foo!", "foo!?"]
      )
      ist((yield* ref.state.get).doc, doc(p("foo!?")), eq)
      // Late subscribers get the current state.
      const late = yield* Stream.runHead(ref.state.changes)
      ist(getSome(late).doc, doc(p("foo!?")), eq)
    }).pipe(Effect.scoped)
  )

  it.effect("publishes transactions (hot), including appended ones", () =>
    Effect.gen(function* () {
      const appender = new Plugin({
        appendTransaction: (
          trs: ReadonlyArray<Transaction<AnySchema>>,
          _old,
          state: EditorState<AnySchema, any, any>
        ) => (trs.some((tr) => Option.isSome(tr.getMeta("append"))) ? state.tr.insertTextUnsafe("+") : null)
      })
      const ref = yield* StateRef.make(stateFor(doc(p("a<a>")), [appender]))
      // Not seen by the subscriber, which subscribes afterwards.
      yield* ref.dispatch(ref.state.getUnsafe().tr.insertTextUnsafe("b"))
      const events = yield* collect(ref.transactions, 2)
      const before = ref.state.getUnsafe()
      const tr = before.tr.insertTextUnsafe("c").setMeta("append", true)
      yield* ref.dispatch(tr)
      yield* ref.dispatch(ref.state.getUnsafe().tr.insertTextUnsafe("d"))
      const [first, second] = yield* Fiber.join(events)
      ist(first!.tr, tr)
      ist(first!.transactions.length, 2)
      ist(first!.prevState, before)
      ist(first!.state.doc, doc(p("abc+")), eq)
      ist(second!.prevState, first!.state)
      ist(second!.state.doc, doc(p("abc+d")), eq)
    }).pipe(Effect.scoped)
  )

  it.effect("emits docChanges only when the document changes, and deduplicates selections", () =>
    Effect.gen(function* () {
      const ref = yield* StateRef.make(stateFor(doc(p("<a>foo"))))
      const docs = yield* collect(ref.docChanges)
      const selections = yield* collect(ref.selection)
      const state = ref.state.getUnsafe()
      // Selection-only change.
      yield* ref.dispatch(state.tr.setSelectionUnsafe(TextSelection.createUnsafe(state.doc, 2)))
      // Same selection again: deduplicated.
      const state2 = ref.state.getUnsafe()
      yield* ref.dispatch(state2.tr.setSelectionUnsafe(TextSelection.createUnsafe(state2.doc, 2)))
      yield* ref.dispatch(ref.state.getUnsafe().tr.insertTextUnsafe("x"))
      return { docs, selections }
    }).pipe(
      Effect.scoped,
      Effect.flatMap(({ docs, selections }) =>
        Effect.gen(function* () {
          const ds = yield* Fiber.join(docs)
          ist(ds.length, 2)
          ist(ds[0], doc(p("foo")), eq)
          ist(ds[1], doc(p("fxoo")), eq)
          assert.deepStrictEqual(
            (yield* Fiber.join(selections)).map((s) => s.head),
            [1, 2, 3]
          )
        })
      )
    )
  )

  it.effect("derives deduplicated projections with select", () =>
    Effect.gen(function* () {
      const ref = yield* StateRef.make(stateFor(doc(p("one two<a>"))))
      const wordCount = (s: EditorState<any, any, any>) => s.doc.textContent.split(/\s+/).filter(Boolean).length
      const counts = yield* collect(ref.select(wordCount))
      const lengths = yield* collect(
        ref.select(
          (s) => s.doc.textContent,
          (a, b) => a.length === b.length
        )
      )
      yield* ref.dispatch(ref.state.getUnsafe().tr.insertTextUnsafe("s")) // same word count
      yield* ref.dispatch(ref.state.getUnsafe().tr.insertTextUnsafe(" three"))
      yield* ref.dispatch(ref.state.getUnsafe().tr.insertTextUnsafe("!"))
      ist(ref.state.getUnsafe().doc.textContent, "one twos three!")
      return { counts, lengths }
    }).pipe(
      Effect.scoped,
      // The streams end when the scope closes.
      Effect.flatMap(({ counts, lengths }) =>
        Effect.gen(function* () {
          assert.deepStrictEqual(yield* Fiber.join(counts), [2, 3])
          ist((yield* Fiber.join(lengths)).length, 4)
        })
      )
    )
  )

  it.effect("tracks active marks and nodes, and executable commands", () =>
    Effect.gen(function* () {
      const ref = yield* StateRef.make(stateFor(doc(p("f<a>oo"), h1("bar"))))
      const strongActive = yield* collect(ref.isMarkActive("strong"))
      const inHeading = yield* collect(ref.isNodeActive("heading", { level: 1 }))
      const inBlockquote = yield* collect(ref.isNodeActive(schema.nodes.blockquote))
      const canLift = yield* collect(ref.canExecute(lift))

      ist(yield* ref.execute(toggleMark(schema.marks.strong)))
      ist(Option.isSome(ref.state.getUnsafe().storedMarks))
      yield* ref.dispatch(ref.state.getUnsafe().tr.insertTextUnsafe("x"))
      ist(ref.state.getUnsafe().doc, doc(p("f", strong("x"), "oo"), h1("bar")), eq)
      ist(yield* ref.execute(wrapIn(schema.nodes.blockquote)))
      ist(ref.state.getUnsafe().doc, doc(blockquote(p("f", strong("x"), "oo")), h1("bar")), eq)
      const s = ref.state.getUnsafe()
      yield* ref.dispatch(s.tr.setSelectionUnsafe(TextSelection.createUnsafe(s.doc, s.doc.content.size - 2)))
      return { strongActive, inHeading, inBlockquote, canLift }
    }).pipe(
      Effect.scoped,
      Effect.flatMap((fibers) =>
        Effect.gen(function* () {
          assert.deepStrictEqual(yield* Fiber.join(fibers.strongActive), [false, true, false])
          assert.deepStrictEqual(yield* Fiber.join(fibers.inHeading), [false, true])
          assert.deepStrictEqual(yield* Fiber.join(fibers.inBlockquote), [false, true, false])
          assert.deepStrictEqual(yield* Fiber.join(fibers.canLift), [false, true, false])
        })
      )
    )
  )

  it.effect("runs plugins with the captured context", () =>
    Effect.gen(function* () {
      const d = doc(p("a<a>"))
      const state = yield* EditorState.create({ doc: d, selection: selFor(d), plugins: [countPlugin] })
      const ref = yield* StateRef.make(state)
      // `dispatch` requires nothing: the context was captured by `make`.
      const dispatch: Effect.Effect<void, unknown, never> = ref.dispatch(ref.state.getUnsafe().tr.insertTextUnsafe("b"))
      yield* dispatch
      ref.dispatchUnsafe(ref.state.getUnsafe().tr.insertTextUnsafe("c"))
      ist(getSome(countPlugin.getState(ref.state.getUnsafe())), 6)
    }).pipe(Effect.scoped, Effect.provide(Layer.succeed(Step, { step: 3 })))
  )

  it.effect("fails with plugin errors and mismatched transactions", () =>
    Effect.gen(function* () {
      const failing = new Plugin({
        filterTransaction: (tr: Transaction<AnySchema>) =>
          Option.isSome(tr.getMeta("boom")) ? Effect.fail(new Boom()) : true
      })
      const ref = yield* StateRef.make(stateFor(doc(p("a<a>")), [failing]))
      const stale = ref.state.getUnsafe().tr.insertTextUnsafe("x")
      yield* ref.dispatch(ref.state.getUnsafe().tr.insertTextUnsafe("b"))
      const mismatch = yield* Effect.flip(ref.dispatch(stale))
      ist(mismatch instanceof StateError)
      const boom = yield* Effect.flip(ref.dispatch(ref.state.getUnsafe().tr.setMeta("boom", true)))
      ist(boom instanceof Boom)
      let thrown: unknown
      try {
        ref.dispatchUnsafe(ref.state.getUnsafe().tr.setMeta("boom", true))
      } catch (e) {
        thrown = e
      }
      ist(thrown instanceof Boom)
      // A command whose dispatch fails fails too.
      const exit = yield* Effect.exit(
        ref.execute((state, dispatch) =>
          Effect.as(dispatch ? dispatch(state.tr.setMeta("boom", true)) : Effect.void, true)
        )
      )
      ist(Exit.isFailure(exit))
      ist(ref.state.getUnsafe().doc, doc(p("ab")), eq)
    }).pipe(Effect.scoped)
  )

  it.effect("replaces the state with set", () =>
    Effect.gen(function* () {
      const ref = yield* StateRef.make(stateFor(doc(p("a"))))
      const docs = yield* collect(ref.docChanges, 2)
      const next = stateFor(doc(p("b")))
      yield* ref.set(next)
      ist(ref.state.getUnsafe(), next)
      const [, d] = yield* Fiber.join(docs)
      ist(d, doc(p("b")), eq)
    }).pipe(Effect.scoped)
  )

  it.effect("ends its streams when the scope closes", () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const ref = yield* StateRef.make(stateFor(doc(p("a<a>")))).pipe(Scope.provide(scope))
      const states = yield* collect(ref.state.changes)
      const transactions = yield* collect(ref.transactions)
      const selections = yield* collect(ref.selection)
      yield* ref.dispatch(ref.state.getUnsafe().tr.insertTextUnsafe("b"))
      yield* Scope.close(scope, Exit.void)
      ist((yield* Fiber.join(states)).length, 2)
      ist((yield* Fiber.join(transactions)).length, 1)
      ist((yield* Fiber.join(selections)).length, 2)
    })
  )
})
