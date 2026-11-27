/**
 * DOM parsing, ported from ProseMirror's `DOMParser`.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array"
import type * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import type * as Types from "effect/Types"
import { attempt } from "../internal/attempt.ts"
import type { ContentMatch } from "./content.ts"
import { isModelError, type ModelError, SchemaDefinitionError } from "./errors.ts"
import { Fragment } from "./fragment.ts"
import { Mark } from "./mark.ts"
import type { Node } from "./node.ts"
import { Slice } from "./replace.ts"
import type { ResolvedPos } from "./resolvedpos.ts"
import type { AnySchema, Attrs, MarkType, NodeType } from "./schema.ts"

// `skip` may also hold an element to parse in place of the matched one
// (undocumented ProseMirror behaviour).
const isDOMElement = (value: unknown): value is HTMLElement => Predicate.hasProperty(value, "nodeType")
const isElementNode = (node: globalThis.Node): node is HTMLElement => node.nodeType == 1
const isTextDOMNode = (node: globalThis.Node): node is Text => node.nodeType == 3

/**
 * A DOM position whose document position should be recorded while
 * parsing (see `ParseOptions.findPositions`).
 *
 * @since 0.1.0
 * @category models
 */
export interface DOMPosition {
  readonly node: globalThis.Node
  readonly offset: number
  pos?: number
}

/**
 * These are the options recognized by the
 * [`parse`](#DOMParser.parse) and [`parseSlice`](#DOMParser.parseSlice)
 * methods.
 *
 * @since 0.1.0
 * @category models
 */
export interface ParseOptions<Sc extends AnySchema = AnySchema> {
  /**
   * By default, whitespace is collapsed as per HTML's rules. Pass
   * `true` to preserve whitespace, but normalize newlines to spaces
   * or, if available, line break replacements, and `"full"` to
   * preserve whitespace entirely.
   */
  readonly preserveWhitespace?: boolean | "full"
  /**
   * When given, the parser will, beside parsing the content, record
   * the document positions of the given DOM positions. It will do so
   * by writing to the objects, adding a `pos` property that holds the
   * document position. DOM positions that are not in the parsed
   * content will not be written to.
   */
  readonly findPositions?: ReadonlyArray<DOMPosition>
  /** The child node index to start parsing from. */
  readonly from?: number
  /** The child node index to stop parsing at. */
  readonly to?: number
  /**
   * By default, the content is parsed into the schema's default top
   * node type. You can pass this option to use the type and attributes
   * from a different node as the top container.
   */
  readonly topNode?: Node<Sc, any>
  /**
   * Provide the starting content match that content parsed into the
   * top node is matched against.
   */
  readonly topMatch?: ContentMatch
  /**
   * A set of additional nodes to count as context when parsing, above
   * the given top node.
   */
  readonly context?: ResolvedPos<Sc>
  /** @internal */
  readonly ruleFromNode?: (node: globalThis.Node) => Option.Option<Omit<TagParseRule, "tag">>
  /** @internal */
  readonly topOpen?: boolean
}

/**
 * Fields that may be present in both tag and style parse rules.
 *
 * @since 0.1.0
 * @category models
 */
export interface GenericParseRule {
  /**
   * Can be used to change the order in which the parse rules in a
   * schema are tried. Those with higher priority come first. Rules
   * without a priority are counted as having priority 50. This
   * property is only meaningful in a schema—when directly constructing
   * a parser, the order of the rule array is used.
   */
  readonly priority?: number
  /**
   * By default, when a rule matches an element or style, no further
   * rules get a chance to match it. By setting this to `false`, you
   * indicate that even when this rule matches, other rules that come
   * after it should also run.
   */
  readonly consuming?: boolean
  /**
   * When given, restricts this rule to only match when the current
   * context—the parent nodes into which the content is being
   * parsed—matches this expression. Should contain one or more node
   * names or node group names followed by single or double slashes.
   * For example `"paragraph/"` means the rule only matches when the
   * parent node is a paragraph, `"blockquote/paragraph/"` restricts it
   * to be in a paragraph that is inside a blockquote, and
   * `"section//"` matches any position inside a section—a double slash
   * matches any sequence of ancestor nodes. To allow multiple
   * different contexts, they can be separated by a pipe (`|`)
   * character, as in `"blockquote/|list_item/"`.
   */
  readonly context?: string
  /** The name of the mark type to wrap the matched content in. */
  readonly mark?: string
  /**
   * When true, ignore content that matches this rule. Any `<head>`,
   * `<noscript>`, `<script>`, `<object>`, `<style>`, or `<title>` tags
   * encountered are automatically ignored when no rules match them.
   */
  readonly ignore?: boolean
  /** When true, finding an element that matches this rule will close the current node. */
  readonly closeParent?: boolean
  /**
   * When true, ignore the node that matches this rule, but do parse its
   * content. A DOM node instead parses that node's content (the view
   * uses this to skip decoration wrappers).
   */
  readonly skip?: boolean | globalThis.Node
  /**
   * Attributes for the node or mark created by this rule. When
   * `getAttrs` is provided, it takes precedence.
   */
  readonly attrs?: Attrs
}

/**
 * Parse rule targeting a DOM element.
 *
 * @since 0.1.0
 * @category models
 */
