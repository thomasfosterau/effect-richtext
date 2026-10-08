/**
 * Parsing Markdown into documents, using `markdown-it` as tokenizer.
 *
 * @since 0.1.0
 */
// Ported from prosemirror-markdown (MIT, Marijn Haverbeke and others)
import type * as Effect from "effect/Effect"
import MarkdownIt, { type Env, type MarkdownIt as Tokenizer, type Token } from "markdown-it"
import { attempt } from "../internal/attempt.ts"
import {
  type AnySchema,
  type Attrs,
  isModelError,
  Mark,
  type MarkNames,
  type MarkType,
  type ModelError,
  type Node,
  type NodeNames,
  type NodeType,
  type TextNode
} from "../model.ts"
import { isMarkdownError, MarkdownError } from "./errors.ts"
import { schema } from "./schema.ts"

function maybeMerge(a: Node<any, any>, b: Node<any, any>): Node<any, any> | undefined {
  if (a.isText && b.isText && Mark.sameSet(a.marks, b.marks)) {
    return (a as TextNode<any>).withText((a as TextNode<any>).text + (b as TextNode<any>).text)
  }
  return undefined
}

/**
 * A function handling a markdown-it token while parsing.
 *
 * @since 0.1.0
 * @category models
 */
export type TokenHandler<Sc extends AnySchema = AnySchema> = (
  state: MarkdownParseState<Sc>,
  token: Token,
  tokens: Array<Token>,
  i: number
) => void

interface StackEntry {
  readonly type: NodeType<any, any>
  readonly attrs: Attrs | null
  readonly content: Array<Node<any, any>>
  marks: ReadonlyArray<Mark<any, any>>
}

/**
 * Object used to track the context of a running parse.
 *
 * @since 0.1.0
 * @category models
 */
export class MarkdownParseState<Sc extends AnySchema = AnySchema> {
  /** @internal */
  readonly stack: Array<StackEntry>

  /** @internal */
  constructor(
    /** The schema being parsed into. */
    readonly schema: Sc,
    /** @internal */
    readonly tokenHandlers: { readonly [token: string]: TokenHandler<Sc> }
  ) {
    this.stack = [{ type: schema.topNodeType, attrs: null, content: [], marks: Mark.none }]
  }

  /** @internal */
  top(): StackEntry {
    return this.stack[this.stack.length - 1]!
  }

  /** @internal */
  push(elt: Node<any, any>): void {
    if (this.stack.length) this.top().content.push(elt)
  }

  /**
   * Adds the given text to the current position in the document, using
   * the current marks as styling.
   */
  addText(text: string): void {
    if (!text) return
    const top = this.top(), nodes = top.content, last = nodes[nodes.length - 1]
    const node = this.schema.textUnsafe(text, top.marks)
    const merged = last && maybeMerge(last, node)
    if (merged) nodes[nodes.length - 1] = merged
    else nodes.push(node)
  }

  /** Adds the given mark to the set of active marks. */
  openMark(mark: Mark<Sc, any>): void {
    const top = this.top()
    top.marks = mark.addToSet(top.marks)
  }

  /** Removes the given mark from the set of active marks. */
  closeMark(mark: MarkType<Sc, any>): void {
    const top = this.top()
    top.marks = mark.removeFromSet(top.marks)
  }

  /** Run the token handlers for the given tokens. Throws a `MarkdownError` for unsupported tokens. */
  parseTokens(toks: Array<Token>): void {
    for (let i = 0; i < toks.length; i++) {
      const tok = toks[i]!
      const handler = this.tokenHandlers[tok.type]
      if (!handler) {
        throw new MarkdownError({ message: "Token type `" + tok.type + "` not supported by Markdown parser" })
      }
      handler(this, tok, toks, i)
    }
  }

  /**
   * Add a node at the current position. Returns `null` (adding nothing)
   * when the content doesn't fit the node type.
   */
  addNode(
    type: NodeType<Sc, any>,
    attrs: Attrs | null,
    content?: ReadonlyArray<Node<Sc, any>>
  ): Node<Sc, any> | null {
    const top = this.top()
    const node = type.createAndFillOrNull(attrs, content, top ? top.marks : [])
    if (!node) return null
    this.push(node)
    return node
  }

  /** Wrap subsequent content in a node of the given type. */
  openNode(type: NodeType<Sc, any>, attrs: Attrs | null): void {
    this.stack.push({ type, attrs, content: [], marks: Mark.none })
  }

  /** Close and return the node that is currently on top of the stack. */
  closeNode(): Node<Sc, any> | null {
    const info = this.stack.pop()!
    return this.addNode(info.type, info.attrs, info.content)
  }
}

/**
 * Object type used to specify how Markdown tokens should be parsed.
 *
 * @since 0.1.0
 * @category models
 */
