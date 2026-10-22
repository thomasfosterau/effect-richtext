// Tests for effect-richtext/inputrules (prosemirror-inputrules has no
// test suite of its own).
import { assert, describe, it } from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import {
  type AppliedInputRule,
  ellipsis,
  emDash,
  InputRule,
  inputRules,
  type InputRulesState,
  smartQuotes,
  textblockTypeInputRule,
  undoInputRule,
  wrappingInputRule
} from "effect-richtext/inputrules"
import type { AnySchema } from "effect-richtext/model"
import { EditorState, type Plugin, TextSelection } from "effect-richtext/state"
import { blockquote, code, doc, eq, h1, h2, li, ol, p, pre, schema, strong, ul } from "effect-richtext/test-builder"
import { EditorView } from "effect-richtext/view"
import ist from "../utils/ist.ts"
import { getSome } from "../utils/option.ts"
import { findTextNode, flush, selFor, tempEditor, workspace } from "./helpers.ts"

class Counter extends Context.Service<Counter, { readonly step: number }>()("test/Counter") {}

class Boom extends Data.TaggedError("Boom")<{ readonly message: string }> {}

// Simulate typing: run the `handleTextInput` handlers like the view does
// for each typed character, inserting the text when none handles it.
function type(view: EditorView<any, any, any>, text: string) {
  for (const ch of text) {
    const { from, to } = view.state.selection
    const deflt = () => view.state.tr.insertTextUnsafe(ch, from, to)
    if (!view.someHandler("handleTextInput", (f) => f(view, from, to, ch, deflt))) view.dispatchUnsafe(deflt())
  }
}

const nodes = schema.nodes