export interface TagParseRule extends GenericParseRule {
  /** A CSS selector describing the kind of DOM elements to match. */
  readonly tag: string
  /**
   * The namespace to match. Nodes are only matched when the namespace
   * matches (`None` matching nodes without one) or this property is
   * undefined.
   */
  readonly namespace?: Option.Option<string>
  /**
   * The name of the node type to create when this rule matches. Each
   * rule should have either a `node`, `mark`, or `ignore` property
   * (except when it appears in a node or mark spec, in which case the
   * `node` or `mark` property will be derived from its position).
   */
  readonly node?: string
  /**
   * A function used to compute the attributes for the node or mark
   * created by this rule. Can also be used to describe further
   * conditions the DOM element must match. When it returns `false`,
   * the rule won't match. When it returns `true`, the rule matches with
   * its own `attrs` (or the default attributes).
   */
  readonly getAttrs?: (node: HTMLElement) => Attrs | boolean
  /**
   * For rules that produce non-leaf nodes, by default the content of
   * the DOM element is parsed as content of the node. If the child
   * nodes are in a descendent node, this may be a CSS selector string
   * that the parser must use to find the actual content element, or a
   * function that returns the actual content element to the parser.
   */
  readonly contentElement?: string | HTMLElement | ((node: HTMLElement) => HTMLElement)
  /**
   * Can be used to override the content of a matched node. When
   * present, instead of parsing the node's child nodes, the result of
   * this function is used.
   */
  readonly getContent?: (node: globalThis.Node, schema: AnySchema) => Fragment<any, any>
  /**
   * Controls whether whitespace should be preserved when parsing the
   * content inside the matched element. `false` means whitespace may
   * be collapsed, `true` means that whitespace should be preserved but
   * newlines normalized to spaces, and `"full"` means that newlines
   * should also be preserved.
   */
  readonly preserveWhitespace?: boolean | "full"
}

/**
 * A parse rule targeting a style property.
 *
 * @since 0.1.0
 * @category models
 */
export interface StyleParseRule extends GenericParseRule {
  /**
   * A CSS property name to match. This rule will match inline styles
   * that list that property. May also have the form
   * `"property=value"`, in which case the rule only matches if the
   * property's value exactly matches the given value. (For more
   * complicated filters, use `getAttrs` and return false to indicate
   * that the match failed.) Rules matching styles may only produce
   * marks, not nodes.
   */
  readonly style: string
  /** Makes `ParseRule` a discriminated union. */
  readonly tag?: undefined
  /** Style rules can remove marks from the set of active marks. */
  readonly clearMark?: (mark: Mark<any, any>) => boolean
  /**
   * A function used to compute the attributes for the node or mark
   * created by this rule. Called with the style's value. When it
   * returns `false`, the rule won't match; when it returns `true`, the
   * rule matches with its own `attrs` (or the default attributes).
   */
  readonly getAttrs?: (node: string) => Attrs | boolean
}

/**
 * A value that describes how to parse a given DOM node or inline style
 * as a node or mark.
 *
 * @since 0.1.0
 * @category models
 */
export type ParseRule = TagParseRule | StyleParseRule

/**
 * The context against which a rule's `context` restriction is
 * checked. Parsers pass their internal parse state; when matching
 * rules directly, a context describing the top of a fresh parse is
 * used by default.
 *
 * @since 0.1.0
 * @category models
 */
export interface RuleContext {
  matchesContext(context: string): boolean
}

type AnyRule = Omit<TagParseRule, "tag"> & { readonly tag?: string }

function isTagRule(rule: ParseRule): rule is TagParseRule {
  return "tag" in rule && rule.tag != null
}
function isStyleRule(rule: ParseRule): rule is StyleParseRule {
  return "style" in rule && rule.style != null
}

// When a rule with `getAttrs` matches, a copy of the rule holding the
// computed attributes is returned (ProseMirror mutates the rule
// instead). This maps such copies back to the original rules.
const ruleOrigin = new WeakMap<ParseRule, ParseRule>()
const originOf = <R extends ParseRule>(rule: R): R => {
  const origin = ruleOrigin.get(rule)
  // SAFETY: `withAttrs` maps each copy to an original of the same kind.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return origin ? (origin as R) : rule
}

function withAttrs<R extends ParseRule>(rule: R, attrs: Attrs): R {
  const result: R = { ...rule, attrs }
  ruleOrigin.set(result, originOf(rule))
  return result
}

// Applies a matching rule's `getAttrs` result.
const matchedRule = <R extends ParseRule>(rule: R, result: Attrs | boolean): Option.Option<R> =>
  result === false ? Option.none() : Option.some(result === true ? rule : withAttrs(rule, result))

/**
 * A DOM parser represents a strategy for parsing DOM content into a
 * document conforming to a given schema. Its behavior is defined by an
 * array of [rules](#ParseRule).
 *
 * @since 0.1.0
 * @category models
 */
export class DOMParser<Sc extends AnySchema = AnySchema> {
  /** The tag rules of this parser, in order of precedence. */
  readonly tags: ReadonlyArray<TagParseRule> = []
  /** The style rules of this parser, in order of precedence. */
  readonly styles: ReadonlyArray<StyleParseRule> = []
  /** @internal */
  readonly matchedStyles: ReadonlyArray<string>
  /** @internal */
  readonly normalizeLists: boolean

