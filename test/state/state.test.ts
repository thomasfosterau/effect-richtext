// Ported from prosemirror-state/test/test-state.ts (MIT, Marijn Haverbeke and others)
import { assert, describe, it } from "@effect/vitest"
import { Context, Data, Effect, Layer, Option } from "effect"
import type { AnySchema } from "effect-richtext/model"
import {
  type Command,
  EditorState,
  Plugin,
  PluginKey,
  type StateError,
  TextSelection,
  type Transaction
} from "effect-richtext/state"
import { doc, eq, p, schema } from "effect-richtext/test-builder"
import ist from "../utils/ist.ts"
import { TestState } from "./state.ts"

const messageCountKey = new PluginKey<number>("messageCount")
const messageCountPlugin = new Plugin({
  key: messageCountKey,
  state: {
    init() {
      return 0
    },
    apply(_, count) {
      return count + 1
    },
    toJSON(count) {
      return count
    },
    fromJSON(_, count) {
      return count as number
    }
  },
  props: {
    testProp() {
      return this
    }
  }
})

const transactionPlugin = new Plugin({
  filterTransaction(tr) {
    return !Option.getOrUndefined(tr.getMeta("filtered"))
  },
  appendTransaction(trs, _, state) {
    const last = trs[trs.length - 1]
    if (last && Option.getOrUndefined(last.getMeta("append"))) return state.tr.insertTextUnsafe("A")
    return undefined
  }
})

const count = (plugin: Plugin<number, any, any, any>, state: EditorState<any, any, any>) =>
  Option.getOrThrow(plugin.getState(state))

describe("State", () => {
  it("creates a default doc", () => {
    const state = EditorState.createUnsafe({ schema })
    ist(state.doc, doc(p()), eq)
  })

  it("creates a default selection", () => {
    const state = EditorState.createUnsafe({ doc: doc(p("foo")) })
    ist(state.selection.from, 1)
    ist(state.selection.to, 1)
  })

  it("applies transform transactions", () => {
    const state = EditorState.createUnsafe({ schema })
    const newState = state.applyUnsafe(state.tr.insertTextUnsafe("hi"))
    ist(state.doc, doc(p()), eq)
    ist(newState.doc, doc(p("hi")), eq)
    ist(newState.selection.from, 3)
  })

  it("supports plugin fields", () => {
    const state = EditorState.createUnsafe({ plugins: [messageCountPlugin], schema })
    const newState = state.applyUnsafe(state.tr).applyUnsafe(state.tr)
    ist(count(messageCountPlugin, state), 0)
    ist(count(messageCountPlugin, newState), 2)
  })

  it("can be serialized to JSON", () => {
    let state = EditorState.createUnsafe({ plugins: [messageCountPlugin], doc: doc(p("ok")) })
    state = state.applyUnsafe(state.tr.setSelectionUnsafe(TextSelection.createUnsafe(state.doc, 3)))
    const pluginProps = { count: messageCountPlugin }
    const expected = {
      doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "ok" }] }] },
      selection: { type: "text", anchor: 3, head: 3 },
      count: 1
    }
    const json = state.toJSON(pluginProps)
    ist(JSON.stringify(json), JSON.stringify(expected))
    const copy = EditorState.fromJSONUnsafe({ plugins: [messageCountPlugin], schema }, json, pluginProps)
    ist(copy.doc, state.doc, eq)
    ist(copy.selection.from, 3)
    ist(count(messageCountPlugin, copy), 1)

    const limitedJSON = state.toJSON()
    ist(limitedJSON.doc)
    ist((limitedJSON as any)["messageCount$"], undefined)
    const deserialized = EditorState.fromJSONUnsafe({ plugins: [messageCountPlugin], schema }, limitedJSON)
    ist(count(messageCountPlugin, deserialized), 0)
  })

  it("supports specifying and persisting storedMarks", () => {
    const state = EditorState.createUnsafe({ doc: doc(p("ok")), storedMarks: [schema.markUnsafe("em")] })
    ist(Option.getOrThrow(state.storedMarks).length, 1)
    const copy = EditorState.fromJSONUnsafe({ schema }, state.toJSON())
    ist(Option.getOrThrow(copy.storedMarks).length, 1)
  })

  it("supports reconfiguration", () => {
    const state = EditorState.createUnsafe({ plugins: [messageCountPlugin], schema })
    ist(count(messageCountPlugin, state), 0)
    const without = state.reconfigureUnsafe({})
    ist(Option.isNone(messageCountPlugin.getState(without)))
    ist(without.plugins.length, 0)
    ist(without.doc, doc(p()), eq)
    const reAdd = without.reconfigureUnsafe({ plugins: [messageCountPlugin] })
    ist(count(messageCountPlugin, reAdd), 0)
    ist(reAdd.plugins.length, 1)
  })

  it("allows plugins to filter transactions", () => {
    const state = EditorState.createUnsafe({ plugins: [transactionPlugin], schema })
    let applied = state.applyTransactionUnsafe(state.tr.insertTextUnsafe("X"))
    ist(applied.state.doc, doc(p("X")), eq)
    ist(applied.transactions.length, 1)
    applied = state.applyTransactionUnsafe(state.tr.insertTextUnsafe("Y").setMeta("filtered", true))
    ist(applied.state, state)
    ist(applied.transactions.length, 0)
  })

  it("allows plugins to append transactions", () => {
    const state = EditorState.createUnsafe({ plugins: [transactionPlugin], schema })
    const applied = state.applyTransactionUnsafe(state.tr.insertTextUnsafe("X").setMeta("append", true))
    ist(applied.state.doc, doc(p("XA")), eq)
    ist(applied.transactions.length, 2)
  })

  it("stores a reference to a root transaction for appended transactions", () => {
    const state = EditorState.createUnsafe({
      schema,
      plugins: [
        new Plugin({
          appendTransaction: (_trs, _oldState, newState) => newState.tr.insertTextUnsafe("Y")
        })
      ]
    })
    const { transactions } = state.applyTransactionUnsafe(state.tr.insertTextUnsafe("X"))
    ist(transactions.length, 2)
    ist(Option.getOrThrow(transactions[1]!.getMeta("appendedTransaction")), transactions[0])
  })

  it("supports JSON.stringify toJSON arguments", () => {
    const someObject = { someKey: EditorState.createUnsafe({ schema }) }
    ist(JSON.stringify(someObject).length > 0)
  })
})