const blockquoteRule = wrappingInputRule(/^\s*>\s$/, nodes.blockquote)
const orderedListRule = wrappingInputRule(
  /^(\d+)\.\s$/,
  nodes.ordered_list,
  (match) => ({ order: +match[1]! }),
  (match, node) => node.childCount + (node.attrs as { order: number }).order === +match[1]!
)
const bulletListRule = wrappingInputRule(/^\s*([-+*])\s$/, nodes.bullet_list)
const headingRule = textblockTypeInputRule(/^(#{1,6})\s$/, nodes.heading, (match) => ({ level: match[1]!.length }))
const codeBlockRule = textblockTypeInputRule(/^```$/, nodes.code_block)

const allRules = [
  ...smartQuotes,
  emDash,
  ellipsis,
  blockquoteRule,
  orderedListRule,
  bulletListRule,
  headingRule,
  codeBlockRule
]

const editor = (d: ReturnType<typeof doc>, rules: ReadonlyArray<InputRule<any, any, never>> = allRules) =>
  tempEditor({ doc: d, plugins: [inputRules({ rules })] })

const undo = (view: EditorView<any, any, any>) => Effect.runSync(undoInputRule(view.state, view.dispatch))

describe("inputRules", () => {
  it("converts double dashes to an em dash", () => {
    const view = editor(doc(p("foo<a>")))
    type(view, "--")
    ist(view.state.doc, doc(p("foo—")), eq)
  })

  it("converts three dots to an ellipsis", () => {
    const view = editor(doc(p("<a>")))
    type(view, "wait...")
    ist(view.state.doc, doc(p("wait…")), eq)
  })

  it("applies smart quotes", () => {
    const view = editor(doc(p("<a>")))
    type(view, `"hi" and 'yo' it's`)
    ist(view.state.doc, doc(p("“hi” and ‘yo’ it’s")), eq)
  })

  it("keeps the matched prefix of string rules", () => {
    const view = editor(doc(p("a<a>")))
    type(view, ` "`)
    ist(view.state.doc, doc(p("a “")), eq)
  })

  it("doesn't fire in code blocks by default", () => {
    const view = editor(doc(pre("<a>")))
    type(view, `a--"b"`)
    ist(view.state.doc, doc(pre(`a--"b"`)), eq)
  })

  it("supports rules that only apply in code", () => {
    const arrow = new InputRule(/->$/, "→", { inCode: "only" })
    const view = editor(doc(pre("<a>"), p("x")), [arrow])
    type(view, "a->")
    ist(view.state.doc, doc(pre("a→"), p("x")), eq)
    view.dispatchUnsafe(view.state.tr.setSelectionUnsafe(TextSelection.atEnd(view.state.doc)))
    type(view, "->")
    ist(view.state.doc, doc(pre("a→"), p("x->")), eq)
  })

  it("supports rules that also apply in code", () => {
    const arrow = new InputRule(/->$/, "→", { inCode: true })
    const view = editor(doc(pre("<a>")), [arrow])
    type(view, "a->")
    ist(view.state.doc, doc(pre("a→")), eq)
  })

  it("doesn't fire inside code marks when inCodeMark is false", () => {
    const view = editor(doc(p(code("x<a>"))))
    type(view, "--")
    ist(view.state.doc, doc(p(code("x--"))), eq)
  })

  it("fires inside code marks by default", () => {
    const arrow = new InputRule(/->$/, "→")
    const view = editor(doc(p(code("x<a>"))), [arrow])
    type(view, "->")
    ist(view.state.doc, doc(p(code("x→"))), eq)
  })

  it("preserves marks of the replaced text", () => {
    const view = editor(doc(p(strong("a-<a>"))))
    type(view, "-")
    ist(view.state.doc, doc(p(strong("a—"))), eq)
  })

  it("wraps a paragraph in a blockquote", () => {
    const view = editor(doc(p("<a>")))
    type(view, "> hi")
    ist(view.state.doc, doc(blockquote(p("hi"))), eq)
  })

  it("creates lists", () => {
    const view = editor(doc(p("<a>")))
    type(view, "* a")
    ist(view.state.doc, doc(ul(li(p("a")))), eq)
  })

  it("passes match-derived attributes to wrapping rules", () => {
    const view = editor(doc(p("<a>")))
    type(view, "3. a")
    ist(view.state.doc, doc(ol({ order: 3 }, li(p("a")))), eq)
  })

  it("joins with an adjacent list when the predicate allows it", () => {
    const view = editor(doc(ol(li(p("a"))), p("<a>")))
    type(view, "2. b")
    ist(view.state.doc, doc(ol(li(p("a")), li(p("b")))), eq)
  })

  it("doesn't join when the predicate refuses", () => {
    const view = editor(doc(ol(li(p("a"))), p("<a>")))
    type(view, "5. b")
    ist(view.state.doc, doc(ol(li(p("a"))), ol({ order: 5 }, li(p("b")))), eq)
  })

  it("changes the type of a textblock", () => {
    const view = editor(doc(p("<a>")))
    type(view, "## Title")
    ist(view.state.doc, doc(h2("Title")), eq)
  })

  it("creates code blocks", () => {
    const view = editor(doc(p("<a>")))
    type(view, "```")
    ist(view.state.doc, doc(pre()), eq)
  })

  it("only matches at the start of a textblock when anchored", () => {
    const view = editor(doc(p("x<a>")))
    type(view, "# ")
    ist(view.state.doc, doc(p("x# ")), eq)
  })

  it("doesn't change textblocks where the new type isn't allowed", () => {
    // List items must start with a paragraph.
    const view = editor(doc(ul(li(p("<a>")))), [headingRule])
    type(view, "# ")
    ist(view.state.doc, doc(ul(li(p("# ")))), eq)
  })

  it("can undo an input rule", () => {
    const view = editor(doc(p("foo<a>")))
    type(view, "--")
    ist(view.state.doc, doc(p("foo—")), eq)
    ist(undo(view))
    ist(view.state.doc, doc(p("foo--")), eq)
    // Nothing left to undo.
    ist(!undo(view))
  })

  it("can undo a block-level input rule", () => {
    const view = editor(doc(p("<a>")))
    type(view, "# ")
    ist(view.state.doc, doc(h1()), eq)
    ist(undo(view))
    ist(view.state.doc, doc(p("# ")), eq)
  })

  it("stops being undoable after further changes", () => {
    const view = editor(doc(p("foo<a>")))
    type(view, "--x")
    ist(!undo(view))
    ist(view.state.doc, doc(p("foo—x")), eq)
  })

  it("respects undoable: false", () => {
    const rule = new InputRule(/--$/, "—", { undoable: false })
    const view = editor(doc(p("foo<a>")), [rule])
    type(view, "--")
    ist(!undo(view))
  })

  it("tracks the applied rule in its plugin state", () => {
    const plugin = inputRules({ rules: [emDash] })
    const view = tempEditor({ doc: doc(p("a<a>")), plugins: [plugin] })
    ist(Option.isNone(Option.flatten(plugin.getState(view.state))))
    type(view, "--")
    const applied = getSome(Option.flatten(plugin.getState(view.state))) as AppliedInputRule
    ist(applied.text, "-")
    ist(applied.from, 3)
  })

  it("supports Option-returning handlers", () => {
    const rule = new InputRule(/:(\w+):$/, (state, match, start, end) =>
      match[1] === "smile" ? Option.some(state.tr.insertTextUnsafe("☺", start, end)) : Option.none()
    )
    const view = editor(doc(p("<a>")), [rule])
    type(view, ":smile: :nope:")
    ist(view.state.doc, doc(p("☺ :nope:")), eq)
  })

  it("tries later rules when a handler returns null", () => {
    const never = new InputRule(/--$/, () => null)
    const view = editor(doc(p("<a>")), [never, emDash])
    type(view, "--")
    ist(view.state.doc, doc(p("—")), eq)
  })

  it("works with real DOM text input", () => {
    const view = editor(doc(p("foo-<a>")))
    const text = findTextNode(view.dom, "foo-")!
    text.nodeValue = "foo--"
    const sel = window.getSelection()!
    sel.collapse(text, 5)
    flush(view)
    ist(view.state.doc, doc(p("foo—")), eq)
  })

  it("doesn't fire during composition", () => {
    const view = editor(doc(p("foo<a>")))
    ;(view as any).input.composing = true
    try {
      ist(!view.someHandler("handleTextInput", (f) => f(view, 4, 4, "-", () => view.state.tr)))
    } finally {
      ;(view as any).input.composing = false
    }
  })
})