  /**
   * Create a parser that targets the given schema, using the given
   * parsing rules.
   */
  constructor(
    /** The schema into which the parser parses. */
    readonly schema: Sc,
    /** The set of parse rules that the parser uses, in order of precedence. */
    readonly rules: ReadonlyArray<ParseRule>
  ) {
    const matchedStyles: Array<string> = []
    const tags: Array<TagParseRule> = [],
      styles: Array<StyleParseRule> = []
    rules.forEach((rule) => {
      if (isTagRule(rule)) {
        tags.push(rule)
      } else if (isStyleRule(rule)) {
        const prop = rule.style.split("=", 1)[0]
        if (matchedStyles.indexOf(prop) < 0) matchedStyles.push(prop)
        styles.push(rule)
      }
    })
    this.tags = tags
    this.styles = styles
    this.matchedStyles = matchedStyles

    // Only normalize list elements when lists in the schema can't directly contain themselves
    this.normalizeLists = !tags.some((r) => {
      if (!/^(ul|ol)\b/.test(r.tag) || !r.node) return false
      // A rule may name a node type the schema doesn't have.
      return Option.exists(Rec.get<string, NodeType>(schema.nodes, r.node), (node) =>
        Option.isSome(node.contentMatch.matchType(node))
      )
    })
  }

  /** Parse a document from the content of a DOM node. */
  parse(dom: globalThis.Node, options: ParseOptions<Sc> = {}): Effect.Effect<Node<Sc>, ModelError> {
    return attempt(() => this.parseUnsafe(dom, options), isModelError)
  }

  /** Like `parse`, but throws a `ModelError` on failure. */
  parseUnsafe(dom: globalThis.Node, options: ParseOptions<Sc> = {}): Node<Sc> {
    const context = new ParseContext(this, options, false)
    context.addAll(dom, Mark.none, options.from, options.to)
    // SAFETY: a context that isn't open finishes its top node, built from this schema.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return context.finish() as Node<Sc>
  }

  /**
   * Parses the content of the given DOM node, like
   * [`parse`](#DOMParser.parse), and takes the same set of options.
   * But unlike that method, which produces a whole node, this one
   * returns a slice that is open at the sides, meaning that the schema
   * constraints aren't applied to the start of nodes to the left of
   * the input and the end of nodes at the end.
   */
  parseSlice(dom: globalThis.Node, options: ParseOptions<Sc> = {}): Effect.Effect<Slice<Sc>, ModelError> {
    return attempt(() => this.parseSliceUnsafe(dom, options), isModelError)
  }

  /** Like `parseSlice`, but throws a `ModelError` on failure. */
  parseSliceUnsafe(dom: globalThis.Node, options: ParseOptions<Sc> = {}): Slice<Sc> {
    const context = new ParseContext(this, options, true)
    context.addAll(dom, Mark.none, options.from, options.to)
    // SAFETY: an open context finishes to its top node's content, built from this schema.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return Slice.maxOpen(context.finish() as Fragment<Sc>)
  }

  /**
   * Find the first tag rule (after `after`, when given) that matches
   * the given DOM node in the given context. When the rule has a
   * `getAttrs` function, the returned rule is a copy whose `attrs` hold
   * the computed attributes.
   */
  matchTag(dom: globalThis.Node, context?: RuleContext, after?: TagParseRule): Option.Option<TagParseRule> {
    return this.matchTagIn(dom, context ?? new ParseContext(this, {}, false), after)
  }

  /** @internal */
  matchTagIn(dom: globalThis.Node, context: RuleContext, after?: TagParseRule): Option.Option<TagParseRule> {
    const start = after ? this.tags.indexOf(originOf(after)) + 1 : 0
    return Arr.findFirst(this.tags.slice(start), (rule): Option.Option<TagParseRule> => {
      if (
        !matches(dom, rule.tag) ||
        (rule.namespace !== undefined && dom.namespaceURI != Option.getOrNull(rule.namespace)) ||
        (rule.context && !context.matchesContext(rule.context))
      ) {
        return Option.none()
      }
      return rule.getAttrs ? matchedRule(rule, rule.getAttrs(dom)) : Option.some(rule)
    })
  }

  /**
   * Find the first style rule (after `after`, when given) that matches
   * the given style property and value in the given context.
   */
  matchStyle(
    prop: string,
    value: string,
    context?: RuleContext,
    after?: StyleParseRule
  ): Option.Option<StyleParseRule> {
    return this.matchStyleIn(prop, value, context ?? new ParseContext(this, {}, false), after)
  }

  /** @internal */
  matchStyleIn(
    prop: string,
    value: string,
    context: RuleContext,
    after?: StyleParseRule
  ): Option.Option<StyleParseRule> {
    const start = after ? this.styles.indexOf(originOf(after)) + 1 : 0
    return Arr.findFirst(this.styles.slice(start), (rule): Option.Option<StyleParseRule> => {
      const style = rule.style
      if (
        style.indexOf(prop) != 0 ||
        (rule.context && !context.matchesContext(rule.context)) ||
        // Test that the style string either precisely matches the prop,
        // or has an '=' sign after the prop, followed by the given
        // value.
        (style.length > prop.length && (style.charCodeAt(prop.length) != 61 || style.slice(prop.length + 1) != value))
      ) {
        return Option.none()
      }
      return rule.getAttrs ? matchedRule(rule, rule.getAttrs(value)) : Option.some(rule)
    })
  }

