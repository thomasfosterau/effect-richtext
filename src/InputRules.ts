/**
 * Input rules: regular expressions describing a piece of text that,
 * when typed, causes something to happen. Ported from
 * `prosemirror-inputrules`.
 *
 * ```ts skip-type-checking
 * const plugin = inputRules({
 *   rules: [...smartQuotes, emDash, wrappingInputRule(/^\s*>\s$/, schema.nodes.blockquote)]
 * })
 * ```
 *
 * Rule handlers may return a transaction (or `null`), like in
 * ProseMirror, but also an `Option<Transaction>` or an
 * `Effect<Option<Transaction>, E, R>`. The errors and requirements of
 * effectful rules end up in the plugin's type.
 *
 * @since 0.1.0
 */
// Ported from prosemirror-inputrules (MIT, Marijn Haverbeke and others)
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import type { AnySchema, Node, NodeAttrsInput, NodeNames, NodeType, ResolvedPos } from "./Model.ts"
import {
  type Dispatch,
  type EditorState,
  type EditorViewLike,
  Plugin,
  TextSelection,
  type Transaction
} from "./State.ts"
import { canJoin, findWrapping } from "./Transform.ts"
import type { EditorView, HandlerResult } from "./View.ts"

// Resumes after a `setTimeout(0)`; interrupting it clears the timer.
const nextMacrotask: Effect.Effect<void> = Effect.callback<void>((resume) => {
  const timer = setTimeout(() => resume(Effect.void))
  return Effect.sync(() => clearTimeout(timer))
})

// -----------------------------------------------------------------------------
// InputRule
// -----------------------------------------------------------------------------

/**
 * What an input rule handler may return: a transaction describing the
 * rule's effect, an `Option` of one (`None` when the input was not
 * handled), or an Effect producing such an `Option`.
 *
 * @since 0.1.0
 * @category models
 */
export type InputRuleResult<Sc extends AnySchema = AnySchema, E = never, R = never> =
  | Transaction<Sc>
  | Option.Option<Transaction<Sc>>
  | Effect.Effect<Option.Option<Transaction<Sc>>, E, R>

/**
 * An input rule handler. Called with the editor state, the match array
 * produced by `RegExp.exec`, and the start and end of the matched range.
 *
 * @since 0.1.0
 * @category models
 */
export type InputRuleHandler<Sc extends AnySchema = AnySchema, E = never, R = never> = (
  state: EditorState<Sc, any, any>,
  match: RegExpMatchArray,
  start: number,
  end: number
) => InputRuleResult<Sc, E, R>

/**
 * Options for `InputRule`.
 *
 * @since 0.1.0
 * @category models
 */
export interface InputRuleOptions {
  /**
   * When set to false, `undoInputRule` doesn't work on this rule.
   */
  readonly undoable?: boolean
  /**
   * By default, input rules will not apply inside nodes marked as
   * `code`. Set this to true to change that, or to `"only"` to _only_
   * match in such nodes.
   */
  readonly inCode?: boolean | "only"
  /**
   * When set to `false`, this rule will not fire inside marks marked as
   * `code`. The default is `true`.
   */
  readonly inCodeMark?: boolean
}

/**
 * @since 0.1.0
 * @category symbols
 */
export const InputRuleTypeId: unique symbol = Symbol.for("effect-richtext/inputrules/InputRule")

/**
 * @since 0.1.0
 * @category symbols
 */
export type InputRuleTypeId = typeof InputRuleTypeId

/**
 * Input rules are regular expressions describing a piece of text that,
 * when typed, causes something to happen. This might be changing two
 * dashes into an emdash, wrapping a paragraph starting with `"> "` into
 * a blockquote, or something entirely different.
 *
 * @since 0.1.0
 * @category models
 */
export class InputRule<Sc extends AnySchema = AnySchema, E = never, R = never> {
  declare readonly [InputRuleTypeId]: {
    readonly _E: (_: never) => E
    readonly _R: (_: never) => R
  }

  /** @internal */
  readonly handler: InputRuleHandler<Sc, E, R>
  /** @internal */
  readonly undoable: boolean
  /** Whether the rule applies in code nodes (`"only"`: only there). */
  readonly inCode: boolean | "only"
  /** Whether the rule applies inside code marks. */
  readonly inCodeMark: boolean

