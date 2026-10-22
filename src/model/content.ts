/**
 * Content expressions describe which children a node type allows.
 *
 * Unlike ProseMirror, which uses a string mini-language
 * (`"paragraph+"`, `"heading block*"`), content is described with
 * typed combinators. The node and group names a combinator refers to
 * are tracked at the type level, so the schema knows which node types
 * may appear inside each node:
 *
 * ```ts skip-type-checking
 * import { Content } from "effect-richtext/model"
 *
 * Content.seq("heading", Content.zeroOrMore("block"))
 * // ContentExpr<"heading" | "block">
 * ```
 *
 * `Content.parse` accepts the ProseMirror string syntax for
 * compatibility, at the cost of losing the type-level information.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Order from "effect/Order"
import * as Predicate from "effect/Predicate"
import { SchemaDefinitionError } from "./errors.ts"
import { Fragment } from "./fragment.ts"
import type { NodeType } from "./schema.ts"

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
 * A content expression referring to the node or group names `Refs`.
 *
 * @since 0.1.0
 * @category models
 */
export interface ContentExpr<out Refs extends string = string> {
  readonly [TypeId]: { readonly _Refs: (_: never) => Refs }
  readonly ast: ExprAST
}

/**
 * Anything that can be used where a content expression is expected: an
 * expression or a bare node/group name.
 *
 * @since 0.1.0
 * @category models
 */
export type ContentInput<Refs extends string = string> = ContentExpr<Refs> | Refs

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

const make = <R extends string>(ast: ExprAST): ContentExpr<R> => ({ [TypeId]: variance as any, ast })

const toAST = (input: ContentInput<string>): ExprAST =>
  Predicate.isString(input) ? { _tag: "Name", name: input } : input.ast

/**
 * @since 0.1.0
 * @category guards
 */
export const isContentExpr = (u: unknown): u is ContentExpr<string> => Predicate.isObjectOrArray(u) && TypeId in u

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
export const seq = <const Items extends ReadonlyArray<ContentInput<string>>>(
  ...items: Items
): ContentExpr<Refs<Items[number]>> =>
  items.length === 1 ? make(toAST(items[0]!)) : make({ _tag: "Seq", exprs: items.map(toAST) })

/**
 * Any one of the given expressions.
 *
 * @since 0.1.0
 * @category combinators
 */
export const choice = <const Items extends ReadonlyArray<ContentInput<string>>>(
  ...items: Items
): ContentExpr<Refs<Items[number]>> =>
  items.length === 1 ? make(toAST(items[0]!)) : make({ _tag: "Choice", exprs: items.map(toAST) })

/**
 * Zero or more repetitions (`expr*`).
 *
 * @since 0.1.0
 * @category combinators
 */
export const zeroOrMore = <const C extends ContentInput<string>>(item: C): ContentExpr<Refs<C>> =>
  make({ _tag: "Star", expr: toAST(item) })

/**
 * One or more repetitions (`expr+`).
 *
 * @since 0.1.0
 * @category combinators
 */
export const oneOrMore = <const C extends ContentInput<string>>(item: C): ContentExpr<Refs<C>> =>
  make({ _tag: "Plus", expr: toAST(item) })

/**
 * Zero or one occurrence (`expr?`).
 *
 * @since 0.1.0
 * @category combinators
 */
export const optional = <const C extends ContentInput<string>>(item: C): ContentExpr<Refs<C>> =>
  make({ _tag: "Opt", expr: toAST(item) })

/**
 * Between `min` and `max` repetitions (`expr{min,max}`). When `max` is
 * omitted it defaults to `min`; pass `Infinity` for no upper bound.
 *
 * @since 0.1.0
 * @category combinators
 */