  /**
   * Gather the parse rules from a schema's node and mark specs,
   * ordered by priority (and schema order for equal priorities). Rules
   * without a `node`/`mark` get the name of the type they were defined
   * on.
   */
  static schemaRules(schema: AnySchema): ReadonlyArray<ParseRule> {
    const result: Array<ParseRule> = []
    function insert(rule: ParseRule) {
      const priority = rule.priority == null ? 50 : rule.priority
      const i = result.findIndex((next) => (next.priority == null ? 50 : next.priority) < priority)
      result.splice(i < 0 ? result.length : i, 0, rule)
    }

    // Insert copies of a spec's rules, letting `complete` fill in their target.
    function insertAll<Rule extends ParseRule>(
      rules: ReadonlyArray<Rule> = [],
      complete: (rule: Types.Mutable<Rule>) => void
    ) {
      rules.forEach((r) => {
        const rule: Rule = { ...r }
        complete(rule)
        insert(rule)
      })
    }

    Rec.toEntries<string, MarkType>(schema.marks).forEach(([name, type]) =>
      insertAll<ParseRule>(type.spec.parseDOM, (rule) => {
        if (!(rule.mark || rule.ignore || ("clearMark" in rule && rule.clearMark))) rule.mark = name
      })
    )
    Rec.toEntries<string, NodeType>(schema.nodes).forEach(([name, type]) =>
      insertAll<TagParseRule>(type.spec.parseDOM, (rule) => {
        if (!(rule.node || rule.ignore || rule.mark)) rule.node = name
      })
    )
    return result
  }

  /**
   * Construct a DOM parser using the parsing rules listed in a schema's
   * node specs, reordered by priority. The parser is cached on the
   * schema.
   */
  static fromSchema<Sc extends AnySchema>(schema: Sc): DOMParser<Sc> {
    // Only this method writes `domParser`, with a parser for this schema.
    const cached = schema.cached.domParser
    if (cached instanceof DOMParser) return cached
    const parser = new DOMParser(schema, DOMParser.schemaRules(schema))
    schema.cached.domParser = parser
    return parser
  }
}

// A set of lower-case HTML tag names.
type TagTable = { readonly [tagName: string]: boolean }

const blockTags = {
  address: true,
  article: true,
  aside: true,
  blockquote: true,
  body: true,
  canvas: true,
  dd: true,
  div: true,
  dl: true,
  fieldset: true,
  figcaption: true,
  figure: true,
  footer: true,
  form: true,
  h1: true,
  h2: true,
  h3: true,
  h4: true,
  h5: true,
  h6: true,
  header: true,
  hgroup: true,
  hr: true,
  li: true,
  noscript: true,
  ol: true,
  output: true,
  p: true,
  pre: true,
  section: true,
  table: true,
  tfoot: true,
  ul: true
} satisfies TagTable

const ignoreTags = {
  head: true,
  noscript: true,
  object: true,
  script: true,
  style: true,
  title: true
} satisfies TagTable

const listTags = { ol: true, ul: true } satisfies TagTable

const hasOwn = (table: TagTable, key: string): boolean => Object.prototype.hasOwnProperty.call(table, key)

// Using a bitfield for node context options
const OPT_PRESERVE_WS = 1,
  OPT_PRESERVE_WS_FULL = 2,
  OPT_OPEN_LEFT = 4

function wsOptionsFor(type: Option.Option<NodeType>, base: number, preserveWhitespace?: boolean | "full") {
  if (preserveWhitespace !== undefined) {
    return (preserveWhitespace ? OPT_PRESERVE_WS : 0) | (preserveWhitespace === "full" ? OPT_PRESERVE_WS_FULL : 0)
  }
  return Option.exists(type, (t) => t.whitespace == "pre")
    ? OPT_PRESERVE_WS | OPT_PRESERVE_WS_FULL
    : base & ~OPT_OPEN_LEFT
}

class NodeContext {
  match: Option.Option<ContentMatch>
  content: Array<Node> = []

  // Marks applied to the node's children
  activeMarks: ReadonlyArray<Mark> = Mark.none

  constructor(
    // `None` for the top of an open (slice) parse.
    readonly type: Option.Option<NodeType>,
    readonly attrs: Option.Option<Attrs>,
    readonly marks: ReadonlyArray<Mark>,
    readonly solid: boolean,
    match: Option.Option<ContentMatch>,
    public options: number
  ) {
    this.match = Option.isSome(match)
      ? match
      : options & OPT_OPEN_LEFT
        ? Option.none()
        : Option.map(type, (t) => t.contentMatch)
  }

  findWrapping(node: Node): Option.Option<ReadonlyArray<NodeType>> {
    if (Option.isNone(this.match)) {
      if (Option.isNone(this.type)) return Option.some([])
      const start = this.type.value.contentMatch
      const afterFill = Option.flatMap(start.fillBefore(Fragment.from(node)), (fill) => start.matchFragment(fill))
      if (Option.isSome(afterFill)) {
        this.match = afterFill
      } else {
        const wrap = start.findWrapping(node.type)
        if (Option.isSome(wrap)) this.match = start.some
        return wrap
      }
    }
    return this.match.value.findWrapping(node.type)
  }

  finish(openEnd: boolean): Node | Fragment {
    if (!(this.options & OPT_PRESERVE_WS)) {
      // Strip trailing whitespace
      const last = this.content[this.content.length - 1]
      const m = last && last.isTextNode() ? /[ \t\r\n\f]+$/.exec(last.text) : undefined
      if (m && last.isTextNode()) {
        const text = last
        if (text.text.length == m[0].length) this.content.pop()
        else this.content[this.content.length - 1] = text.withText(text.text.slice(0, text.text.length - m[0].length))
      }
    }
    let content: Fragment = Fragment.from(this.content)
    if (!openEnd && Option.isSome(this.match)) {
      const endFill = this.match.value.fillBefore(Fragment.empty, true)
      if (Option.isSome(endFill)) content = content.append(endFill.value)
    }
    return Option.isSome(this.type)
      ? this.type.value.createUnsafe(Option.getOrUndefined(this.attrs), content, this.marks)
      : content
  }

