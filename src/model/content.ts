/**
 * Content expressions describe which children a node type allows.
 *
 * Unlike ProseMirror, which uses a string mini-language
 * (`"paragraph+"`, `"heading block*"`), content is described with
 * typed combinators. The node and group names a combinator refers to
 * are tracked at the type level, so the schema knows which node types
 * may appear inside each node:
 *
 * ```ts
 * import * as assert from "node:assert"
 * import { Content } from "@thomasfosterau/effect-richtext/Model"
 *
 * // A `ContentExpr<"heading" | "block">`
 * const expr = Content.seq("heading", Content.zeroOrMore("block"))
 * assert.strictEqual(Content.format(expr), "heading block*")
 * ```
 *
 * `Content.parse` accepts the ProseMirror string syntax for
 * compatibility, at the cost of losing the type-level information.
 *
 * ```ts
 * import * as assert from "node:assert"
 * import { Content } from "@thomasfosterau/effect-richtext/Model"
 *
 * assert.strictEqual(Content.format(Content.parse("paragraph+")), "paragraph+")
 * ```
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Order from "effect/Order"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import { SchemaDefinitionError } from "./errors.ts"
import { Fragment } from "./fragment.ts"
import type { NodeType } from "./schema.ts"
import type { Node } from "./node.ts"

const TypeId = "~effect-richtext/model/ContentExpr"

/**
 * The unresolved syntax tree of a content expression.
 *
 * @since 0.1.0
 * @category models
 */
export type ExprAST =
  | { readonly _tag: "Choice"; readonly exprs: ReadonlyArray<ExprAST> }
  | { readonly _tag: "Seq"; readonly exprs: ReadonlyArray<ExprAST> }
  | { readonly _tag: "Plus"; readonly expr: ExprAST }
  | { readonly _tag: "Star"; readonly expr: ExprAST }
  | { readonly _tag: "Opt"; readonly expr: ExprAST }
  | { readonly _tag: "Range"; readonly min: number; readonly max: number; readonly expr: ExprAST }
  | { readonly _tag: "Name"; readonly name: string }

/**
 * A content expression referring to the node or group names `Names`.
 *
 * @since 0.1.0
 * @category models
 */
export interface ContentExpr<out Names extends string = string> {
  readonly [TypeId]: { readonly _Refs: (_: never) => Names }
  readonly ast: ExprAST
}

/**
 * Anything that can be used where a content expression is expected: an
 * expression or a bare node/group name.
 *
 * @since 0.1.0
 * @category models
 */
export type ContentInput<Names extends string = string> = ContentExpr<Names> | Names

/**
 * Extract the referenced names from a content input.
 *
 * @since 0.1.0
 * @category type-level
 */
export type Refs<C> = C extends ContentExpr<infer R> ? R : C extends string ? C : never

type SyntaxChar = " " | "+" | "*" | "?" | "|" | "(" | ")" | "{" | "}" | ","

/**
 * The names referenced by a spec's `content` field. Plain strings are
 * ProseMirror content-expression syntax: a bare name is tracked
 * precisely, anything more complex (`"paragraph+"`) is untyped
 * (`string`).
 *
 * @since 0.1.0
 * @category type-level
 */
export type SpecRefs<C> =
  C extends ContentExpr<infer R>
    ? R
    : C extends `${string}${SyntaxChar}${string}`
      ? string
      : C extends string
        ? C
        : never

const variance = { _Refs: (_: never) => _ }

const make = <R extends string>(ast: ExprAST): ContentExpr<R> => ({ [TypeId]: variance, ast })

const toAST = (input: ContentInput): ExprAST => (Predicate.isString(input) ? { _tag: "Name", name: input } : input.ast)

/**
 * @since 0.1.0
 * @category guards
 */
export const isContentExpr = (u: unknown): u is ContentExpr => Predicate.isObjectOrArray(u) && TypeId in u

/**
 * Reference a single node type or group by name.
 *
 * @since 0.1.0
 * @category constructors
 */
