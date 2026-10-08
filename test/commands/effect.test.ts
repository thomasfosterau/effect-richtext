// Tests for the Effect-specific behaviour of commands (not ported from ProseMirror).
import { assert, describe, it } from "@effect/vitest"
import { Context, Data, Effect, Layer } from "effect"
import {
  autoJoin,
  baseKeymap,
  chainCommands,
  deleteSelection,
  joinBackward,
  joinForward,
  macBaseKeymap,
  pcBaseKeymap,
  selectNodeBackward,
  selectNodeForward,
  type TextblockBoundaryView
} from "effect-richtext/commands"
import type { AnySchema } from "effect-richtext/model"
import type { Command, EditorState, Transaction } from "effect-richtext/state"
import { blockquote, doc, eq, p } from "effect-richtext/test-builder"
import ist from "../utils/ist.ts"
import { apply, mkState } from "./apply.ts"

class Log extends Context.Service<Log, { readonly entries: Array<string> }>()("test/Log") {}

class Denied extends Data.TaggedError("Denied")<{ readonly reason: string }> {}

class Other extends Data.TaggedError("Other")<{}> {}

/** A command that needs the `Log` service and declines. */
const logged: Command<AnySchema, never, Log> = () =>
  Effect.gen(function*() {
    const log = yield* Log
    log.entries.push("logged")
    return false
  })

/** A command that fails with a typed error. */
const denied: Command<AnySchema, Denied> = (_state, dispatch) =>
  dispatch ? Effect.fail(new Denied({ reason: "read-only" })) : Effect.succeed(true)

const other: Command<AnySchema, Other> = () => Effect.fail(new Other())

const runWith = <E, R>(
  state: EditorState<any>,
  command: Command<any, E, R>,
  view?: unknown
): Effect.Effect<{ readonly handled: boolean; readonly state: EditorState<any> }, E, R> =>
  Effect.gen(function*() {
    let current = state
    const handled = yield* command(current, (tr: Transaction<any>) =>
      Effect.sync(() => {
        current = current.applyUnsafe(tr)
      }), view)
    return { handled, state: current }
  })

describe("chainCommands", () => {
  it("infers the union of errors and requirements", () => {
    const chained = chainCommands(logged, denied, deleteSelection, other)
    const _check: Command<AnySchema, Denied | Other, Log> = chained
    void _check
    // @ts-expect-error -- the chain requires `Log`
    const _noLog: Command<AnySchema, Denied | Other, never> = chained
    void _noLog
    // @ts-expect-error -- the chain may fail with `Other`
    const _noOther: Command<AnySchema, Denied, Log> = chained
    void _noOther
    const plain = chainCommands(deleteSelection, joinBackward)
    const _plain: Command<AnySchema, never, never> = plain
    void _plain
  })

  it.effect("propagates service requirements to the inner commands", () =>
    Effect.gen(function*() {
      const entries: Array<string> = []
      const chained = chainCommands(logged, joinBackward)
      const result = yield* runWith(mkState(doc(p("hi"), p("<a>there"))), chained).pipe(
        Effect.provide(Layer.succeed(Log, { entries }))
      )
      ist(result.handled)
      ist(result.state.doc, doc(p("hithere")), eq)
      assert.deepStrictEqual(entries, ["logged"])
    }))

  it.effect("stops at the first command that handles the state", () =>
    Effect.gen(function*() {
      const entries: Array<string> = []
      const chained = chainCommands(joinBackward, logged)
      const result = yield* runWith(mkState(doc(p("hi"), p("<a>there"))), chained).pipe(
        Effect.provide(Layer.succeed(Log, { entries }))
      )
      ist(result.handled)
      assert.deepStrictEqual(entries, [])
    }))

  it.effect("succeeds with false when no command applies", () =>
    Effect.gen(function*() {
      const result = yield* runWith(mkState(doc(p("<a>foo"))), chainCommands(deleteSelection, joinBackward))
      ist(result.handled, false)
    }))

  it.effect("fails with the typed error of a failing command", () =>
    Effect.gen(function*() {
      const chained = chainCommands(deleteSelection, denied, joinBackward)
      const error = yield* Effect.flip(runWith(mkState(doc(p("hi"), p("<a>there"))), chained))
      assert.strictEqual(error._tag, "Denied")
      assert.strictEqual(error.reason, "read-only")
      // Without dispatch, the failing command only reports applicability.
      const query = yield* chained(mkState(doc(p("<a>foo"))))
      ist(query)
    }))
})