export interface ParseSpec<Sc extends AnySchema = AnySchema> {
  /**
   * This token maps to a single node, whose type can be looked up in the
   * schema under the given name. Exactly one of `node`, `block`, or
   * `mark` must be set.
   */
  readonly node?: NodeNames<Sc> | undefined

  /**
   * This token (unless `noCloseToken` is true) comes in `_open` and
   * `_close` variants (which are appended to the base token name
   * provides a the object property), and wraps a block of content. The
   * block should be wrapped in a node of the type named to by the
   * property's value. If the token does not have `_open` or `_close`,
   * use the `noCloseToken` option.
   */
  readonly block?: NodeNames<Sc> | undefined

  /**
   * This token (again, unless `noCloseToken` is true) also comes in
   * `_open` and `_close` variants, but should add a mark (named by the
   * value) to its content, rather than wrapping it in a node.
   */
  readonly mark?: MarkNames<Sc> | undefined

  /** Attributes for the node or mark. When `getAttrs` is provided, it takes precedence. */
  readonly attrs?: Attrs | null | undefined

  /**
   * A function used to compute the attributes for the node or mark that
   * takes a markdown-it token and returns an attribute object.
   */
  readonly getAttrs?: ((token: Token, tokenStream: Array<Token>, index: number) => Attrs | null) | undefined

  /**
   * Indicates that the markdown-it token has no `_open` or `_close` for
   * the nodes. This defaults to `true` for `code_inline`, `code_block`
   * and `fence`.
   */
  readonly noCloseToken?: boolean | undefined

  /** When true, ignore content for the matched token. */
  readonly ignore?: boolean | undefined
}

function attrs(spec: ParseSpec<any>, token: Token, tokens: Array<Token>, i: number): Attrs | null {
  if (spec.getAttrs) return spec.getAttrs(token, tokens, i)
  // For backwards compatibility when `attrs` is a Function
  else if ((spec.attrs as unknown) instanceof Function) return (spec.attrs as unknown as (t: Token) => Attrs)(token)
  else return spec.attrs ?? null
}

// Code content is represented as a single token with a `content`
// property in Markdown-it.
function noCloseToken(spec: ParseSpec<any>, type: string): boolean {
  return spec.noCloseToken || type == "code_inline" || type == "code_block" || type == "fence"
}

function withoutTrailingNewline(str: string): string {
  return str[str.length - 1] == "\n" ? str.slice(0, str.length - 1) : str
}

function noOp() {}

function tokenHandlers<Sc extends AnySchema>(
  schema: Sc,
  tokens: { readonly [token: string]: ParseSpec<Sc> }
): Record<string, TokenHandler<Sc>> {
  const handlers: Record<string, TokenHandler<Sc>> = Object.create(null)
  for (const type in tokens) {
    const spec = tokens[type]!
    if (spec.block) {
      const nodeType = schema.nodeType(spec.block) as NodeType<Sc, any>
      if (noCloseToken(spec, type)) {
        handlers[type] = (state, tok, tokens, i) => {
          state.openNode(nodeType, attrs(spec, tok, tokens, i))
          state.addText(withoutTrailingNewline(tok.content))
          state.closeNode()
        }
      } else {
        handlers[type + "_open"] = (state, tok, tokens, i) => state.openNode(nodeType, attrs(spec, tok, tokens, i))
        handlers[type + "_close"] = (state) => state.closeNode()
      }
    } else if (spec.node) {
      const nodeType = schema.nodeType(spec.node) as NodeType<Sc, any>
      handlers[type] = (state, tok, tokens, i) => state.addNode(nodeType, attrs(spec, tok, tokens, i))
    } else if (spec.mark) {
      const markType = schema.marks[spec.mark] as MarkType<Sc, any> | undefined
      if (!markType) throw new MarkdownError({ message: "Unknown mark type: " + spec.mark })
      if (noCloseToken(spec, type)) {
        handlers[type] = (state, tok, tokens, i) => {
          state.openMark(markType.createUnsafe(attrs(spec, tok, tokens, i)))
          state.addText(withoutTrailingNewline(tok.content))
          state.closeMark(markType)
        }
      } else {
        handlers[type + "_open"] = (state, tok, tokens, i) =>
          state.openMark(markType.createUnsafe(attrs(spec, tok, tokens, i)))
        handlers[type + "_close"] = (state) => state.closeMark(markType)
      }
    } else if (spec.ignore) {
      if (noCloseToken(spec, type)) {
        handlers[type] = noOp
      } else {
        handlers[type + "_open"] = noOp
        handlers[type + "_close"] = noOp
      }
    } else {
      throw new MarkdownError({ message: "Unrecognized parsing spec " + JSON.stringify(spec) })
    }
  }

  handlers.text = (state, tok) => state.addText(tok.content)
  handlers.inline = (state, tok) => state.parseTokens(tok.children!)
  handlers.softbreak = handlers.softbreak || ((state) => state.addText(" "))

  return handlers
}