  /**
   * Create an input rule. The rule applies when the user typed something
   * and the text directly in front of the cursor matches `match`, which
   * should end with `$`.
   *
   * The `handler` can be a string, in which case the matched text, or
   * the first matched group in the regexp, is replaced by that string.
   *
   * Or it can be a function, which will be called with the match array
   * produced by `RegExp.exec`, as well as the start and end of the
   * matched range, and which can return a transaction that describes the
   * rule's effect, or `null` to indicate the input was not handled. It
   * may also return an `Option` of a transaction, or an Effect producing
   * one.
   */
  constructor(
    /** The regular expression the text before the cursor is matched against. */
    readonly match: RegExp,
    handler: string | InputRuleHandler<Sc, E, R>,
    options: InputRuleOptions = {}
  ) {
    this.handler = Predicate.isString(handler) ? stringHandler(handler) : handler
    this.undoable = options.undoable !== false
    this.inCode = options.inCode || false
    this.inCodeMark = options.inCodeMark !== false
  }
}

function stringHandler(string: string): InputRuleHandler<any> {
  return (state, match, start, end) => {
    let insert = string
    if (match[1]) {
      const offset = match[0].lastIndexOf(match[1])
      insert += match[0].slice(offset + match[1].length)
      start += offset
      const cutOff = start - end
      if (cutOff > 0) {
        insert = match[0].slice(offset - cutOff, offset) + insert
        start = end
      }
    }
    return state.tr.insertTextUnsafe(insert, start, end)
  }
}

/**
 * The union of the error types of the given input rules.
 *
 * @since 0.1.0
 * @category type-level
 */
export type InputRuleErrors<Rules extends ReadonlyArray<InputRule<any, any, any>>> = Rules[number] extends infer X
  ? X extends InputRule<any, infer E, any>
    ? E
    : never
  : never

/**
 * The union of the requirements of the given input rules.
 *
 * @since 0.1.0
 * @category type-level
 */
export type InputRuleRequirements<Rules extends ReadonlyArray<InputRule<any, any, any>>> = Rules[number] extends infer X
  ? X extends InputRule<any, any, infer R>
    ? R
    : never
  : never

// -----------------------------------------------------------------------------
// Plugin
// -----------------------------------------------------------------------------

const MAX_MATCH = 500

/**
 * The last applied (undoable) input rule, as remembered by the input
 * rules plugin so that `undoInputRule` can revert it.
 *
 * @since 0.1.0
 * @category models
 */
export interface AppliedInputRule<Sc extends AnySchema = AnySchema> {
  /** The transaction produced by the rule. */
  readonly transform: Transaction<Sc>
  /** The start of the text input that triggered the rule. */
  readonly from: number
  /** The end of the text input that triggered the rule. */
  readonly to: number
  /** The typed text that triggered the rule. */
  readonly text: string
}

/**
 * The state of an input rules plugin: the last applied rule, while it
 * is still undoable (until the selection or document changes).
 *
 * @since 0.1.0
 * @category models
 */
export type InputRulesState = Option.Option<AppliedInputRule<any>>

/**
 * Options for `inputRules`.
 *
 * @since 0.1.0
 * @category models
 */
export interface InputRulesConfig<Rules extends ReadonlyArray<InputRule<any, any, any>>> {
  readonly rules: Rules
}

/**
 * Create an input rules plugin. When enabled, it will cause text input
 * that matches any of the given rules to trigger the rule's action.
 *
 * Rules are tried in order. Rules whose handler returns an Effect run
 * with the view's context: when such an effect completes synchronously,
 * it behaves exactly like a plain rule. When it is asynchronous, the
 * input is considered handled; when it eventually finds no transaction
 * (or fails), the typed text is inserted, and when it produces a
 * transaction, it is dispatched—both only if the editor state didn't
 * change in the meantime.
 *
 * @since 0.1.0
 * @category constructors
 */
export const inputRules = <const Rules extends ReadonlyArray<InputRule<any, any, any>>>({
  rules
}: InputRulesConfig<Rules>): Plugin<
  InputRulesState,
  AnySchema,
  InputRuleErrors<Rules>,
  InputRuleRequirements<Rules>