  // Whether a mark of `markType` may apply to a `nodeType` node in this context.
  allowsMark(markType: MarkType, nodeType: NodeType): boolean {
    return Option.isSome(this.type) ? this.type.value.allowsMarkType(markType) : markMayApply(markType, nodeType)
  }

  inlineContext(node: globalThis.Node): boolean {
    if (Option.isSome(this.type)) return this.type.value.inlineContent
    if (this.content.length) return this.content[0].isInline
    return !!node.parentNode && !hasOwn(blockTags, node.parentNode.nodeName.toLowerCase())
  }
}

/** @internal */
class ParseContext implements RuleContext {
  open: number = 0
  find: ReadonlyArray<DOMPosition>
  needsBlock: boolean
  nodes: Array<NodeContext>
  localPreserveWS = false

  constructor(
    // The parser we are using.
    readonly parser: DOMParser,
    // The options passed to this parse.
    readonly options: ParseOptions<any>,
    readonly isOpen: boolean
  ) {
    const topNode = options.topNode
    let topContext: NodeContext
    const topOptions = wsOptionsFor(Option.none(), 0, options.preserveWhitespace) | (isOpen ? OPT_OPEN_LEFT : 0)
    if (topNode) {
      topContext = new NodeContext(
        Option.some(topNode.type),
        Option.some(topNode.attrs),
        Mark.none,
        true,
        Option.some(options.topMatch || topNode.type.contentMatch),
        topOptions
      )
    } else if (isOpen) {
      topContext = new NodeContext(Option.none(), Option.none(), Mark.none, true, Option.none(), topOptions)
    } else {
      topContext = new NodeContext(
        Option.some(parser.schema.topNodeType),
        Option.none(),
        Mark.none,
        true,
        Option.none(),
        topOptions
      )
    }
    this.nodes = [topContext]
    this.find = options.findPositions ?? []
    this.needsBlock = false
  }

  get top(): NodeContext {
    return this.nodes[this.open]
  }

  // Add a DOM node to the content. Text is inserted as text node,
  // otherwise, the node is passed to `addElement` or, if it has a
  // `style` attribute, `addElementWithStyles`.
  addDOM(dom: globalThis.Node, marks: ReadonlyArray<Mark>) {
    if (isTextDOMNode(dom)) this.addTextNode(dom, marks)
    else if (isElementNode(dom)) this.addElement(dom, marks)
  }

  addTextNode(dom: Text, marks: ReadonlyArray<Mark>) {
    let value = dom.data
    const top = this.top
    const preserveWS =
      top.options & OPT_PRESERVE_WS_FULL ? "full" : this.localPreserveWS || (top.options & OPT_PRESERVE_WS) > 0
    const schema = this.parser.schema
    const linebreak = schema.linebreakReplacement
    if (preserveWS === "full" || top.inlineContext(dom) || /[^ \t\r\n\f]/.test(value)) {
      if (!preserveWS) {
        value = value.replace(/[ \t\r\n\f]+/g, " ")
        // If this starts with whitespace, and there is no node before it, or
        // a hard break, or a text node that ends with whitespace, strip the
        // leading space.
        if (/^[ \t\r\n\f]/.test(value) && this.open == this.nodes.length - 1) {
          const nodeBefore = top.content[top.content.length - 1]
          const domNodeBefore = dom.previousSibling
          if (
            !nodeBefore ||
            (domNodeBefore && domNodeBefore.nodeName == "BR") ||
            (nodeBefore.isTextNode() && /[ \t\r\n\f]$/.test(nodeBefore.text))
          ) {
            value = value.slice(1)
          }
        }
      } else if (preserveWS === "full") {
        value = value.replace(/\r\n?/g, "\n")
      } else if (
        Option.isSome(linebreak) &&
        /[\r\n]/.test(value) &&
        Option.isSome(this.top.findWrapping(linebreak.value.createUnsafe()))
      ) {
        const lines = value.split(/\r?\n|\r/)
        lines.forEach((line, i) => {
          if (i) this.insertNode(linebreak.value.createUnsafe(), marks, true)
          if (line) this.insertNode(schema.textUnsafe(line), marks, !/\S/.test(line))
        })
        value = ""
      } else {
        value = value.replace(/\r?\n|\r/g, " ")
      }
      if (value) this.insertNode(schema.textUnsafe(value), marks, !/\S/.test(value))
      this.findInText(dom)
    } else {
      this.findInside(dom)
    }
  }