export const ref = <const Name extends string>(name: Name): ContentExpr<Name> => make({ _tag: "Name", name })

/**
 * A sequence of expressions that must appear in order.
 *
 * @since 0.1.0
 * @category combinators
 */
export const seq = <const Items extends ReadonlyArray<ContentInput>>(
  ...items: Items
): ContentExpr<Refs<Items[number]>> =>
  items.length === 1 ? make(toAST(items[0])) : make({ _tag: "Seq", exprs: items.map(toAST) })

/**
 * Any one of the given expressions.
 *
 * @since 0.1.0
 * @category combinators
 */
export const choice = <const Items extends ReadonlyArray<ContentInput>>(
  ...items: Items
): ContentExpr<Refs<Items[number]>> =>
  items.length === 1 ? make(toAST(items[0])) : make({ _tag: "Choice", exprs: items.map(toAST) })

/**
 * Zero or more repetitions (`expr*`).
 *
 * @since 0.1.0
 * @category combinators
 */
export const zeroOrMore = <const C extends ContentInput>(item: C): ContentExpr<Refs<C>> =>
  make({ _tag: "Star", expr: toAST(item) })

/**
 * One or more repetitions (`expr+`).
 *
 * @since 0.1.0
 * @category combinators
 */
export const oneOrMore = <const C extends ContentInput>(item: C): ContentExpr<Refs<C>> =>
  make({ _tag: "Plus", expr: toAST(item) })

/**
 * Zero or one occurrence (`expr?`).
 *
 * @since 0.1.0
 * @category combinators
 */
export const optional = <const C extends ContentInput>(item: C): ContentExpr<Refs<C>> =>
  make({ _tag: "Opt", expr: toAST(item) })

/**
 * Between `min` and `max` repetitions (`expr{min,max}`). When `max` is
 * omitted it defaults to `min`; pass `Infinity` for no upper bound.
 *
 * @since 0.1.0
 * @category combinators
 */
export const repeat = <const C extends ContentInput>(item: C, min: number, max: number = min): ContentExpr<Refs<C>> =>
  make({ _tag: "Range", min, max: max === Infinity ? -1 : max, expr: toAST(item) })

/**
 * Parse a ProseMirror-style content expression string, such as
 * `"paragraph block*"`. The referenced names are not tracked at the
 * type level.
 *
 * Syntax errors throw a `SchemaDefinitionError` immediately; unknown names
 * and other semantic errors are reported when the schema is compiled.
 *
 * @since 0.1.0
 * @category constructors
 */
export const parse = (source: string): ContentExpr => {
  const stream = new TokenStream(source)
  if (stream.next === undefined) return make({ _tag: "Seq", exprs: [] })
  const expr = parseExpr(stream)
  if (stream.next !== undefined) stream.err("Unexpected trailing text")
  return make(expr)
}

/**
 * Render a content expression in ProseMirror's string syntax.
 *
 * @since 0.1.0
 * @category utils
 */
export const format = (expr: ContentInput): string => formatAST(toAST(expr), 0)

const formatAST = (ast: ExprAST, prec: number): string =>
  Match.valueTags(ast, {
    Name: (a) => a.name,
    Choice: (a) => {
      const s = a.exprs.map((e) => formatAST(e, 1)).join(" | ")
      return prec > 0 ? `(${s})` : s
    },
    Seq: (a) => {
      const s = a.exprs.map((e) => formatAST(e, 2)).join(" ")
      return prec > 1 ? `(${s})` : s
    },
    Plus: (a) => formatAST(a.expr, 3) + "+",
    Star: (a) => formatAST(a.expr, 3) + "*",
    Opt: (a) => formatAST(a.expr, 3) + "?",
    Range: (a) => formatAST(a.expr, 3) + "{" + a.min + (a.max === a.min ? "" : "," + (a.max < 0 ? "" : a.max)) + "}"
  })

const isEmptyAST = (ast: ExprAST) => Predicate.isTagged(ast, "Seq") && Arr.isReadonlyArrayEmpty(ast.exprs)