> => {
  const plugin: Plugin<InputRulesState, AnySchema, any, any> = new Plugin<InputRulesState, AnySchema, any, any>({
    state: {
      init: () => Option.none(),
      apply(tr, prev) {
        const stored = tr.getMeta<AppliedInputRule>(plugin)
        if (Option.isSome(stored)) return stored
        return tr.selectionSet || tr.docChanged ? Option.none() : prev
      }
    },

    props: {
      handleTextInput(view, from, to, text, deflt) {
        return run(view, from, to, text, rules, plugin, Option.fromNullishOr(deflt))
      },
      handleDOMEvents: {
        compositionend: (view) => {
          // On the next macrotask, as the composition's DOM change is read
          // first; the view interrupts this if it is destroyed meanwhile.
          view.runEffect(
            Effect.andThen(
              nextMacrotask,
              Effect.sync(() => {
                const sel = view.state.selection
                const $cursor = sel instanceof TextSelection ? sel.$cursor : Option.none()
                if (Option.isSome($cursor)) {
                  const pos = $cursor.value.pos
                  view.runHandler(run(view, pos, pos, "", rules, plugin, Option.none()))
                }
              })
            )
          )
          return false
        }
      }
    },

    isInputRules: true
  })
  return plugin
}

interface RunContext {
  readonly view: EditorView<any, any, any>
  readonly state: EditorState<any, any, any>
  readonly $from: ResolvedPos<any>
  readonly from: number
  readonly to: number
  readonly text: string
  readonly textBefore: string
  readonly rules: ReadonlyArray<InputRule<any, any, any>>
  readonly plugin: Plugin<any, any, any, any>
  readonly deflt: Option.Option<() => Transaction<any>>
  // Set to false once the handler call that started this run returned
  // (more precisely, at the next microtask), so that effects can tell
  // whether they completed synchronously.
  sync: boolean
}

const hasCodeMark = (marks: ReadonlyArray<{ readonly type: { readonly spec: { readonly code?: unknown } } }>) =>
  marks.some((m) => m.type.spec.code)

function run(
  view: EditorView<any, any, any>,
  from: number,
  to: number,
  text: string,
  rules: ReadonlyArray<InputRule<any, any, any>>,
  plugin: Plugin<any, any, any, any>,
  deflt: Option.Option<() => Transaction<any>>
): HandlerResult<any, any> {
  if (view.composing) return false
  const state = view.state,
    $from = state.doc.resolveUnsafe(from)
  const textBefore =
    $from.parent.textBetween(Math.max(0, $from.parentOffset - MAX_MATCH), $from.parentOffset, undefined, "￼") + text
  return tryRules({ view, state, $from, from, to, text, textBefore, rules, plugin, deflt, sync: true }, 0)
}

// Whether a rule may run where the cursor is, given the code marks and
// code blocks it opts into.
function ruleAppliesAt(rule: InputRule<any, any, any>, $from: ResolvedPos<any>): boolean {
  if (!rule.inCodeMark && hasCodeMark($from.marks())) return false
  return $from.parent.type.spec.code ? Boolean(rule.inCode) : rule.inCode !== "only"
}

// Whether inline content between two positions has a code mark.
function hasCodeMarkBetween(doc: Node<any>, from: number, to: number): boolean {
  let hasMark = false
  doc.nodesBetween(from, to, (node) => {
    if (node.isInline && hasCodeMark(node.marks)) hasMark = true
  })
  return hasMark
}

// Try the rules from index `start` on, in order, until one handles the input.
function tryRules(cx: RunContext, start: number): HandlerResult<any, any> {
  const { $from, rules, state, text, textBefore } = cx
  if (start >= rules.length) return false
  const rule = rules[start]
  const next = () => tryRules(cx, start + 1)
  if (!ruleAppliesAt(rule, $from)) return next()
  const match = rule.match.exec(textBefore)
  if (!match || match[0].length < text.length) return next()
  const startPos = cx.from - (match[0].length - text.length)
  if (!rule.inCodeMark && hasCodeMarkBetween(state.doc, startPos, $from.pos)) return next()
  const result = rule.handler(state, match, startPos, cx.to)
  if (Effect.isEffect(result)) return runEffectRule(cx, rule, result, start + 1)
  if (!Option.isOption(result)) return applyRule(cx, rule, result)
  return Option.isSome(result) ? applyRule(cx, rule, result.value) : next()
}

function applyRule(cx: RunContext, rule: InputRule<any, any, any>, tr: Transaction<any>): Effect.Effect<boolean> {
  if (rule.undoable) {
    tr.setMeta(cx.plugin, { transform: tr, from: cx.from, to: cx.to, text: cx.text } satisfies AppliedInputRule)
  }
  return Effect.as(cx.view.dispatch(tr), true)
}