  // Try to find a handler for the given tag and use that to parse. If
  // none is found, the element's content nodes are added directly.
  addElement(dom: HTMLElement, marks: ReadonlyArray<Mark>, matchAfter?: TagParseRule) {
    const outerWS = this.localPreserveWS
    let top = this.top
    if (dom.tagName == "PRE" || /pre/.test(dom.style && dom.style.whiteSpace)) this.localPreserveWS = true
    const name = dom.nodeName.toLowerCase()
    if (hasOwn(listTags, name) && this.parser.normalizeLists) normalizeList(dom)
    const fromNode: Option.Option<AnyRule> = this.options.ruleFromNode ? this.options.ruleFromNode(dom) : Option.none()
    // The parser's rule, when `ruleFromNode` gave none.
    const ruleID = Option.isSome(fromNode) ? Option.none() : this.parser.matchTagIn(dom, this, matchAfter)
    const found: Option.Option<AnyRule> = Option.isSome(fromNode) ? fromNode : ruleID
    const rule = Option.getOrUndefined(found)
    out: if (rule ? rule.ignore : hasOwn(ignoreTags, name)) {
      this.findInside(dom)
      this.ignoreFallback(dom, marks)
    } else if (!rule || rule.skip || rule.closeParent) {
      if (rule && rule.closeParent) this.open = Math.max(0, this.open - 1)
      else if (rule && isDOMElement(rule.skip)) dom = rule.skip
      let sync = false
      const oldNeedsBlock = this.needsBlock
      if (hasOwn(blockTags, name)) {
        if (top.content.length && top.content[0].isInline && this.open) {
          this.open--
          top = this.top
        }
        sync = true
        if (Option.isNone(top.type)) this.needsBlock = true
      } else if (!dom.firstChild) {
        this.leafFallback(dom, marks)
        break out
      }
      const innerMarks = rule && rule.skip ? Option.some(marks) : this.readStyles(dom, marks)
      if (Option.isSome(innerMarks)) this.addAll(dom, innerMarks.value)
      if (sync) this.sync(top)
      this.needsBlock = oldNeedsBlock
    } else {
      const innerMarks = this.readStyles(dom, marks)
      if (Option.isSome(innerMarks)) {
        this.addElementByRule(
          dom,
          rule,
          innerMarks.value,
          rule.consuming === false ? Option.getOrUndefined(ruleID) : undefined
        )
      }
    }
    this.localPreserveWS = outerWS
  }

  // Called for leaf DOM nodes that would otherwise be ignored
  leafFallback(dom: globalThis.Node, marks: ReadonlyArray<Mark>) {
    const doc = dom.ownerDocument
    if (doc && dom.nodeName == "BR" && Option.exists(this.top.type, (type) => type.inlineContent)) {
      this.addTextNode(doc.createTextNode("\n"), marks)
    }
  }

  // Called for ignored nodes
  ignoreFallback(dom: globalThis.Node, marks: ReadonlyArray<Mark>) {
    // Ignored BR nodes should at least create an inline context
    if (dom.nodeName == "BR" && !Option.exists(this.top.type, (type) => type.inlineContent)) {
      this.findPlace(this.parser.schema.textUnsafe("-"), marks, true)
    }
  }

  // Run any style parser associated with the node's styles. Either
  // return an updated array of marks, or `None` to indicate some of the
  // styles had a rule with `ignore` set.
  readStyles(dom: HTMLElement, marks: ReadonlyArray<Mark>): Option.Option<ReadonlyArray<Mark>> {
    const styles = dom.style
    // Because many properties will only show up in 'normalized' form
    // in `style.item` (i.e. text-decoration becomes
    // text-decoration-line, text-decoration-color, etc), we directly
    // query the styles mentioned in our rules instead of iterating
    // over the items.
    if (styles && styles.length) {
      const ignored = this.parser.matchedStyles.some((name) => {
        const value = styles.getPropertyValue(name)
        if (!value) return false
        const applied = this.applyStyle(name, value, marks)
        if (Option.isSome(applied)) marks = applied.value
        return Option.isNone(applied)
      })
      if (ignored) return Option.none()
    }
    return Option.some(marks)
  }

  // Apply the rules matching a style, in order, until one consumes it.
  // None when a rule says to ignore the style.
  applyStyle(
    name: string,
    value: string,
    marks: ReadonlyArray<Mark>,
    after?: StyleParseRule
  ): Option.Option<ReadonlyArray<Mark>> {
    const found = this.parser.matchStyleIn(name, value, this, after)
    if (Option.isNone(found)) return Option.some(marks)
    const rule = found.value
    if (rule.ignore) return Option.none()
    const clearMark = rule.clearMark
    const next = clearMark
      ? marks.filter((m) => !clearMark(m))
      : marks.concat(markTypeFor(this.parser.schema, rule.mark).createUnsafe(rule.attrs))
    return rule.consuming === false ? this.applyStyle(name, value, next, rule) : Option.some(next)
  }

  // Look up a handler for the given node. If none are found, return
  // false. Otherwise, apply it, use its return value to drive the way
  // the node's content is wrapped, and return true.
  addElementByRule(dom: HTMLElement, rule: AnyRule, marks: ReadonlyArray<Mark>, continueAfter?: TagParseRule) {
    let sync = false
    const nodeType = rule.node ? Option.some(this.parser.schema.nodeType(rule.node)) : Option.none()
    if (Option.isSome(nodeType)) {
      if (!nodeType.value.isLeaf) {
        const inner = this.enter(nodeType.value, Option.fromUndefinedOr(rule.attrs), marks, rule.preserveWhitespace)
        if (Option.isSome(inner)) {
          sync = true
          marks = inner.value
        }
      } else if (!this.insertNode(nodeType.value.createUnsafe(rule.attrs), marks, dom.nodeName == "BR")) {
        this.leafFallback(dom, marks)
      }
    } else {
      marks = marks.concat(markTypeFor(this.parser.schema, rule.mark).createUnsafe(rule.attrs))
    }
    const startIn = this.top

    if (Option.exists(nodeType, (type) => type.isLeaf)) {
      this.findInside(dom)
    } else if (continueAfter) {
      this.addElement(dom, marks, continueAfter)
    } else if (rule.getContent) {
      this.findInside(dom)
      rule.getContent(dom, this.parser.schema).forEach((node) => this.insertNode(node, marks, false))
    } else {
      let contentDOM = dom
      // A selector that matches nothing parses the whole element.
      if (Predicate.isString(rule.contentElement)) contentDOM = dom.querySelector(rule.contentElement) ?? dom
      else if (Predicate.isFunction(rule.contentElement)) contentDOM = rule.contentElement(dom)
      else if (rule.contentElement) contentDOM = rule.contentElement
      this.findAround(dom, contentDOM, true)
      this.addAll(contentDOM, marks)
      this.findAround(dom, contentDOM, false)
    }
    if (sync && this.sync(startIn)) this.open--
  }