/**
 * A configuration of a Markdown parser. Such a parser uses
 * [markdown-it](https://github.com/markdown-it/markdown-it) to tokenize
 * a file, and then runs the custom rules it is given over the tokens to
 * create a document tree.
 *
 * @since 0.1.0
 * @category models
 */
export class MarkdownParser<Sc extends AnySchema = AnySchema> {
  /** @internal */
  readonly tokenHandlers: { readonly [token: string]: TokenHandler<Sc> }

  /**
   * Create a parser with the given configuration. You can configure the
   * markdown-it parser to parse the dialect you want, and provide a
   * description of the entities those tokens map to in the `tokens`
   * object, which maps token names to descriptions of what to do with
   * them.
   *
   * Throws a `MarkdownError` for invalid parsing specs, and a
   * `ContentError` for unknown node types.
   */
  constructor(
    /** The parser's document schema. */
    readonly schema: Sc,
    /** This parser's markdown-it tokenizer. */
    readonly tokenizer: Tokenizer,
    /**
     * The value of the `tokens` object used to construct this parser.
     * Can be useful to copy and modify to base other parsers on.
     */
    readonly tokens: { readonly [name: string]: ParseSpec<Sc> }
  ) {
    this.tokenHandlers = tokenHandlers(schema, tokens)
  }

  /**
   * Parse a string as [CommonMark](http://commonmark.org/) markup, and
   * create a document as prescribed by this parser's rules.
   *
   * The second argument, when given, is passed through to the
   * [Markdown parser](https://markdown-it.github.io/markdown-it/#MarkdownIt.parse).
   *
   * Fails with a `MarkdownError` when the tokenizer produces a token
   * the parser has no rule for, and with a `ModelError` when a rule
   * produces invalid attributes.
   */
  parse(text: string, markdownEnv: Env = {}): Effect.Effect<Node<Sc>, MarkdownError | ModelError> {
    return attempt(
      () => this.parseUnsafe(text, markdownEnv),
      (u): u is MarkdownError | ModelError => isMarkdownError(u) || isModelError(u)
    )
  }

  /** Like `parse`, but throws a `MarkdownError` or `ModelError` on failure. */
  parseUnsafe(text: string, markdownEnv: Env = {}): Node<Sc> {
    const state = new MarkdownParseState(this.schema, this.tokenHandlers)
    let doc: Node<Sc, any> | null
    state.parseTokens(this.tokenizer.parse(text, markdownEnv))
    do {
      doc = state.closeNode()
    } while (state.stack.length)
    return (doc || this.schema.topNodeType.createAndFillOrNull()!) as Node<Sc>
  }
}

function listIsTight(tokens: ReadonlyArray<Token>, i: number): boolean {
  while (++i < tokens.length) {
    if (tokens[i]!.type != "list_item_open") return tokens[i]!.hidden
  }
  return false
}

const attrString = (value: string | number | null): string | null => value == null ? null : String(value)

/**
 * A parser parsing unextended [CommonMark](http://commonmark.org/),
 * without inline HTML, and producing a document in the Markdown schema.
 *
 * @since 0.1.0
 * @category parsers
 */
export const defaultMarkdownParser: MarkdownParser<typeof schema> = new MarkdownParser(
  schema,
  new MarkdownIt("commonmark", { html: false }),
  {
    blockquote: { block: "blockquote" },
    paragraph: { block: "paragraph" },
    list_item: { block: "list_item" },
    bullet_list: { block: "bullet_list", getAttrs: (_, tokens, i) => ({ tight: listIsTight(tokens, i) }) },
    ordered_list: {
      block: "ordered_list",
      getAttrs: (tok, tokens, i) => ({
        order: +tok.attrGet("start")! || 1,
        tight: listIsTight(tokens, i)
      })
    },
    heading: { block: "heading", getAttrs: (tok) => ({ level: +tok.tag.slice(1) }) },
    code_block: { block: "code_block", noCloseToken: true },
    fence: { block: "code_block", getAttrs: (tok) => ({ params: tok.info || "" }), noCloseToken: true },
    hr: { node: "horizontal_rule" },
    image: {
      node: "image",
      getAttrs: (tok) => ({
        src: attrString(tok.attrGet("src")),
        title: attrString(tok.attrGet("title")) || null,
        alt: tok.children![0] && tok.children![0].content || null
      })
    },
    hardbreak: { node: "hard_break" },

    em: { mark: "em" },
    strong: { mark: "strong" },
    link: {
      mark: "link",
      getAttrs: (tok) => ({
        href: attrString(tok.attrGet("href")),
        title: attrString(tok.attrGet("title")) || null
      })
    },
    code_inline: { mark: "code", noCloseToken: true }
  }
)