// Without a matching rule, an asynchronous run has to insert the typed
// text itself, since the view already considered the input handled.
function fallback(cx: RunContext): Effect.Effect<boolean> {
  if (cx.sync || Option.isNone(cx.deflt) || cx.view.isDestroyed || cx.view.state !== cx.state)
    return Effect.succeed(false)
  return Effect.as(cx.view.dispatch(cx.deflt.value()), true)
}

function runEffectRule(
  cx: RunContext,
  rule: InputRule<any, any, any>,
  effect: Effect.Effect<Option.Option<Transaction<any>>, unknown, unknown>,
  next: number
): Effect.Effect<boolean, unknown, unknown> {
  if (cx.sync) queueMicrotask(() => (cx.sync = false))
  return effect.pipe(
    Effect.flatMap((result): Effect.Effect<boolean, unknown, unknown> => {
      if (Option.isSome(result)) {
        // A stale transaction can't be applied anymore.
        if (cx.view.isDestroyed || cx.view.state !== cx.state) return Effect.succeed(true)
        return applyRule(cx, rule, result.value)
      }
      const rest = tryRules(cx, next)
      if (Effect.isEffect(rest)) return rest
      return fallback(cx)
    }),
    Effect.tapCause(() => fallback(cx))
  )
}

// -----------------------------------------------------------------------------
// undoInputRule
// -----------------------------------------------------------------------------

/**
 * A command that works with any schema and needs no services.
 *
 * @since 0.1.0
 * @category models
 */
export type InputRuleCommand = <Sc extends AnySchema>(
  state: EditorState<Sc, any, any>,
  dispatch?: Dispatch<Sc>,
  view?: EditorViewLike
) => Effect.Effect<boolean>

/**
 * This is a command that will undo an input rule, if applying such a
 * rule was the last thing that the user did.
 *
 * @since 0.1.0
 * @category commands
 */
export const undoInputRule: InputRuleCommand = (state, dispatch) =>
  Effect.suspend(() => {
    const found = Arr.findFirst(state.plugins, (plugin) =>
      plugin.spec.isInputRules
        ? // SAFETY: an input-rules plugin's state is its undoable rule, if any.
          Option.flatten(plugin.getState(state) as Option.Option<InputRulesState>)
        : Option.none()
    )
    if (Option.isNone(found)) return Effect.succeed(false)
    if (!dispatch) return Effect.succeed(true)
    const undoable = found.value
    const tr = state.tr,
      toUndo = undoable.transform
    Arr.reverse(toUndo.steps.map((step, i) => step.invert(toUndo.docs[i]))).forEach((step) => tr.stepUnsafe(step))
    if (undoable.text) {
      const marks = tr.doc.resolveUnsafe(undoable.from).marks()
      tr.replaceWithUnsafe(undoable.from, undoable.to, state.schema.textUnsafe(undoable.text, marks))
    } else {
      tr.deleteUnsafe(undoable.from, undoable.to)
    }
    return Effect.as(dispatch(tr), true)
  })

// -----------------------------------------------------------------------------
// Rule builders
// -----------------------------------------------------------------------------

/**
 * Attributes for a rule-built node: fixed, or computed from the match.
 *
 * @since 0.1.0
 * @category models
 */
export type InputRuleAttrs<Sc extends AnySchema, N extends NodeNames<Sc>> =
  | NodeAttrsInput<Sc, N>
  | ((match: RegExpMatchArray) => NodeAttrsInput<Sc, N>)

const resolveAttrs = <A>(getAttrs: A | ((match: RegExpMatchArray) => A), match: RegExpMatchArray): A =>
  Predicate.isFunction(getAttrs) ? getAttrs(match) : getAttrs

/**
 * Build an input rule for automatically wrapping a textblock when a
 * given string is typed. The `regexp` argument is directly passed
 * through to the `InputRule` constructor. You'll probably want the
 * regexp to start with `^`, so that the pattern can only occur at the
 * start of a textblock.
 *
 * `nodeType` is the type of node to wrap in. If it needs attributes,
 * you can either pass them directly, or pass a function that will
 * compute them from the regular expression match.
 *
 * By default, if there's a node with the same type above the newly
 * wrapped node, the rule will try to join those two nodes. You can pass
 * a join predicate, which takes a regular expression match and the node
 * before the wrapped node, and can return a boolean to indicate whether
 * a join should happen.
 *
 * @since 0.1.0
 * @category constructors
 */