// -----------------------------------------------------------------------------
// String parser (for Content.parse)
// -----------------------------------------------------------------------------

class TokenStream {
  pos = 0
  readonly tokens: Array<string>
  constructor(readonly source: string) {
    this.tokens = source.split(/\s*(?=\b|\W|$)/)
    if (this.tokens[this.tokens.length - 1] === "") this.tokens.pop()
    if (this.tokens[0] === "") this.tokens.shift()
  }
  get next(): string | undefined {
    return this.tokens[this.pos]
  }
  eat(tok: string): boolean {
    if (this.next === tok) {
      this.pos++
      return true
    }
    return false
  }
  err(str: string): never {
    throw new SchemaDefinitionError({ message: str + " (in content expression '" + this.source + "')" })
  }
}

function parseExpr(stream: TokenStream): ExprAST {
  const exprs = parseChoices(stream)
  return exprs.length === 1 ? exprs[0] : { _tag: "Choice", exprs }
}

function parseChoices(stream: TokenStream): Array<ExprAST> {
  const first = parseExprSeq(stream)
  return stream.eat("|") ? [first, ...parseChoices(stream)] : [first]
}

function parseExprSeq(stream: TokenStream): ExprAST {
  const exprs = parseSeqItems(stream)
  return exprs.length === 1 ? exprs[0] : { _tag: "Seq", exprs }
}

function parseSeqItems(stream: TokenStream): Array<ExprAST> {
  const first = parseExprSubscript(stream)
  const ended = stream.next === undefined || stream.next === ")" || stream.next === "|"
  return ended ? [first] : [first, ...parseSeqItems(stream)]
}

function parseExprSubscript(stream: TokenStream): ExprAST {
  return parseSuffixes(stream, parseExprAtom(stream))
}

function parseSuffixes(stream: TokenStream, expr: ExprAST): ExprAST {
  if (stream.eat("+")) return parseSuffixes(stream, { _tag: "Plus", expr })
  if (stream.eat("*")) return parseSuffixes(stream, { _tag: "Star", expr })
  if (stream.eat("?")) return parseSuffixes(stream, { _tag: "Opt", expr })
  if (stream.eat("{")) return parseSuffixes(stream, parseExprRange(stream, expr))
  return expr
}

function parseNum(stream: TokenStream): number {
  const next = stream.next
  if (next === undefined || /\D/.test(next)) stream.err("Expected number, got '" + next + "'")
  stream.pos++
  return Number(next)
}

function parseExprRange(stream: TokenStream, expr: ExprAST): ExprAST {
  const min = parseNum(stream)
  let max = min
  if (stream.eat(",")) {
    if (stream.next !== "}") max = parseNum(stream)
    else max = -1
  }
  if (!stream.eat("}")) stream.err("Unclosed braced range")
  return { _tag: "Range", min, max, expr }
}

function parseExprAtom(stream: TokenStream): ExprAST {
  if (stream.eat("(")) {
    const expr = parseExpr(stream)
    if (!stream.eat(")")) stream.err("Missing closing paren")
    return expr
  }
  const next = stream.next
  if (next !== undefined && !/\W/.test(next)) {
    stream.pos++
    return { _tag: "Name", name: next }
  }
  return stream.err("Unexpected token '" + next + "'")
}

// -----------------------------------------------------------------------------
// Compilation to a DFA
// -----------------------------------------------------------------------------

type Expr =
  | { readonly type: "choice"; readonly exprs: ReadonlyArray<Expr> }
  | { readonly type: "seq"; readonly exprs: ReadonlyArray<Expr> }
  | { readonly type: "plus"; readonly expr: Expr }
  | { readonly type: "star"; readonly expr: Expr }
  | { readonly type: "opt"; readonly expr: Expr }
  | { readonly type: "range"; readonly min: number; readonly max: number; readonly expr: Expr }
  | { readonly type: "name"; readonly value: NodeType }

/**
 * An edge in the content automaton.
 *
 * @since 0.1.0
 * @category models
 */