  // Add all child nodes between `startIndex` and `endIndex` (or the
  // whole node, if not given). If `sync` is passed, use it to
  // synchronize after every block element.
  addAll(parent: globalThis.Node, marks: ReadonlyArray<Mark>, startIndex?: number, endIndex?: number) {
    const start = startIndex || 0
    const children = Array.from(parent.childNodes).slice(start, endIndex)
    children.forEach((dom, i) => {
      this.findAtPoint(parent, start + i)
      this.addDOM(dom, marks)
    })
    this.findAtPoint(parent, start + children.length)
  }

  // Try to find a way to fit the given node type into the current
  // context. May add intermediate wrappers and/or leave non-solid
  // nodes that we're in.
  findPlace(node: Node, marks: ReadonlyArray<Mark>, cautious: boolean): Option.Option<ReadonlyArray<Mark>> {
    // The shortest route found so far, and the context it starts from.
    let best = Option.none<{ readonly route: ReadonlyArray<NodeType>; readonly sync: NodeContext }>()
    let penalty = 0
    // Walk out from the innermost open node, stopping at a direct fit, or
    // at a solid node when cautious.
    Arr.findLastIndex(this.nodes, (cx, depth) => {
      if (depth > this.open) return false
      const found = cx.findWrapping(node)
      if (Option.isSome(found) && (Option.isNone(best) || best.value.route.length > found.value.length + penalty)) {
        best = Option.some({ route: found.value, sync: cx })
        if (!found.value.length) return true
      }
      if (cx.solid) {
        if (cautious) return true
        penalty += 2
      }
      return false
    })
    if (Option.isNone(best)) return Option.none()
    this.sync(best.value.sync)
    return Option.some(
      best.value.route.reduce((inner, type) => this.enterInner(type, Option.none(), inner, false), marks)
    )
  }

  // Try to insert the given node, adjusting the context when needed.
  insertNode(node: Node, marks: ReadonlyArray<Mark>, cautious: boolean): boolean {
    if (node.isInline && this.needsBlock && Option.isNone(this.top.type)) {
      const block = this.textblockFromContext()
      if (Option.isSome(block)) marks = this.enterInner(block.value, Option.none(), marks)
    }
    const innerMarks = this.findPlace(node, marks, cautious)
    if (Option.isSome(innerMarks)) {
      this.closeExtra()
      const top = this.top
      if (Option.isSome(top.match)) top.match = top.match.value.matchType(node.type)
      const nodeMarks = innerMarks.value
        .concat(node.marks)
        .reduce<ReadonlyArray<Mark>>((set, m) => (top.allowsMark(m.type, node.type) ? m.addToSet(set) : set), Mark.none)
      top.content.push(node.mark(nodeMarks))
      return true
    }
    return false
  }

  // Try to start a node of the given type, adjusting the context when
  // necessary.
  enter(
    type: NodeType,
    attrs: Option.Option<Attrs>,
    marks: ReadonlyArray<Mark>,
    preserveWS?: boolean | "full"
  ): Option.Option<ReadonlyArray<Mark>> {
    return Option.map(this.findPlace(type.createUnsafe(Option.getOrUndefined(attrs)), marks, false), () =>
      this.enterInner(type, attrs, marks, true, preserveWS)
    )
  }

  // Open a node of the given type
  enterInner(
    type: NodeType,
    attrs: Option.Option<Attrs>,
    marks: ReadonlyArray<Mark>,
    solid: boolean = false,
    preserveWS?: boolean | "full"
  ): ReadonlyArray<Mark> {
    this.closeExtra()
    const top = this.top
    if (Option.isSome(top.match)) top.match = top.match.value.matchType(type)
    let options = wsOptionsFor(Option.some(type), top.options, preserveWS)
    if (top.options & OPT_OPEN_LEFT && Arr.isReadonlyArrayEmpty(top.content)) options |= OPT_OPEN_LEFT
    let applyMarks: ReadonlyArray<Mark> = Mark.none
    marks = marks.filter((m) => {
      if (top.allowsMark(m.type, type)) {
        applyMarks = m.addToSet(applyMarks)
        return false
      }
      return true
    })
    this.nodes.push(new NodeContext(Option.some(type), attrs, applyMarks, solid, Option.none(), options))
    this.open++
    return marks
  }

  // Make sure all nodes above this.open are finished and added to
  // their parents
  closeExtra(openEnd = false) {
    if (this.nodes.length - 1 > this.open) {
      // Finish each context into its parent, innermost first.
      this.nodes.slice(this.open).reduceRight((inner, outer) => {
        // SAFETY: every context above the top one has a node type, so it finishes to a node.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        outer.content.push(inner.finish(openEnd) as Node)
        return outer
      })
      this.nodes.length = this.open + 1
    }
  }

  finish(): Node | Fragment {
    this.open = 0
    this.closeExtra(this.isOpen)
    return this.nodes[0].finish(!!(this.isOpen || this.options.topOpen))
  }