export const wrappingInputRule = <Sc extends AnySchema, N extends NodeNames<Sc>>(
  regexp: RegExp,
  nodeType: NodeType<Sc, N>,
  getAttrs?: InputRuleAttrs<Sc, N>,
  joinPredicate?: (match: RegExpMatchArray, node: Node<Sc>) => boolean
): InputRule<Sc> =>
  new InputRule<Sc>(regexp, (state, match, start, end) => {
    const attrs = getAttrs === undefined ? undefined : resolveAttrs(getAttrs, match)
    const tr = state.tr.deleteUnsafe(start, end)
    const range = tr.doc.resolveUnsafe(start).blockRange()
    const wrapping = Option.flatMap(range, (r) => findWrapping(r, nodeType, attrs))
    if (Option.isNone(range) || Option.isNone(wrapping)) return Option.none()
    tr.wrapUnsafe(range.value, wrapping.value)
    const before = tr.doc.resolveUnsafe(start - 1).nodeBefore
    if (
      Option.isSome(before) &&
      before.value.type === nodeType &&
      canJoin(tr.doc, start - 1) &&
      (!joinPredicate || joinPredicate(match, before.value))
    ) {
      tr.joinUnsafe(start - 1)
    }
    return tr
  })

/**
 * Build an input rule that changes the type of a textblock when the
 * matched text is typed into it. You'll usually want to start your
 * regexp with `^` so that it is only matched at the start of a
 * textblock. The optional `getAttrs` parameter can be used to compute
 * the new node's attributes, and works the same as in the
 * `wrappingInputRule` function.
 *
 * @since 0.1.0
 * @category constructors
 */
export const textblockTypeInputRule = <Sc extends AnySchema, N extends NodeNames<Sc>>(
  regexp: RegExp,
  nodeType: NodeType<Sc, N>,
  getAttrs?: InputRuleAttrs<Sc, N>
): InputRule<Sc> =>
  new InputRule<Sc>(regexp, (state, match, start, end) => {
    const $start = state.doc.resolveUnsafe(start)
    const attrs = getAttrs === undefined ? undefined : resolveAttrs(getAttrs, match)
    if (!$start.node(-1).canReplaceWith($start.index(-1), $start.indexAfter(-1), nodeType)) return Option.none()
    return state.tr.deleteUnsafe(start, end).setBlockTypeUnsafe(start, start, nodeType, attrs)
  })

// -----------------------------------------------------------------------------
// Rules
// -----------------------------------------------------------------------------

/**
 * Converts double dashes to an emdash.
 *
 * @since 0.1.0
 * @category rules
 */
export const emDash: InputRule = new InputRule(/--$/, "—", { inCodeMark: false })

/**
 * Converts three dots to an ellipsis character.
 *
 * @since 0.1.0
 * @category rules
 */
export const ellipsis: InputRule = new InputRule(/\.\.\.$/, "…", { inCodeMark: false })

/**
 * “Smart” opening double quotes.
 *
 * @since 0.1.0
 * @category rules
 */
export const openDoubleQuote: InputRule = new InputRule(/(?:^|[\s{[(<'"‘“])(")$/, "“", {
  inCodeMark: false
})

/**
 * “Smart” closing double quotes.
 *
 * @since 0.1.0
 * @category rules
 */
export const closeDoubleQuote: InputRule = new InputRule(/"$/, "”", { inCodeMark: false })

/**
 * “Smart” opening single quotes.
 *
 * @since 0.1.0
 * @category rules
 */
export const openSingleQuote: InputRule = new InputRule(/(?:^|[\s{[(<'"‘“])(')$/, "‘", {
  inCodeMark: false
})

/**
 * “Smart” closing single quotes.
 *
 * @since 0.1.0
 * @category rules
 */
export const closeSingleQuote: InputRule = new InputRule(/'$/, "’", { inCodeMark: false })

/**
 * Smart-quote related input rules.
 *
 * @since 0.1.0
 * @category rules
 */
export const smartQuotes: ReadonlyArray<InputRule> = [
  openDoubleQuote,
  closeDoubleQuote,
  openSingleQuote,
  closeSingleQuote
]