export interface MatchEdge {
  readonly type: NodeType
  readonly next: ContentMatch
}

// A step in the breadth-first search of `computeWrapping`: the wrapper
// entered to reach `match`, and the step it was entered from.
type WrapStep = { match: ContentMatch; type: NodeType | null; via: WrapStep | null }

// The wrapper types on the path to `step`, outermost first.
function wrapPath(step: WrapStep, out: Array<NodeType>): Array<NodeType> {
  if (step.type) {
    if (step.via) wrapPath(step.via, out)
    out.push(step.type)
  }
  return out
}

/**
 * Instances of this class represent a match state of a node type's
 * content expression, and can be used to find out whether further
 * content matches here, and whether a given position is a valid end of
 * the node.
 *
 * @since 0.1.0
 * @category models
 */
export class ContentMatch {
  /** @internal */
  readonly next: Array<MatchEdge> = []
  /** @internal */
  readonly wrapCache: Array<NodeType | ReadonlyArray<NodeType> | null> = []

  /** @internal */
  constructor(
    /** True when this match state represents a valid end of the node. */
    readonly validEnd: boolean
  ) {}

  /** @internal */
  static compile(
    content: ContentInput | undefined,
    nodeTypes: Readonly<Partial<Record<string, NodeType>>>,
    typeName: string
  ): ContentMatch {
    if (content === undefined) return ContentMatch.empty
    // A plain string in a spec's `content` field is read as ProseMirror
    // content expression syntax (a bare name parses to itself).
    const ast = Predicate.isString(content) ? parse(content).ast : content.ast
    if (isEmptyAST(ast)) return ContentMatch.empty
    const source = formatAST(ast, 0)
    const ctx: ResolveContext = { inline: null, nodeTypes, source, typeName }
    const expr = resolve(ast, ctx)
    const match = dfa(nfa(expr))
    checkForDeadEnds(match, source)
    return match
  }

  /**
   * Match a node type, returning a match after that node if
   * successful.
   */
  matchType(type: NodeType): Option.Option<ContentMatch> {
    return Option.fromNullishOr(this.matchTypeOrNull(type))
  }

  /** @internal */
  matchTypeOrNull(type: NodeType): ContentMatch | null {
    // Plain loops here and in `matchFragmentOrNull`: content checks run
    // them for every node, and callbacks cost the block-moves benchmark
    // a fifth of its speed.
    // oxlint-disable-next-line effect/imperative-loops
    for (let i = 0; i < this.next.length; i++) {
      if (this.next[i].type === type) return this.next[i].next
    }
    return null
  }

  /** Try to match a fragment. Returns the resulting match when successful. */
  matchFragment(frag: Fragment, start = 0, end = frag.childCount): Option.Option<ContentMatch> {
    return Option.fromNullishOr(this.matchFragmentOrNull(frag, start, end))
  }

  /** @internal */
  matchFragmentOrNull(frag: Fragment, start = 0, end = frag.childCount): ContentMatch | null {
    if (start >= end) return this
    let cur = this.matchTypeOrNull(frag.content[start].type)
    // oxlint-disable-next-line effect/imperative-loops
    for (let i = start + 1; cur && i < end; i++) cur = cur.matchTypeOrNull(frag.content[i].type)
    return cur
  }

  /** @internal */
  get inlineContent(): boolean {
    return Arr.isReadonlyArrayNonEmpty(this.next) && this.next[0].type.isInline
  }

  /** Get the first matching node type at this match position that can be generated. */
  get defaultType(): Option.Option<NodeType> {
    return Option.fromNullishOr(this.defaultTypeOrNull)
  }

  /** @internal */
  get defaultTypeOrNull(): NodeType | null {
    const edge = this.next.find(({ type }) => !(type.isText || type.hasRequiredAttrs()))
    return edge ? edge.type : null
  }

  /** @internal */
  compatible(other: ContentMatch): boolean {
    return this.next.some((a) => other.next.some((b) => a.type === b.type))
  }