describe("Plugin", () => {
  it("calls prop functions bound to the plugin", () => {
    ist((messageCountPlugin.props as any).testProp(), messageCountPlugin)
  })

  it("can be found by key", () => {
    const state = EditorState.createUnsafe({ plugins: [messageCountPlugin], schema })
    ist(Option.getOrThrow(messageCountKey.get(state)), messageCountPlugin)
    ist(Option.getOrThrow(messageCountKey.getState(state)), 0)
  })

  it("generates new keys", () => {
    const p1 = new Plugin({}), p2 = new Plugin({})
    ist(p1.key != p2.key)
    const k1 = new PluginKey("foo"), k2 = new PluginKey("foo")
    ist(k1.key != k2.key)
  })
})

// -----------------------------------------------------------------------------
// Effect-specific behaviour
// -----------------------------------------------------------------------------

class Counter extends Context.Service<Counter, { readonly step: number }>()("test/Counter") {}

class Rejected extends Data.TaggedError("Rejected")<{ readonly reason: string }> {}

// A plugin whose state hooks require a service.
const stepCountPlugin = new Plugin({
  state: {
    init: () =>
      Effect.gen(function*() {
        yield* Counter
        return 0
      }),
    apply: (_tr: Transaction<AnySchema>, value: number) =>
      Effect.gen(function*() {
        const counter = yield* Counter
        return value + counter.step
      })
  }
})

// A plugin whose state `apply` returns an Effect but needs no services.
const docSizePlugin = new Plugin({
  state: {
    init: (_config, instance) => instance.doc.content.size,
    apply: (tr: Transaction<AnySchema>) => Effect.succeed(tr.doc.content.size)
  }
})

// A plugin whose filter can fail with a typed error.
const strictPlugin = new Plugin({
  filterTransaction: (tr: Transaction<AnySchema>) =>
    Option.isSome(tr.getMeta("reject")) ? Effect.fail(new Rejected({ reason: "rejected" })) : true
})