describe("autoJoin", () => {
  it.effect("preserves the wrapped command's errors and requirements", () =>
    Effect.gen(function*() {
      const joined = autoJoin(chainCommands(logged, denied), ["bullet_list"])
      const _check: Command<AnySchema, Denied, Log> = joined
      void _check
      const entries: Array<string> = []
      const error = yield* Effect.flip(
        runWith(mkState(doc(p("<a>foo"))), joined).pipe(Effect.provide(Layer.succeed(Log, { entries })))
      )
      assert.strictEqual(error._tag, "Denied")
      assert.deepStrictEqual(entries, ["logged"])
    }))
})

describe("commands without dispatch", () => {
  it.effect("only report applicability", () =>
    Effect.gen(function*() {
      const state = mkState(doc(p("hi"), p("<a>there")))
      ist(yield* joinBackward(state))
      ist(yield* deleteSelection(state), false)
    }))
})

describe("commands with a view", () => {
  const view = (atEnd: boolean): TextblockBoundaryView & { calls: Array<string> } => {
    const calls: Array<string> = []
    return {
      calls,
      endOfTextblock(dir) {
        calls.push(dir)
        return atEnd
      }
    }
  }

  it.effect("use the view's endOfTextblock when available", () =>
    Effect.gen(function*() {
      // The cursor isn't at offset 0, but the view says it is at the start of the textblock.
      const v = view(true)
      const result = yield* runWith(mkState(doc(blockquote(p("a")), blockquote(p("b<a>")))), selectNodeBackward, v)
      ist(result.handled)
      assert.deepStrictEqual(v.calls, ["backward"])
      const declined = view(false)
      const r2 = yield* runWith(mkState(doc(p("hi"), p("<a>there"))), joinBackward, declined)
      ist(r2.handled, false)
      assert.deepStrictEqual(declined.calls, ["backward"])
      const fwd = view(false)
      ist((yield* runWith(mkState(doc(p("foo<a>"), p("bar"))), joinForward, fwd)).handled, false)
      ist((yield* runWith(mkState(doc(p("foo<a>"), p("bar"))), selectNodeForward, fwd)).handled, false)
      assert.deepStrictEqual(fwd.calls, ["forward", "forward"])
    }))

  it("fall back to offsets for views without endOfTextblock", () =>
    apply(doc(p("hi"), p("<a>there")), (state, dispatch) => joinBackward(state, dispatch, {}), doc(p("hithere"))))
})

describe("base keymaps", () => {
  it("binds the standard keys", () => {
    for (const key of ["Enter", "Mod-Enter", "Backspace", "Mod-Backspace", "Shift-Backspace", "Delete", "Mod-Delete"]) {
      ist(typeof pcBaseKeymap[key], "function")
    }
    ist(macBaseKeymap["Ctrl-h"], pcBaseKeymap["Backspace"])
    ist(macBaseKeymap["Mod-a"], pcBaseKeymap["Mod-a"])
    ist(baseKeymap === pcBaseKeymap || baseKeymap === macBaseKeymap)
  })

  it("Enter splits a block", () => apply(doc(p("foo<a>bar")), pcBaseKeymap["Enter"]!, doc(p("foo"), p("bar"))))

  it("Backspace joins blocks", () => apply(doc(p("foo"), p("<a>bar")), pcBaseKeymap["Backspace"]!, doc(p("foobar"))))

  it("Delete joins blocks", () => apply(doc(p("foo<a>"), p("bar")), pcBaseKeymap["Delete"]!, doc(p("foobar"))))
})