  /**
   * Try to match the given fragment, and if that fails, see if it can
   * be made to match by inserting nodes in front of it. When
   * successful, return a fragment of inserted nodes (which may be
   * empty if nothing had to be inserted). When `toEnd` is true, only
   * return a fragment if the resulting match goes to the end of the
   * content expression.
   */
  fillBefore(after: Fragment, toEnd = false, startIndex = 0): Option.Option<Fragment> {
    return Option.fromNullishOr(this.fillBeforeOrNull(after, toEnd, startIndex))
  }

  /** @internal */
  fillBeforeOrNull(after: Fragment, toEnd = false, startIndex = 0): Fragment | null {
    const seen: Array<ContentMatch> = [this]
    function search(match: ContentMatch, types: ReadonlyArray<NodeType>): Option.Option<Fragment> {
      const finished = match.matchFragmentOrNull(after, startIndex)
      if (finished && (!toEnd || finished.validEnd)) {
        return Option.fromNullishOr(createAndFillAll(types))
      }
      return Arr.findFirst(match.next, ({ next, type }) => {
        if (type.isText || type.hasRequiredAttrs() || seen.indexOf(next) !== -1) return Option.none()
        seen.push(next)
        return search(next, types.concat(type))
      })
    }
    return Option.getOrNull(search(this, []))
  }

  /**
   * Find a set of wrapping node types that would allow a node of the
   * given type to appear at this position. The result may be empty
   * (when it fits directly) and will be `None` when no such wrapping
   * exists.
   */
  findWrapping(target: NodeType): Option.Option<ReadonlyArray<NodeType>> {
    return Option.fromNullishOr(this.findWrappingOrNull(target))
  }

  /** @internal */
  findWrappingOrNull(target: NodeType): ReadonlyArray<NodeType> | null {
    const i = this.wrapCache.findIndex((entry, k) => k % 2 === 0 && entry === target)
    if (i >= 0) {
      // SAFETY: the cache alternates targets and their wrappings.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      return this.wrapCache[i + 1] as ReadonlyArray<NodeType> | null
    }
    const computed = this.computeWrapping(target)
    this.wrapCache.push(target, computed)
    return computed
  }

  /** @internal */
  computeWrapping(target: NodeType): ReadonlyArray<NodeType> | null {
    const seen: Record<string, boolean> = Object.create(null)
    const active: Array<WrapStep> = [{ match: this, type: null, via: null }]
    // A breadth-first search, which appends to `active` as it goes.
    const visit = (head: number): Option.Option<ReadonlyArray<NodeType>> => {
      if (head === active.length) return Option.none()
      const current = active[head]
      const match = current.match
      if (match.matchTypeOrNull(target)) return Option.some(wrapPath(current, []))
      match.next.forEach(({ next, type }) => {
        if (!type.isLeaf && !type.hasRequiredAttrs() && !(type.name in seen) && (!current.type || next.validEnd)) {
          active.push({ match: type.contentMatch, type, via: current })
          seen[type.name] = true
        }
      })
      return visit(head + 1)
    }
    return Option.getOrNull(visit(0))
  }

  /** The number of outgoing edges this node has in the content automaton. */
  get edgeCount(): number {
    return this.next.length
  }

  /** Get the _n_th outgoing edge from this node in the content automaton. */
  edge(n: number): Option.Option<MatchEdge> {
    return Option.fromNullishOr(this.next[n])
  }

  /** @internal */
  toString(): string {
    const seen: Array<ContentMatch> = []
    function scan(m: ContentMatch) {
      seen.push(m)
      m.next.forEach(({ next }) => {
        if (seen.indexOf(next) === -1) scan(next)
      })
    }
    scan(this)
    return seen
      .map((m, i) => {
        const edges = m.next.map(({ next, type }) => type.name + "->" + seen.indexOf(next))
        return i + (m.validEnd ? "*" : " ") + " " + edges.join(", ")
      })
      .join("\n")
  }

  /** The match state of nodes that allow no content. */
  static readonly empty: ContentMatch = new ContentMatch(true)
}