describe("inputRules (Effect handlers)", () => {
  const counterRule = new InputRule(/\+\+$/, (state, _match, start, end) =>
    Effect.gen(function* () {
      const counter = yield* Counter
      return Option.some(state.tr.insertTextUnsafe(String(counter.step), start, end))
    })
  )

  it("tracks rule errors and requirements in the plugin type", () => {
    const failing = new InputRule(/!!$/, () => Effect.fail(new Boom({ message: "boom" })))
    const plugin: Plugin<InputRulesState, AnySchema, Boom, Counter> = inputRules({
      rules: [emDash, counterRule, failing]
    })
    ist(plugin.spec.isInputRules)
    // @ts-expect-error the plugin requires Counter
    const _noReqs: Plugin<InputRulesState, AnySchema, Boom, never> = plugin
  })

  it.effect("runs effectful rules with the view's context", () =>
    Effect.gen(function* () {
      const d = doc(p("a<a>"))
      const state = yield* EditorState.create({
        doc: d,
        selection: selFor(d),
        plugins: [inputRules({ rules: [counterRule] })]
      })
      const view = yield* EditorView.make(workspace(), { state })
      type(view, "++")
      ist(view.state.doc, doc(p("a7")), eq)
      // The rule is undoable like a plain one.
      ist(yield* undoInputRule(view.state, view.dispatch))
      ist(view.state.doc, doc(p("a++")), eq)
    }).pipe(Effect.scoped, Effect.provide(Layer.succeed(Counter, { step: 7 })))
  )

  it.effect("continues with later rules when an effect produces None", () =>
    Effect.gen(function* () {
      const none = new InputRule(/--$/, () => Effect.succeed(Option.none()))
      const d = doc(p("<a>"))
      const state = EditorState.createUnsafe({
        doc: d,
        selection: selFor(d),
        plugins: [inputRules({ rules: [none, emDash] })]
      })
      const view = yield* EditorView.make(workspace(), { state })
      type(view, "-x--")
      ist(view.state.doc, doc(p("-x—")), eq)
    }).pipe(Effect.scoped)
  )

  it.effect("reports failing rules and inserts the text", () =>
    Effect.gen(function* () {
      const failing = new InputRule(/!$/, () => Effect.fail(new Boom({ message: "boom" })))
      const d = doc(p("a<a>"))
      const state = EditorState.createUnsafe({
        doc: d,
        selection: selFor(d),
        plugins: [inputRules({ rules: [failing] })]
      })
      const errors: Array<unknown> = []
      const view = yield* EditorView.make(workspace(), { state, onError: (cause) => errors.push(Cause.squash(cause)) })
      type(view, "!")
      ist(view.state.doc, doc(p("a!")), eq)
      ist(errors.length, 1)
      ist(errors[0] instanceof Boom)
    }).pipe(Effect.scoped)
  )

  it.live("applies asynchronous rules when they complete", () =>
    Effect.gen(function* () {
      const done = yield* Deferred.make<void>()
      const slow = new InputRule(/--$/, (state, _match, start, end) =>
        Effect.sleep("5 millis").pipe(
          Effect.as(Option.some(state.tr.insertTextUnsafe("—", start, end))),
          Effect.ensuring(Deferred.succeed(done, undefined))
        )
      )
      const d = doc(p("a<a>"))
      const state = EditorState.createUnsafe({ doc: d, selection: selFor(d), plugins: [inputRules({ rules: [slow] })] })
      const view = yield* EditorView.make(workspace(), { state })
      type(view, "-")
      ist(view.state.doc, doc(p("a-")), eq)
      type(view, "-")
      // Handled, but not applied yet.
      ist(view.state.doc, doc(p("a-")), eq)
      yield* Deferred.await(done)
      yield* Effect.yieldNow
      ist(view.state.doc, doc(p("a—")), eq)
    }).pipe(Effect.scoped)
  )

  it.live("inserts the typed text when an asynchronous rule finds nothing", () =>
    Effect.gen(function* () {
      const done = yield* Deferred.make<void>()
      const slow = new InputRule(/x$/, () =>
        Effect.sleep("5 millis").pipe(Effect.as(Option.none()), Effect.ensuring(Deferred.succeed(done, undefined)))
      )
      const d = doc(p("a<a>"))
      const state = EditorState.createUnsafe({ doc: d, selection: selFor(d), plugins: [inputRules({ rules: [slow] })] })
      const view = yield* EditorView.make(workspace(), { state })
      type(view, "x")
      ist(view.state.doc, doc(p("a")), eq)
      yield* Deferred.await(done)
      yield* Effect.yieldNow
      ist(view.state.doc, doc(p("ax")), eq)
    }).pipe(Effect.scoped)
  )

  it.live("drops asynchronous results when the state changed meanwhile", () =>
    Effect.gen(function* () {
      const done = yield* Deferred.make<void>()
      const slow = new InputRule(/--$/, (state, _match, start, end) =>
        Effect.sleep("5 millis").pipe(
          Effect.as(Option.some(state.tr.insertTextUnsafe("—", start, end))),
          Effect.ensuring(Deferred.succeed(done, undefined))
        )
      )
      const d = doc(p("a-<a>"))
      const state = EditorState.createUnsafe({ doc: d, selection: selFor(d), plugins: [inputRules({ rules: [slow] })] })
      const view = yield* EditorView.make(workspace(), { state })
      type(view, "-")
      yield* view.dispatch(view.state.tr.insertTextUnsafe("!", 1, 1))
      yield* Deferred.await(done)
      yield* Effect.yieldNow
      ist(view.state.doc, doc(p("!a-")), eq)
    }).pipe(Effect.scoped)
  )
})

describe("undoInputRule", () => {
  it("returns false without an input rules plugin", () => {
    const d = doc(p("a"))
    const state = EditorState.createUnsafe({ doc: d })
    ist(!Effect.runSync(undoInputRule(state)))
  })

  it("can be queried without dispatching", () => {
    const view = editor(doc(p("foo<a>")))
    type(view, "--")
    ist(Effect.runSync(undoInputRule(view.state)))
    assert.strictEqual(view.state.doc.textContent, "foo—")
  })
})