export const repeat = <const C extends ContentInput<string>>(
  item: C,
  min: number,
  max: number = min
): ContentExpr<Refs<C>> => make({ _tag: "Range", min, max: max === Infinity ? -1 : max, expr: toAST(item) })

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
export const parse = (source: string): ContentExpr<string> => {
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
export const format = (expr: ContentInput<string>): string => formatAST(toAST(expr), 0)

const formatAST = (ast: ExprAST, prec: number): string =>
  Match.valueTags(ast, {
    Name: (ast) => ast.name,
    Choice: (ast) => {
      const s = ast.exprs.map((e) => formatAST(e, 1)).join(" | ")
      return prec > 0 ? `(${s})` : s
    },
    Seq: (ast) => {
      const s = ast.exprs.map((e) => formatAST(e, 2)).join(" ")
      return prec > 1 ? `(${s})` : s
    },
    Plus: (ast) => formatAST(ast.expr, 3) + "+",
    Star: (ast) => formatAST(ast.expr, 3) + "*",
    Opt: (ast) => formatAST(ast.expr, 3) + "?",
    Range: (ast) =>
      formatAST(ast.expr, 3) + "{" + ast.min + (ast.max === ast.min ? "" : "," + (ast.max < 0 ? "" : ast.max)) + "}"
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
  const exprs: Array<ExprAST> = []
  do exprs.push(parseExprSeq(stream))
  while (stream.eat("|"))
  return exprs.length === 1 ? exprs[0]! : { _tag: "Choice", exprs }
}

function parseExprSeq(stream: TokenStream): ExprAST {
  const exprs: Array<ExprAST> = []
  do exprs.push(parseExprSubscript(stream))
  while (stream.next !== undefined && stream.next !== ")" && stream.next !== "|")
  return exprs.length === 1 ? exprs[0]! : { _tag: "Seq", exprs }
}

function parseExprSubscript(stream: TokenStream): ExprAST {
  let expr = parseExprAtom(stream)
  for (;;) {
    if (stream.eat("+")) expr = { _tag: "Plus", expr }
    else if (stream.eat("*")) expr = { _tag: "Star", expr }
    else if (stream.eat("?")) expr = { _tag: "Opt", expr }
    else if (stream.eat("{")) expr = parseExprRange(stream, expr)
    else break
  }
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
    content: ContentInput<string> | undefined,
    nodeTypes: { readonly [name: string]: NodeType },
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
    for (let i = 0; i < this.next.length; i++) {
      if (this.next[i]!.type === type) return this.next[i]!.next
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
    let cur = this.matchTypeOrNull(frag.content[start]!.type)
    for (let i = start + 1; cur && i < end; i++) cur = cur.matchTypeOrNull(frag.content[i]!.type)
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
    for (let i = 0; i < this.next.length; i++) {
      const { type } = this.next[i]!
      if (!(type.isText || type.hasRequiredAttrs())) return type
    }
    return null
  }

  /** @internal */
  compatible(other: ContentMatch): boolean {
    for (let i = 0; i < this.next.length; i++) {
      for (let j = 0; j < other.next.length; j++) {
        if (this.next[i]!.type === other.next[j]!.type) return true
      }
    }
    return false
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
    function search(match: ContentMatch, types: ReadonlyArray<NodeType>): Fragment | null {
      const finished = match.matchFragmentOrNull(after, startIndex)
      if (finished && (!toEnd || finished.validEnd)) {
        return Fragment.fromArray(types.map((tp) => tp.createAndFillOrNull()!))
      }
      for (let i = 0; i < match.next.length; i++) {
        const { next, type } = match.next[i]!
        if (!(type.isText || type.hasRequiredAttrs()) && seen.indexOf(next) === -1) {
          seen.push(next)
          const found = search(next, types.concat(type))
          if (found) return found
        }
      }
      return null
    }
    return search(this, [])
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
    for (let i = 0; i < this.wrapCache.length; i += 2) {
      if (this.wrapCache[i] === target) return this.wrapCache[i + 1] as ReadonlyArray<NodeType> | null
    }
    const computed = this.computeWrapping(target)
    this.wrapCache.push(target, computed)
    return computed
  }

  /** @internal */
  computeWrapping(target: NodeType): ReadonlyArray<NodeType> | null {
    type Active = { match: ContentMatch; type: NodeType | null; via: Active | null }
    const seen: Record<string, boolean> = Object.create(null)
    const active: Array<Active> = [{ match: this, type: null, via: null }]
    while (active.length) {
      const current = active.shift()!
      const match = current.match
      if (match.matchTypeOrNull(target)) {
        const result: Array<NodeType> = []
        for (let obj: Active = current; obj.type; obj = obj.via!) result.push(obj.type)
        return result.reverse()
      }
      for (let i = 0; i < match.next.length; i++) {
        const { next, type } = match.next[i]!
        if (!type.isLeaf && !type.hasRequiredAttrs() && !(type.name in seen) && (!current.type || next.validEnd)) {
          active.push({ match: type.contentMatch, type, via: current })
          seen[type.name] = true
        }
      }
    }
    return null
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
      for (let i = 0; i < m.next.length; i++) {
        if (seen.indexOf(m.next[i]!.next) === -1) scan(m.next[i]!.next)
      }
    }
    scan(this)
    return seen
      .map((m, i) => {
        let out = i + (m.validEnd ? "*" : " ") + " "
        for (let i = 0; i < m.next.length; i++) {
          out += (i ? ", " : "") + m.next[i]!.type.name + "->" + seen.indexOf(m.next[i]!.next)
        }
        return out
      })
      .join("\n")
  }

  /** The match state of nodes that allow no content. */
  static readonly empty: ContentMatch = new ContentMatch(true)
}

interface ResolveContext {
  inline: boolean | null
  readonly nodeTypes: { readonly [name: string]: NodeType }
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
  const result: Array<NodeType> = []
  for (const typeName in types) {
    const type = types[typeName]!
    if (type.isInGroup(name)) result.push(type)
  }
  if (Arr.isArrayEmpty(result)) fail(ctx, "No node type or group '" + name + "' found")
  return result
}

function resolve(ast: ExprAST, ctx: ResolveContext): Expr {
  return Match.valueTags(ast, {
    Name: (ast): Expr => {
      const exprs = resolveName(ctx, ast.name).map((type): Expr => {
        if (ctx.inline === null) ctx.inline = type.isInline
        else if (ctx.inline !== type.isInline) fail(ctx, "Mixing inline and block content")
        return { type: "name", value: type }
      })
      return exprs.length === 1 ? exprs[0]! : { type: "choice", exprs }
    },
    Choice: (ast): Expr => ({ type: "choice", exprs: ast.exprs.map((e) => resolve(e, ctx)) }),
    Seq: (ast): Expr => ({ type: "seq", exprs: ast.exprs.map((e) => resolve(e, ctx)) }),
    Plus: (ast): Expr => ({ type: "plus", expr: resolve(ast.expr, ctx) }),
    Star: (ast): Expr => ({ type: "star", expr: resolve(ast.expr, ctx) }),
    Opt: (ast): Expr => ({ type: "opt", expr: resolve(ast.expr, ctx) }),
    Range: (ast): Expr => {
      if (ast.min < 0 || (ast.max >= 0 && ast.max < ast.min) || !Number.isInteger(ast.min)) {
        fail(ctx, `Invalid repetition range {${ast.min},${ast.max}}`)
      }
      return { type: "range", min: ast.min, max: ast.max, expr: resolve(ast.expr, ctx) }
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
function nfa(expr: Expr): Array<Array<Edge>> {
  const nfa: Array<Array<Edge>> = [[]]
  connect(compile(expr, 0), node())
  return nfa

  function node() {
    return nfa.push([]) - 1
  }
  function edge(from: number, to?: number, term?: NodeType) {
    const edge = { term, to }
    nfa[from]!.push(edge)
    return edge
  }
  function connect(edges: Array<Edge>, to: number) {
    edges.forEach((edge) => (edge.to = to))
  }

  function compile(expr: Expr, from: number): Array<Edge> {
    return Match.value(expr).pipe(
      Match.discriminatorsExhaustive("type")({
        choice: (expr) => expr.exprs.reduce((out, expr) => out.concat(compile(expr, from)), [] as Array<Edge>),
        seq: (expr) => {
          if (Arr.isReadonlyArrayEmpty(expr.exprs)) return [edge(from)]
          let cur = from
          for (let i = 0; ; i++) {
            const next = compile(expr.exprs[i]!, cur)
            if (i === expr.exprs.length - 1) return next
            connect(next, (cur = node()))
          }
        },
        star: (expr) => {
          const loop = node()
          edge(from, loop)
          connect(compile(expr.expr, loop), loop)
          return [edge(loop)]
        },
        plus: (expr) => {
          const loop = node()
          connect(compile(expr.expr, from), loop)
          connect(compile(expr.expr, loop), loop)
          return [edge(loop)]
        },
        opt: (expr) => [edge(from)].concat(compile(expr.expr, from)),
        range: (expr) => {
          let cur = from
          for (let i = 0; i < expr.min; i++) {
            const next = node()
            connect(compile(expr.expr, cur), next)
            cur = next
          }
          if (expr.max === -1) {
            connect(compile(expr.expr, cur), cur)
          } else {
            for (let i = expr.min; i < expr.max; i++) {
              const next = node()
              edge(cur, next)
              connect(compile(expr.expr, cur), next)
              cur = next
            }
          }
          return [edge(cur)]
        },
        name: (expr) => [edge(from, undefined, expr.value)]
      })
    )
  }
}

const descending: Order.Order<number> = Order.flip(Order.Number)

// Get the set of nodes reachable by null edges from `node`. Omit
// nodes with only a single null-out-edge, since they may lead to
// needless duplicated nodes.
function nullFrom(nfa: Array<Array<Edge>>, node: number): ReadonlyArray<number> {
  const result: Array<number> = []
  scan(node)
  return Arr.sort(result, descending)

  function scan(node: number): void {
    const edges = nfa[node]!
    if (edges.length === 1 && !edges[0]!.term) return scan(edges[0]!.to!)
    result.push(node)
    for (let i = 0; i < edges.length; i++) {
      const { term, to } = edges[i]!
      if (!term && result.indexOf(to!) === -1) scan(to!)
    }
  }
}

// Compiles an NFA as produced by `nfa` into a DFA, modeled as a set of
// state objects (`ContentMatch` instances) with transitions between
// them.
function dfa(nfa: Array<Array<Edge>>): ContentMatch {
  const labeled: Record<string, ContentMatch> = Object.create(null)
  return explore(nullFrom(nfa, 0))

  function explore(states: ReadonlyArray<number>): ContentMatch {
    const out: Array<[NodeType, Array<number>]> = []
    states.forEach((node) => {
      nfa[node]!.forEach(({ term, to }) => {
        if (!term) return
        let set: Array<number> | undefined
        for (let i = 0; i < out.length; i++) if (out[i]![0] === term) set = out[i]![1]
        nullFrom(nfa, to!).forEach((node) => {
          if (!set) out.push([term, (set = [])])
          if (set.indexOf(node) === -1) set.push(node)
        })
      })
    })
    const state = (labeled[states.join(",")] = new ContentMatch(states.indexOf(nfa.length - 1) > -1))
    for (let i = 0; i < out.length; i++) {
      const states = Arr.sort(out[i]![1], descending)
      state.next.push({ type: out[i]![0], next: labeled[states.join(",")] || explore(states) })
    }
    return state
  }
}

function checkForDeadEnds(match: ContentMatch, source: string) {
  for (let i = 0, work = [match]; i < work.length; i++) {
    const state = work[i]!
    let dead = !state.validEnd
    const nodes: Array<string> = []
    for (let j = 0; j < state.next.length; j++) {
      const { next, type } = state.next[j]!
      nodes.push(type.name)
      if (dead && !(type.isText || type.hasRequiredAttrs())) dead = false
      if (work.indexOf(next) === -1) work.push(next)
    }
    if (dead) {
      throw new SchemaDefinitionError({
        message:
          "Only non-generatable nodes (" +
          nodes.join(", ") +
          ") in a required position (see https://prosemirror.net/docs/guide/#generatable) (in content expression '" +
          source +
          "')"
      })
    }
  }
}
