// Ported from prosemirror-history/test/test-history.ts (MIT, Marijn Haverbeke and others)
import { describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { closeHistory, history, type HistoryCommand, redo, redoDepth, undo, undoDepth } from "effect-richtext/history"
import { Fragment, type Node, Slice } from "effect-richtext/model"
import { EditorState, Plugin, TextSelection } from "effect-richtext/state"
import { doc, eq, p, schema } from "effect-richtext/test-builder"
import { ReplaceStep } from "effect-richtext/transform"
import ist from "../utils/ist.ts"
import { getSome } from "../utils/option.ts"

type State = EditorState<typeof schema, never, any>

const plugin = history()

function mkState(doc?: Node<any>, config?: any): State {
  const plugins: Array<Plugin<any, any, any>> = [config ? history(config) : plugin]
  if (config && config.preserveItems) plugins.push(new Plugin({ historyPreserveItems: true }))
  return EditorState.createUnsafe({ schema, plugins: plugins.concat((config && config.plugins) || []), doc })
}

function type(state: State, text: string): State {
  return state.applyUnsafe(state.tr.insertTextUnsafe(text))
}
function command(state: State, command: HistoryCommand): State {
  Effect.runSync(command(state, (tr) => Effect.sync(() => (state = state.applyUnsafe(tr)))))
  return state
}

function compress(state: State) {
  // NOTE: This is mutating stuff that shouldn't be mutated. Not safe
  // to do outside of these tests.
  const hist = getSome(plugin.getState(state)) as any
  hist.done = hist.done.compress()
}

describe("history", () => {
  it("enables undo", () => {
    let state = mkState()
    state = type(state, "a")
    state = type(state, "b")
    ist(state.doc, doc(p("ab")), eq)
    state = command(state, undo)
    ist(state.doc, doc(p()), eq)
  })

  it("enables redo", () => {
    let state = mkState()
    state = type(state, "a")
    state = type(state, "b")
    state = command(state, undo)
    ist(state.doc, doc(p()), eq)
    state = command(state, redo)
    ist(state.doc, doc(p("ab")), eq)
  })

  it("tracks multiple levels of history", () => {
    let state = mkState()
    state = type(state, "a")
    state = type(state, "b")
    state = state.applyUnsafe(state.tr.insertTextUnsafe("c", 1))
    ist(state.doc, doc(p("cab")), eq)
    state = command(state, undo)
    ist(state.doc, doc(p("ab")), eq)
    state = command(state, undo)
    ist(state.doc, doc(p()), eq)
    state = command(state, redo)
    ist(state.doc, doc(p("ab")), eq)
    state = command(state, redo)
    ist(state.doc, doc(p("cab")), eq)
    state = command(state, undo)
    ist(state.doc, doc(p("ab")), eq)
  })

  it("starts a new event when newGroupDelay elapses", () => {
    let state = mkState(undefined, { newGroupDelay: 1000 })
    state = state.applyUnsafe(state.tr.insertTextUnsafe("a").setTime(1000))
    state = state.applyUnsafe(state.tr.insertTextUnsafe("b").setTime(1600))
    ist(undoDepth(state), 1)
    state = state.applyUnsafe(state.tr.insertTextUnsafe("c").setTime(2700))
    ist(undoDepth(state), 2)
    state = command(state, undo)
    state = state.applyUnsafe(state.tr.insertTextUnsafe("d").setTime(2800))
    ist(undoDepth(state), 2)
  })

  it("starts a new event for non-adjacent changes", () => {
    let state = mkState(doc(p("abc")), { newGroupDelay: 1000 })
    state = state.applyUnsafe(state.tr.insertTextUnsafe("x", 1))
    state = state.applyUnsafe(state.tr.insertTextUnsafe("y", 5))
    ist(undoDepth(state), 2)
  })

  it("doesn't get confused by non-replacement steps when checking adjacency", () => {
    let state = mkState(doc(p()), { newGroupDelay: 1000 })
    state = state.applyUnsafe(state.tr.insertTextUnsafe("x", 1).addMark(1, 2, schema.marks.em.createUnsafe()))
    state = state.applyUnsafe(state.tr.insertTextUnsafe("y", 2).addMark(2, 3, schema.marks.em.createUnsafe()))
    ist(undoDepth(state), 1)
  })

  it("allows changes that aren't part of the history", () => {
    let state = mkState()
    state = type(state, "hello")
    state = state.applyUnsafe(state.tr.insertTextUnsafe("oops", 1).setMeta("addToHistory", false))
    state = state.applyUnsafe(state.tr.insertTextUnsafe("!", 10).setMeta("addToHistory", false))
    state = command(state, undo)
    ist(state.doc, doc(p("oops!")), eq)
  })

  it("doesn't get confused by an undo not adding any redo item", () => {
    let state = mkState()
    state = state.applyUnsafe(state.tr.insertTextUnsafe("foo"))
    state = state.applyUnsafe(state.tr.replaceWithUnsafe(1, 4, schema.textUnsafe("bar")).setMeta("addToHistory", false))
    state = command(state, undo)
    state = command(state, redo)
    ist(state.doc, doc(p("bar")), eq)
  })

  function unsyncedComplex(state: State, doCompress: boolean) {
    state = type(state, "hello")
    state = state.applyUnsafe(closeHistory(state.tr))
    state = type(state, "!")
    state = state.applyUnsafe(state.tr.insertTextUnsafe("....", 1).setMeta("addToHistory", false))
    state = state.applyUnsafe(state.tr.splitUnsafe(3))
    ist(state.doc, doc(p(".."), p("..hello!")), eq)
    state = state.applyUnsafe(state.tr.splitUnsafe(2).setMeta("addToHistory", false))
    if (doCompress) compress(state)
    state = command(state, undo)
    state = command(state, undo)
    ist(state.doc, doc(p("."), p("...hello")), eq)
    state = command(state, undo)
    ist(state.doc, doc(p("."), p("...")), eq)
  }

  it("can handle complex editing sequences", () => {
    unsyncedComplex(mkState(), false)
  })

  it("can handle complex editing sequences with compression", () => {
    unsyncedComplex(mkState(), true)
  })

  it("supports overlapping edits", () => {
    let state = mkState()
    state = type(state, "hello")
    state = state.applyUnsafe(closeHistory(state.tr))
    state = state.applyUnsafe(state.tr.deleteUnsafe(1, 6))
    ist(state.doc, doc(p()), eq)
    state = command(state, undo)
    ist(state.doc, doc(p("hello")), eq)
    state = command(state, undo)
    ist(state.doc, doc(p()), eq)
  })

  it("supports overlapping edits that aren't collapsed", () => {
    let state = mkState()
    state = state.applyUnsafe(state.tr.insertTextUnsafe("h", 1).setMeta("addToHistory", false))
    state = type(state, "ello")
    state = state.applyUnsafe(closeHistory(state.tr))
    state = state.applyUnsafe(state.tr.deleteUnsafe(1, 6))
    ist(state.doc, doc(p()), eq)
    state = command(state, undo)
    ist(state.doc, doc(p("hello")), eq)
    state = command(state, undo)
    ist(state.doc, doc(p("h")), eq)
  })

  it("supports overlapping unsynced deletes", () => {
    let state = mkState()
    state = type(state, "hi")
    state = state.applyUnsafe(closeHistory(state.tr))
    state = type(state, "hello")
    state = state.applyUnsafe(state.tr.deleteUnsafe(1, 8).setMeta("addToHistory", false))
    ist(state.doc, doc(p()), eq)
    state = command(state, undo)
    ist(state.doc, doc(p()), eq)
  })

  it("can go back and forth through history multiple times", () => {
    let state = mkState()
    state = type(state, "one")
    state = type(state, " two")
    state = state.applyUnsafe(closeHistory(state.tr))
    state = type(state, " three")
    state = state.applyUnsafe(state.tr.insertTextUnsafe("zero ", 1))
    state = state.applyUnsafe(closeHistory(state.tr))
    state = state.applyUnsafe(state.tr.splitUnsafe(1))
    state = state.applyUnsafe(state.tr.setSelectionUnsafe(TextSelection.createUnsafe(state.doc, 1)))
    state = type(state, "top")
    for (let i = 0; i < 6; i++) {
      const re = i % 2
      for (let j = 0; j < 4; j++) state = command(state, re ? redo : undo)
      ist(state.doc, re ? doc(p("top"), p("zero one two three")) : doc(p()), eq)
    }
  })

  it("supports non-tracked changes next to tracked changes", () => {
    let state = mkState()
    state = type(state, "o")
    state = state.applyUnsafe(state.tr.splitUnsafe(1))
    state = state.applyUnsafe(state.tr.insertTextUnsafe("zzz", 4).setMeta("addToHistory", false))
    state = command(state, undo)
    ist(state.doc, doc(p("zzz")), eq)
  })

  it("can go back and forth through history when preserving items", () => {
    let state = mkState()
    state = type(state, "one")
    state = type(state, " two")
    state = state.applyUnsafe(closeHistory(state.tr))
    state = state.applyUnsafe(state.tr.insertTextUnsafe("xxx", state.selection.head).setMeta("addToHistory", false))
    state = type(state, " three")
    state = state.applyUnsafe(state.tr.insertTextUnsafe("zero ", 1))
    state = state.applyUnsafe(closeHistory(state.tr))
    state = state.applyUnsafe(state.tr.splitUnsafe(1))
    state = state.applyUnsafe(state.tr.setSelectionUnsafe(TextSelection.createUnsafe(state.doc, 1)))
    state = type(state, "top")
    state = state.applyUnsafe(state.tr.insertTextUnsafe("yyy", 1).setMeta("addToHistory", false))
    for (let i = 0; i < 3; i++) {
      if (i == 2) compress(state)
      for (let j = 0; j < 4; j++) state = command(state, undo)
      ist(state.doc, doc(p("yyyxxx")), eq)
      for (let j = 0; j < 4; j++) state = command(state, redo)
      ist(state.doc, doc(p("yyytop"), p("zero one twoxxx three")), eq)
    }
  })

  it("restores selection on undo", () => {
    let state = mkState()
    state = type(state, "hi")
    state = state.applyUnsafe(closeHistory(state.tr))
    state = state.applyUnsafe(state.tr.setSelectionUnsafe(TextSelection.createUnsafe(state.doc, 1, 3)))
    const selection = state.selection
    state = state.applyUnsafe(state.tr.replaceWithUnsafe(selection.from, selection.to, schema.textUnsafe("hello")))
    const selection2 = state.selection
    state = command(state, undo)
    ist(state.selection.eq(selection))
    state = command(state, redo)
    ist(state.selection.eq(selection2))
  })

  it("rebases selection on undo", () => {
    let state = mkState()
    state = type(state, "hi")
    state = state.applyUnsafe(closeHistory(state.tr))
    state = state.applyUnsafe(state.tr.setSelectionUnsafe(TextSelection.createUnsafe(state.doc, 1, 3)))
    state = state.applyUnsafe(state.tr.insertUnsafe(1, schema.textUnsafe("hello")))
    state = state.applyUnsafe(state.tr.insertUnsafe(1, schema.textUnsafe("---")).setMeta("addToHistory", false))
    state = command(state, undo)
    ist(state.selection.head, 6)
  })

  it("handles change overwriting in item-preserving mode", () => {
    let state = mkState(undefined, { preserveItems: true })
    state = type(state, "a")
    state = type(state, "b")
    state = state.applyUnsafe(closeHistory(state.tr))
    state = state.applyUnsafe(state.tr.setSelectionUnsafe(TextSelection.createUnsafe(state.doc, 1, 3)))
    state = type(state, "c")
    state = command(state, undo)
    state = command(state, undo)
    ist(state.doc, doc(p()), eq)
  })

  it("supports querying for the undo and redo depth", () => {
    let state = mkState()
    state = type(state, "a")
    ist(undoDepth(state), 1)
    ist(redoDepth(state), 0)
    state = state.applyUnsafe(state.tr.insertTextUnsafe("b", 1).setMeta("addToHistory", false))
    ist(undoDepth(state), 1)
    ist(redoDepth(state), 0)
    state = command(state, undo)
    ist(undoDepth(state), 0)
    ist(redoDepth(state), 1)
    state = command(state, redo)
    ist(undoDepth(state), 1)
    ist(redoDepth(state), 0)
  })

  it("all functions gracefully handle EditorStates without history", () => {
    const state = EditorState.createUnsafe({ schema })
    ist(undoDepth(state), 0)
    ist(redoDepth(state), 0)
    ist(Effect.runSync(undo(state)), false)
    ist(Effect.runSync(redo(state)), false)
  })

  it("truncates history", () => {
    let state = mkState(undefined, { depth: 2 })
    for (let i = 1; i < 40; ++i) {
      state = type(state, "a")
      state = state.applyUnsafe(closeHistory(state.tr))
      ist(undoDepth(state), ((i - 2) % 21) + 2)
    }
  })

  it("supports transactions with multiple steps", () => {
    let state = mkState()
    state = state.applyUnsafe(state.tr.insertTextUnsafe("a").insertTextUnsafe("b"))
    state = state.applyUnsafe(state.tr.insertTextUnsafe("c", 1))
    ist(state.doc, doc(p("cab")), eq)
    state = command(state, undo)
    ist(state.doc, doc(p("ab")), eq)
    state = command(state, undo)
    ist(state.doc, doc(p()), eq)
    state = command(state, redo)
    ist(state.doc, doc(p("ab")), eq)
    state = command(state, redo)
    ist(state.doc, doc(p("cab")), eq)
    state = command(state, undo)
    ist(state.doc, doc(p("ab")), eq)
  })

  it("combines appended transactions in the event started by the base transaction", () => {
    let state = mkState(doc(p("x")), {
      plugins: [
        new Plugin({
          appendTransaction: (_trs, _old, state) => {
            if (state.doc.content.size == 4) return state.tr.insertUnsafe(1, schema.textUnsafe("A"))
            return undefined
          }
        })
      ]
    })
    state = state.applyUnsafe(state.tr.insertUnsafe(2, schema.textUnsafe("I")))
    ist(state.doc, doc(p("AxI")), eq)
    ist(undoDepth(state), 1)
    state = command(state, undo)
    ist(state.doc, doc(p("x")), eq)
  })

  const addPlugin = () =>
    new Plugin({
      appendTransaction: (trs, _old, state) => {
        const add = Option.getOrUndefined(trs[0].getMeta<string>("add"))
        if (add) return state.tr.insertUnsafe(1, schema.textUnsafe(add))
        return undefined
      }
    })

  it("includes transactions appended to undo in the redo history", () => {
    let state = mkState(doc(p("x")), { plugins: [addPlugin()] })
    state = state.applyUnsafe(state.tr.insertUnsafe(2, schema.textUnsafe("I")).setMeta("add", "A"))
    ist(state.doc, doc(p("AxI")), eq)
    Effect.runSync(undo(state, (tr) => Effect.sync(() => (state = state.applyUnsafe(tr.setMeta("add", "B"))))))
    ist(state.doc, doc(p("Bx")), eq)
    Effect.runSync(redo(state, (tr) => Effect.sync(() => (state = state.applyUnsafe(tr.setMeta("add", "C"))))))
    ist(state.doc, doc(p("CAxI")), eq)
    state = command(state, undo)
    ist(state.doc, doc(p("Bx")), eq)
  })

  it("doesn't close the history on appended transactions", () => {
    let state = mkState(doc(p("x")), { plugins: [addPlugin()] })
    state = state.applyUnsafe(state.tr.insertUnsafe(2, schema.textUnsafe("R")).setMeta("add", "A"))
    state = state.applyUnsafe(state.tr.insertUnsafe(3, schema.textUnsafe("M")))
    state = command(state, undo)
    ist(state.doc, doc(p("x")), eq)
  })

  it("supports rebasing", () => {
    // This test simulates a collab editing session where the local editor
    // receives a step (`right`) that's on top of the parent step (`base`) of
    // the last local step (`left`).

    // Shared base step
    let state = mkState()
    state = type(state, "base")
    state = state.applyUnsafe(closeHistory(state.tr))
    const baseDoc = state.doc

    // Local unconfirmed step
    //
    //        - left
    //       /
    // base -
    //       \
    //        - right
    const rightStep = new ReplaceStep(5, 5, new Slice(Fragment.from(schema.textUnsafe(" right")), 0, 0))
    state = state.applyUnsafe(state.tr.stepUnsafe(rightStep))
    ist(state.doc, doc(p("base right")), eq)
    ist(undoDepth(state), 2)
    const leftStep = new ReplaceStep(1, 1, new Slice(Fragment.from(schema.textUnsafe("left ")), 0, 0))

    // Receive remote step and rebase local unconfirmed step
    //
    // base --> left --> right'
    const tr = state.tr
    tr.stepUnsafe(rightStep.invert(baseDoc))
    tr.stepUnsafe(leftStep)
    tr.stepUnsafe(getSome(rightStep.map(tr.mapping.slice(1))))
    tr.mapping.setMirror(0, tr.steps.length - 1)
    tr.setMeta("addToHistory", false)
    tr.setMeta("rebased", 1)
    state = state.applyUnsafe(tr)
    ist(state.doc, doc(p("left base right")), eq)
    ist(undoDepth(state), 2)

    // Undo local unconfirmed step
    //
    // base --> left
    state = command(state, undo)
    ist(state.doc, doc(p("left base")), eq)

    // Redo local unconfirmed step
    //
    // base --> left --> right'
    state = command(state, redo)
    ist(state.doc, doc(p("left base right")), eq)
  })

  it("properly maps selection when rebasing", () => {
    let state = mkState(doc(p("123456789ABCD")))
    state = state.applyUnsafe(state.tr.setSelectionUnsafe(TextSelection.createUnsafe(state.doc, 6, 13)))
    state = state.applyUnsafe(state.tr.deleteUnsafe(6, 13))
    const rebase = state.tr
      .insertUnsafe(6, schema.textUnsafe("6789ABC"))
      .insertUnsafe(14, schema.textUnsafe("E"))
      .deleteUnsafe(6, 13)
      .setMeta("rebased", 1)
      .setMeta("addToHistory", false)
    rebase.mapping.setMirror(0, 2)
    state = state.applyUnsafe(rebase)
    state = command(state, undo)
    // The mapped selection must still fall inside the document.
    ist(state.selection.to <= state.doc.content.size)
  })
})