describe("EditorState (Effect API)", () => {
  it.effect("runs plugins that require services", () =>
    Effect.gen(function*() {
      const state = yield* EditorState.create({ schema, plugins: [stepCountPlugin, messageCountPlugin] })
      // @ts-expect-error -- applyUnsafe is not available when plugins require services
      const _unavailable = () => state.applyUnsafe(state.tr)
      void _unavailable
      const next = yield* state.apply(state.tr.insertTextUnsafe("a"))
      const last = yield* next.apply(next.tr.insertTextUnsafe("b"))
      ist(last.doc, doc(p("ab")), eq)
      ist(count(stepCountPlugin, last), 6)
      ist(count(messageCountPlugin, last), 2)
    }).pipe(Effect.provide(Layer.succeed(Counter, { step: 3 }))))

  it("infers requirements and errors from plugins", () => {
    const program = EditorState.create({ schema, plugins: [stepCountPlugin, strictPlugin] })
    // The program requires `Counter` and may fail with `Rejected`.
    const _check: Effect.Effect<EditorState<any, Counter, Rejected>, Rejected | StateError, Counter> = program
    void _check
    ist(stepCountPlugin.spec.state !== undefined)
  })

  it("supports state fields whose apply returns an Effect", () => {
    const state = EditorState.createUnsafe({ doc: doc(p("ab")), plugins: [docSizePlugin] })
    ist(count(docSizePlugin, state), 4)
    const next = state.applyUnsafe(state.tr.insertTextUnsafe("cd"))
    ist(count(docSizePlugin, next), 6)
  })

  it.effect("propagates typed plugin errors", () =>
    Effect.gen(function*() {
      const state = yield* EditorState.create({ schema, plugins: [strictPlugin] })
      const ok = yield* state.apply(state.tr.insertTextUnsafe("x"))
      ist(ok.doc, doc(p("x")), eq)
      const err = yield* Effect.flip(state.apply(state.tr.insertTextUnsafe("y").setMeta("reject", true)))
      assert.strictEqual(err._tag, "Rejected")
      ist.throws(() => state.applyUnsafe(state.tr.setMeta("reject", true)), (e) => e instanceof Rejected)
    }))

  it.effect("fails with StateError for mismatched transactions and duplicate keyed plugins", () =>
    Effect.gen(function*() {
      const state = yield* EditorState.create({ schema })
      const other = yield* EditorState.create({ doc: doc(p("other")) })
      const err = yield* Effect.flip(state.apply(other.tr.insertTextUnsafe("x")))
      assert.strictEqual(err._tag, "StateError")
      const dup = new Plugin({ key: messageCountKey })
      const dupErr = yield* Effect.flip(EditorState.create({ schema, plugins: [messageCountPlugin, dup] }))
      assert.strictEqual(dupErr._tag, "StateError")
      const noSchema = yield* Effect.flip(EditorState.create({}))
      assert.strictEqual(noSchema._tag, "StateError")
    }))

  it.effect("fails setSelection with a SelectionError for foreign documents", () =>
    Effect.gen(function*() {
      const state = yield* EditorState.create({ doc: doc(p("abc")) })
      const tr = state.tr.insertTextUnsafe("x", 1)
      const err = yield* Effect.flip(tr.setSelection(TextSelection.createUnsafe(state.doc, 2)))
      assert.strictEqual(err._tag, "SelectionError")
      yield* tr.setSelection(TextSelection.createUnsafe(tr.doc, 2))
      ist(tr.selectionSet)
    }))

  it.effect("round-trips states through JSON as effects", () =>
    Effect.gen(function*() {
      const state = yield* EditorState.create({ doc: doc(p("ok")), plugins: [messageCountPlugin] })
      const json = state.toJSON({ count: messageCountPlugin })
      const copy = yield* EditorState.fromJSON({ schema, plugins: [messageCountPlugin] }, json, {
        count: messageCountPlugin
      })
      ist(copy.doc, state.doc, eq)
      const bad = yield* Effect.flip(EditorState.fromJSON({ schema }, { doc: { type: "nope" }, selection: {} }))
      assert.strictEqual(bad._tag, "JSONError")
      ist.throws(() => state.toJSON({ doc: messageCountPlugin }), /reserved/)
    }))

  it("tracks metadata and stored marks", () => {
    const state = EditorState.createUnsafe({ doc: doc(p("ab")) })
    const tr = state.tr
    ist(tr.isGeneric)
    ist(Option.isNone(tr.getMeta("x")))
    tr.setMeta("x", undefined)
    ist(Option.isSome(tr.getMeta("x")))
    ist(!tr.isGeneric)
    tr.addStoredMark(schema.markUnsafe("em"))
    ist(tr.storedMarksSet)
    ist(Option.getOrThrow(tr.storedMarks).length, 1)
    tr.removeStoredMark(schema.marks.em)
    ist(Option.getOrThrow(tr.storedMarks).length, 0)
    ist(!tr.scrolledIntoView)
    ist(state.applyUnsafe(tr.scrollIntoView()).doc, state.doc)
  })
})

describe("Command", () => {
  const insertX: Command<AnySchema> = (state, dispatch) =>
    Effect.gen(function*() {
      if (!state.selection.empty) return false
      if (dispatch) yield* dispatch(state.tr.insertTextUnsafe("x"))
      return true
    })

  it("runs commands with a dispatch function", () => {
    const state = new TestState({ doc: doc(p("a<a>b")) })
    ist(state.command(insertX), true)
    ist(state.doc, doc(p("axb")), eq)
    ist(Effect.runSync(insertX(state.state)), true)
    ist(state.doc, doc(p("axb")), eq)
    state.textSel(1, 3)
    ist(state.command(insertX), false)
  })

  it.effect("supports commands that require services", () => {
    const insertStep: Command<AnySchema, never, Counter> = (state, dispatch) =>
      Effect.gen(function*() {
        const { step } = yield* Counter
        if (dispatch) yield* dispatch(state.tr.insertTextUnsafe(String(step)))
        return true
      })
    return Effect.gen(function*() {
      let state = yield* EditorState.create({ doc: doc(p("<a>")) })
      const ok = yield* insertStep(state, (tr) => Effect.sync(() => (state = state.applyUnsafe(tr))))
      ist(ok)
      ist(state.doc, doc(p("7")), eq)
    }).pipe(Effect.provideService(Counter, { step: 7 }))
  })
})