interface ResolveContext {
  inline: boolean | null
  readonly nodeTypes: Readonly<Partial<Record<string, NodeType>>>
  readonly source: string
  readonly typeName: string
}

const fail = (ctx: ResolveContext, message: string): never => {
  throw new SchemaDefinitionError({
    message: `${message} (in content expression '${ctx.source}' of node type '${ctx.typeName}')`
  })
}

function resolveName(ctx: ResolveContext, name: string): ReadonlyArray<NodeType> {
  const types = ctx.nodeTypes
  const type = types[name]
  if (type) return [type]
  const result = Rec.values(types).filter((t): t is NodeType => t !== undefined && t.isInGroup(name))
  if (Arr.isArrayEmpty(result)) fail(ctx, "No node type or group '" + name + "' found")
  return result
}

function resolve(ast: ExprAST, ctx: ResolveContext): Expr {
  return Match.valueTags(ast, {
    Name: (a): Expr => {
      const exprs = resolveName(ctx, a.name).map((type): Expr => {
        if (ctx.inline === null) ctx.inline = type.isInline
        else if (ctx.inline !== type.isInline) fail(ctx, "Mixing inline and block content")
        return { type: "name", value: type }
      })
      return exprs.length === 1 ? exprs[0] : { type: "choice", exprs }
    },
    Choice: (a): Expr => ({ type: "choice", exprs: a.exprs.map((e) => resolve(e, ctx)) }),
    Seq: (a): Expr => ({ type: "seq", exprs: a.exprs.map((e) => resolve(e, ctx)) }),
    Plus: (a): Expr => ({ type: "plus", expr: resolve(a.expr, ctx) }),
    Star: (a): Expr => ({ type: "star", expr: resolve(a.expr, ctx) }),
    Opt: (a): Expr => ({ type: "opt", expr: resolve(a.expr, ctx) }),
    Range: (a): Expr => {
      if (a.min < 0 || (a.max >= 0 && a.max < a.min) || !Number.isInteger(a.min)) {
        fail(ctx, `Invalid repetition range {${a.min},${a.max}}`)
      }
      return { type: "range", min: a.min, max: a.max, expr: resolve(a.expr, ctx) }
    }
  })
}

// The code below compiles a regular-expression-like language into a
// deterministic finite automaton. For a good introduction to these
// concepts, see https://swtch.com/~rsc/regexp/regexp1.html

type Edge = { term: NodeType | undefined; to: number | undefined }

// Construct an NFA from an expression. The NFA is represented as an
// array of states, which are themselves arrays of edges. The first
// state is the entry state and the last node is the success state.
//
// Note that unlike typical NFAs, the edge ordering in this one is
// significant, in that it is used to contruct filler content when
// necessary.
function nfa(root: Expr): Array<Array<Edge>> {
  const graph: Array<Array<Edge>> = [[]]
  connect(compile(root, 0), node())
  return graph

  function node() {
    return graph.push([]) - 1
  }
  function edge(from: number, to?: number, term?: NodeType) {
    const e = { term, to }
    graph[from].push(e)
    return e
  }
  function connect(edges: Array<Edge>, to: number) {
    edges.forEach((e) => (e.to = to))
  }

  function compile(expr: Expr, from: number): Array<Edge> {
    return Match.value(expr).pipe(
      Match.discriminatorsExhaustive("type")({
        choice: (x) => x.exprs.reduce<Array<Edge>>((out, e) => out.concat(compile(e, from)), []),
        seq: (x) => {
          if (Arr.isReadonlyArrayEmpty(x.exprs)) return [edge(from)]
          // Each expression starts from a fresh node that the previous one's edges lead to.
          const last = x.exprs.length - 1
          let cur = from
          x.exprs.slice(0, last).forEach((e) => connect(compile(e, cur), (cur = node())))
          return compile(x.exprs[last], cur)
        },
        star: (x) => {
          const loop = node()
          edge(from, loop)
          connect(compile(x.expr, loop), loop)
          return [edge(loop)]
        },
        plus: (x) => {
          const loop = node()
          connect(compile(x.expr, from), loop)
          connect(compile(x.expr, loop), loop)
          return [edge(loop)]
        },
        opt: (x) => [edge(from)].concat(compile(x.expr, from)),
        range: (x) => {
          let cur = from
          times(x.min, () => {
            const next = node()
            connect(compile(x.expr, cur), next)
            cur = next
          })
          if (x.max === -1) {
            connect(compile(x.expr, cur), cur)
          } else {
            times(x.max - x.min, () => {
              const next = node()
              edge(cur, next)
              connect(compile(x.expr, cur), next)
              cur = next
            })
          }
          return [edge(cur)]
        },
        name: (x) => [edge(from, undefined, x.value)]
      })
    )
  }
}