  sync(to: NodeContext): boolean {
    const found = Arr.findLastIndex(this.nodes, (cx, i) => {
      if (i > this.open) return false
      if (cx == to) return true
      if (this.localPreserveWS) cx.options |= OPT_PRESERVE_WS
      return false
    })
    if (Option.isNone(found)) return false
    this.open = found.value
    return true
  }

  get currentPos(): number {
    this.closeExtra()
    // The open nodes' content, plus one for each open node's start token.
    return this.nodes
      .slice(0, this.open + 1)
      .reduce((pos, cx, i) => cx.content.reduce((size, node) => size + node.nodeSize, pos + (i ? 1 : 0)), 0)
  }

  findAtPoint(parent: globalThis.Node, offset: number) {
    this.find.forEach((found) => {
      if (found.node == parent && found.offset == offset) found.pos = this.currentPos
    })
  }

  findInside(parent: globalThis.Node) {
    this.find.forEach((found) => {
      if (found.pos == null && parent.nodeType == 1 && parent.contains(found.node)) found.pos = this.currentPos
    })
  }

  findAround(parent: globalThis.Node, content: globalThis.Node, before: boolean) {
    if (parent == content) return
    this.find.forEach((found) => {
      if (found.pos == null && parent.nodeType == 1 && parent.contains(found.node)) {
        const pos = content.compareDocumentPosition(found.node)
        if (pos & (before ? 2 : 4)) found.pos = this.currentPos
      }
    })
  }

  findInText(textNode: Text) {
    this.find.forEach((found) => {
      if (found.node == textNode) found.pos = this.currentPos - (textNode.data.length - found.offset)
    })
  }

  // Determines whether the given context string matches this context.
  matchesContext(context: string): boolean {
    if (context.indexOf("|") > -1) return context.split(/\s*\|\s*/).some((c) => this.matchesContext(c))

    const parts = context.split("/")
    const option = this.options.context
    const useRoot = !this.isOpen && (!option || Option.contains(this.nodes[0].type, option.parent.type))
    const minDepth = -(option ? option.depth + 1 : 0) + (useRoot ? 0 : 1)
    // Whether parts `0..i` match the context at `depth` and above it.
    const match = (i: number, depth: number): boolean => {
      if (i < 0) return true
      const part = parts[i]
      if (part == "") return i == parts.length - 1 || i == 0 ? match(i - 1, depth) : matchAtOrAbove(i - 1, depth)
      const next: Option.Option<NodeType> =
        depth > 0 || (depth == 0 && useRoot)
          ? this.nodes[depth].type
          : option && depth >= minDepth
            ? Option.some(option.node(depth - minDepth).type)
            : Option.none()
      if (!Option.exists(next, (type) => type.name == part || type.isInGroup(part))) return false
      return match(i - 1, depth - 1)
    }
    // A `//` skips any number of levels.
    const matchAtOrAbove = (i: number, depth: number): boolean =>
      depth >= minDepth && (match(i, depth) || matchAtOrAbove(i, depth - 1))
    return match(parts.length - 1, this.open)
  }

  textblockFromContext(): Option.Option<NodeType> {
    const $context = this.options.context
    const inContext = $context
      ? Arr.findFirst(Arr.reverse(Arr.range(0, $context.depth)), (d) =>
          Option.filter($context.node(d).contentMatchAtUnsafe($context.indexAfter(d)).defaultType, isDefaultTextblock)
        )
      : Option.none()
    const all: ReadonlyArray<NodeType> = Rec.values(this.parser.schema.nodes)
    return Option.orElse(inContext, () => Arr.findFirst(all, isDefaultTextblock))
  }
}

// A textblock that can be created without attributes.
const isDefaultTextblock = (type: NodeType): boolean => type.isTextblock && Option.isSome(type.defaultAttrs)

function markTypeFor(schema: AnySchema, name?: string): MarkType {
  const type = name === undefined ? Option.none() : Rec.get<string, MarkType>(schema.marks, name)
  if (Option.isNone(type)) {
    throw new SchemaDefinitionError({ message: `Parse rule refers to unknown mark type ${String(name)}` })
  }
  return type.value
}

// Kludge to work around directly nested list nodes produced by some
// tools and allowed by browsers to mean that the nested list is
// actually part of the list item above it.
function normalizeList(dom: globalThis.Node) {
  let prevItem = Option.none<ChildNode>()
  Array.from(dom.childNodes).forEach((child) => {
    if (child.nodeType != 1) return
    const name = child.nodeName.toLowerCase()
    if (hasOwn(listTags, name) && Option.isSome(prevItem)) {
      prevItem.value.appendChild(child)
    } else if (name == "li") {
      prevItem = Option.some(child)
    } else {
      prevItem = Option.none()
    }
  })
}

// Apply a CSS selector.
function matches(dom: globalThis.Node, selector: string): dom is HTMLElement {
  return isElementNode(dom) && dom.matches(selector)
}

// Used when finding a mark at the top level of a fragment parse.
// Checks whether it would be reasonable to apply a given mark type to
// a given node, by looking at the way the mark occurs in the schema.
function markMayApply(markType: MarkType, nodeType: NodeType): boolean {
  const nodes: ReadonlyArray<NodeType> = Rec.values(nodeType.schema.nodes)
  return nodes.some((parent) => {
    if (!parent.allowsMarkType(markType)) return false
    const seen: Array<ContentMatch> = []
    const scan = (match: ContentMatch): boolean => {
      seen.push(match)
      return match.next.some(({ next, type }) => type == nodeType || (seen.indexOf(next) < 0 && scan(next)))
    }
    return scan(parent.contentMatch)
  })
}