const descending: Order.Order<number> = Order.flip(Order.Number)

// Run `f` `n` times.
const times = (n: number, f: () => void): void => Array.from({ length: n }).forEach(f)

// Get the set of nodes reachable by null edges from `node`. Omit
// nodes with only a single null-out-edge, since they may lead to
// needless duplicated nodes.
// A default node of each of `types`, or null when one can't be created.
function createAndFillAll(types: ReadonlyArray<NodeType>) {
  const nodes: Array<Node> = []
  const filled = types.every((type) => {
    const node = type.createAndFillOrNull()
    if (node) nodes.push(node)
    return node !== null
  })
  return filled ? Fragment.fromArray(nodes) : null
}

function nullFrom(graph: Array<Array<Edge>>, node: number): ReadonlyArray<number> {
  const result: Array<number> = []
  scan(node)
  return Arr.sort(result, descending)

  function scan(n: number): void {
    const edges = graph[n]
    const only = edges.length === 1 ? edges[0] : undefined
    if (only && !only.term && only.to !== undefined) return scan(only.to)
    result.push(n)
    edges.forEach(({ term, to }) => {
      if (!term && to !== undefined && result.indexOf(to) === -1) scan(to)
    })
  }
}

// Compiles an NFA as produced by `nfa` into a DFA, modeled as a set of
// state objects (`ContentMatch` instances) with transitions between
// them.
function dfa(graph: Array<Array<Edge>>): ContentMatch {
  const labeled: Record<string, ContentMatch> = Object.create(null)
  return explore(nullFrom(graph, 0))

  function explore(states: ReadonlyArray<number>): ContentMatch {
    const out: Array<[NodeType, Array<number>]> = []
    states.forEach((node) => {
      graph[node].forEach(({ term, to }) => {
        if (!term || to === undefined) return
        let set = out.find((entry) => entry[0] === term)?.[1]
        nullFrom(graph, to).forEach((n) => {
          if (!set) out.push([term, (set = [])])
          if (set.indexOf(n) === -1) set.push(n)
        })
      })
    })
    const state = (labeled[states.join(",")] = new ContentMatch(states.indexOf(graph.length - 1) > -1))
    out.forEach(([type, set]) => {
      const targets = Arr.sort(set, descending)
      state.next.push({ type, next: labeled[targets.join(",")] || explore(targets) })
    })
    return state
  }
}

function checkForDeadEnds(match: ContentMatch, source: string) {
  const work = [match]
  // Visits every state reachable from `match`, appending to `work` as it goes.
  const check = (i: number): void => {
    if (i === work.length) return
    const state = work[i]
    state.next.forEach(({ next }) => {
      if (work.indexOf(next) === -1) work.push(next)
    })
    if (!state.validEnd && state.next.every(({ type }) => type.isText || type.hasRequiredAttrs())) {
      throw new SchemaDefinitionError({
        message:
          "Only non-generatable nodes (" +
          state.next.map(({ type }) => type.name).join(", ") +
          ") in a required position (see https://prosemirror.net/docs/guide/#generatable) (in content expression '" +
          source +
          "')"
      })
    }
    check(i + 1)
  }
  check(0)
}
