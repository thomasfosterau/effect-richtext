/**
 * DOM parsing, ported from ProseMirror's `DOMParser`.
 *
 * @since 0.1.0
 */
import type * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { attempt } from "../internal/attempt.ts"
import type { ContentMatch } from "./content.ts"
import { isModelError, type ModelError, SchemaDefinitionError } from "./errors.ts"
import { Fragment } from "./fragment.ts"
import { Mark } from "./mark.ts"
import type { Node, TextNode } from "./node.ts"
import { Slice } from "./replace.ts"
import type { ResolvedPos } from "./resolvedpos.ts"
import type { AnySchema, Attrs, MarkType, NodeType } from "./schema.ts"

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
  readonly preserveWhitespace?: boolean | "full" | undefined
  /**
   * When given, the parser will, beside parsing the content, record
   * the document positions of the given DOM positions. It will do so
   * by writing to the objects, adding a `pos` property that holds the
   * document position. DOM positions that are not in the parsed
   * content will not be written to.
   */
  readonly findPositions?: ReadonlyArray<DOMPosition> | undefined
  /** The child node index to start parsing from. */
  readonly from?: number | undefined
  /** The child node index to stop parsing at. */
  readonly to?: number | undefined
  /**
   * By default, the content is parsed into the schema's default top
   * node type. You can pass this option to use the type and attributes
   * from a different node as the top container.
   */
  readonly topNode?: Node<Sc, any> | undefined
  /**
   * Provide the starting content match that content parsed into the
   * top node is matched against.
   */
  readonly topMatch?: ContentMatch | undefined
  /**
   * A set of additional nodes to count as context when parsing, above
   * the given top node.
   */
  readonly context?: ResolvedPos<Sc> | undefined
  /** @internal */
  readonly ruleFromNode?: ((node: globalThis.Node) => Omit<TagParseRule, "tag"> | null | undefined) | undefined
  /** @internal */
  readonly topOpen?: boolean | undefined
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
  readonly priority?: number | undefined
  /**
   * By default, when a rule matches an element or style, no further
   * rules get a chance to match it. By setting this to `false`, you
   * indicate that even when this rule matches, other rules that come
   * after it should also run.
   */
  readonly consuming?: boolean | undefined
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
  readonly context?: string | undefined
  /** The name of the mark type to wrap the matched content in. */
  readonly mark?: string | undefined
  /**
   * When true, ignore content that matches this rule. Any `<head>`,
   * `<noscript>`, `<script>`, `<object>`, `<style>`, or `<title>` tags
   * encountered are automatically ignored when no rules match them.
   */
  readonly ignore?: boolean | undefined
  /** When true, finding an element that matches this rule will close the current node. */
  readonly closeParent?: boolean | undefined
  /** When true, ignore the node that matches this rule, but do parse its content. */
  readonly skip?: boolean | undefined
  /**
   * Attributes for the node or mark created by this rule. When
   * `getAttrs` is provided, it takes precedence.
   */
  readonly attrs?: Attrs | undefined
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
   * matches or this property is undefined.
   */
  readonly namespace?: string | null | undefined
  /**
   * The name of the node type to create when this rule matches. Each
   * rule should have either a `node`, `mark`, or `ignore` property
   * (except when it appears in a node or mark spec, in which case the
   * `node` or `mark` property will be derived from its position).
   */
  readonly node?: string | undefined
  /**
   * A function used to compute the attributes for the node or mark
   * created by this rule. Can also be used to describe further
   * conditions the DOM element must match. When it returns `false`,
   * the rule won't match. When it returns null or undefined, that is
   * interpreted as an empty/default set of attributes.
   */
  readonly getAttrs?: ((node: HTMLElement) => Attrs | false | null | undefined) | undefined
  /**
   * For rules that produce non-leaf nodes, by default the content of
   * the DOM element is parsed as content of the node. If the child
   * nodes are in a descendent node, this may be a CSS selector string
   * that the parser must use to find the actual content element, or a
   * function that returns the actual content element to the parser.
   */
  readonly contentElement?: string | HTMLElement | ((node: HTMLElement) => HTMLElement) | undefined
  /**
   * Can be used to override the content of a matched node. When
   * present, instead of parsing the node's child nodes, the result of
   * this function is used.
   */
  readonly getContent?: ((node: globalThis.Node, schema: AnySchema) => Fragment<any, any>) | undefined
  /**
   * Controls whether whitespace should be preserved when parsing the
   * content inside the matched element. `false` means whitespace may
   * be collapsed, `true` means that whitespace should be preserved but
   * newlines normalized to spaces, and `"full"` means that newlines
   * should also be preserved.
   */
  readonly preserveWhitespace?: boolean | "full" | undefined
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
  readonly clearMark?: ((mark: Mark<any, any>) => boolean) | undefined
  /**
   * A function used to compute the attributes for the node or mark
   * created by this rule. Called with the style's value.
   */
  readonly getAttrs?: ((node: string) => Attrs | false | null | undefined) | undefined
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

type AnyRule = Omit<TagParseRule, "tag"> & { readonly tag?: string | undefined }

function isTagRule(rule: ParseRule): rule is TagParseRule {
  return (rule as TagParseRule).tag != null
}
function isStyleRule(rule: ParseRule): rule is StyleParseRule {
  return (rule as StyleParseRule).style != null
}

// When a rule with `getAttrs` matches, a copy of the rule holding the
// computed attributes is returned (ProseMirror mutates the rule
// instead). This maps such copies back to the original rules.
const ruleOrigin = new WeakMap<ParseRule, ParseRule>()
const originOf = <R extends ParseRule>(rule: R): R => (ruleOrigin.get(rule) as R | undefined) ?? rule

function withAttrs<R extends ParseRule>(rule: R, attrs: Attrs | false | null | undefined): R {
  const result = { ...rule, attrs: attrs || undefined } as R
  ruleOrigin.set(result, originOf(rule))
  return result
}

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
        const prop = /[^=]*/.exec(rule.style)![0]
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
      const node = schema.nodes[r.node] as NodeType | undefined
      return !!node && !!node.contentMatch.matchTypeOrNull(node)
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
    return Slice.maxOpen(context.finish() as Fragment<Sc>)
  }

  /**
   * Find the first tag rule (after `after`, when given) that matches
   * the given DOM node in the given context. When the rule has a
   * `getAttrs` function, the returned rule is a copy whose `attrs` hold
   * the computed attributes.
   */
  matchTag(dom: globalThis.Node, context?: RuleContext, after?: TagParseRule): Option.Option<TagParseRule> {
    return Option.fromNullishOr(this.matchTagOrNull(dom, context ?? new ParseContext(this, {}, false), after))
  }

  /** @internal */
  matchTagOrNull(dom: globalThis.Node, context: RuleContext, after?: TagParseRule): TagParseRule | null {
    for (let i = after ? this.tags.indexOf(originOf(after)) + 1 : 0; i < this.tags.length; i++) {
      const rule = this.tags[i]!
      if (
        matches(dom, rule.tag) &&
        (rule.namespace === undefined || (dom as Element).namespaceURI == rule.namespace) &&
        (!rule.context || context.matchesContext(rule.context))
      ) {
        if (rule.getAttrs) {
          const result = rule.getAttrs(dom as HTMLElement)
          if (result === false) continue
          return withAttrs(rule, result)
        }
        return rule
      }
    }
    return null
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
    return Option.fromNullishOr(this.matchStyleOrNull(prop, value, context ?? new ParseContext(this, {}, false), after))
  }

  /** @internal */
  matchStyleOrNull(prop: string, value: string, context: RuleContext, after?: StyleParseRule): StyleParseRule | null {
    for (let i = after ? this.styles.indexOf(originOf(after)) + 1 : 0; i < this.styles.length; i++) {
      const rule = this.styles[i]!,
        style = rule.style
      if (
        style.indexOf(prop) != 0 ||
        (rule.context && !context.matchesContext(rule.context)) ||
        // Test that the style string either precisely matches the prop,
        // or has an '=' sign after the prop, followed by the given
        // value.
        (style.length > prop.length && (style.charCodeAt(prop.length) != 61 || style.slice(prop.length + 1) != value))
      ) {
        continue
      }
      if (rule.getAttrs) {
        const result = rule.getAttrs(value)
        if (result === false) continue
        return withAttrs(rule, result)
      }
      return rule
    }
    return null
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
      let i = 0
      for (; i < result.length; i++) {
        const next = result[i]!,
          nextPriority = next.priority == null ? 50 : next.priority
        if (nextPriority < priority) break
      }
      result.splice(i, 0, rule)
    }

    for (const name in schema.marks) {
      const rules: ReadonlyArray<ParseRule> | undefined = schema.marks[name]!.spec.parseDOM
      if (rules) {
        rules.forEach((r) => {
          const rule = { ...r } as { -readonly [K in keyof ParseRule]: ParseRule[K] }
          if (!(rule.mark || rule.ignore || (rule as StyleParseRule).clearMark)) rule.mark = name
          insert(rule as ParseRule)
        })
      }
    }
    for (const name in schema.nodes) {
      const rules: ReadonlyArray<TagParseRule> | undefined = schema.nodes[name]!.spec.parseDOM
      if (rules) {
        rules.forEach((r) => {
          const rule = { ...r } as { -readonly [K in keyof TagParseRule]: TagParseRule[K] }
          if (!(rule.node || rule.ignore || rule.mark)) rule.node = name
          insert(rule)
        })
      }
    }
    return result
  }

  /**
   * Construct a DOM parser using the parsing rules listed in a schema's
   * node specs, reordered by priority. The parser is cached on the
   * schema.
   */
  static fromSchema<Sc extends AnySchema>(schema: Sc): DOMParser<Sc> {
    return (
      (schema.cached.domParser as DOMParser<Sc> | undefined) ||
      ((schema.cached.domParser = new DOMParser(schema, DOMParser.schemaRules(schema))) as DOMParser<Sc>)
    )
  }
}

const blockTags: { readonly [tagName: string]: boolean } = {
  address: true,
  article: true,
  aside: true,
  blockquote: true,
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
}

const ignoreTags: { readonly [tagName: string]: boolean } = {
  head: true,
  noscript: true,
  object: true,
  script: true,
  style: true,
  title: true
}

const listTags: { readonly [tagName: string]: boolean } = { ol: true, ul: true }

const hasOwn = (obj: object, key: string): boolean => Object.prototype.hasOwnProperty.call(obj, key)

// Using a bitfield for node context options
const OPT_PRESERVE_WS = 1,
  OPT_PRESERVE_WS_FULL = 2,
  OPT_OPEN_LEFT = 4

function wsOptionsFor(type: NodeType | null, preserveWhitespace: boolean | "full" | undefined, base: number) {
  if (preserveWhitespace != null) {
    return (preserveWhitespace ? OPT_PRESERVE_WS : 0) | (preserveWhitespace === "full" ? OPT_PRESERVE_WS_FULL : 0)
  }
  return type && type.whitespace == "pre" ? OPT_PRESERVE_WS | OPT_PRESERVE_WS_FULL : base & ~OPT_OPEN_LEFT
}

class NodeContext {
  match: ContentMatch | null
  content: Array<Node> = []

  // Marks applied to the node's children
  activeMarks: ReadonlyArray<Mark> = Mark.none

  constructor(
    readonly type: NodeType | null,
    readonly attrs: Attrs | null,
    readonly marks: ReadonlyArray<Mark>,
    readonly solid: boolean,
    match: ContentMatch | null,
    public options: number
  ) {
    this.match = match || (options & OPT_OPEN_LEFT ? null : type!.contentMatch)
  }

  findWrapping(node: Node): ReadonlyArray<NodeType> | null {
    if (!this.match) {
      if (!this.type) return []
      const fill = this.type.contentMatch.fillBeforeOrNull(Fragment.from(node))
      if (fill) {
        this.match = this.type.contentMatch.matchFragmentOrNull(fill)!
      } else {
        const start = this.type.contentMatch
        const wrap = start.findWrappingOrNull(node.type)
        if (wrap) {
          this.match = start
          return wrap
        } else {
          return null
        }
      }
    }
    return this.match.findWrappingOrNull(node.type)
  }

  finish(openEnd: boolean): Node | Fragment {
    if (!(this.options & OPT_PRESERVE_WS)) {
      // Strip trailing whitespace
      const last = this.content[this.content.length - 1]
      let m: RegExpExecArray | null
      if (last && last.isText && (m = /[ \t\r\n\f]+$/.exec((last as TextNode).text))) {
        const text = last as TextNode
        if (text.text.length == m[0].length) this.content.pop()
        else this.content[this.content.length - 1] = text.withText(text.text.slice(0, text.text.length - m[0].length))
      }
    }
    let content: Fragment = Fragment.from(this.content)
    if (!openEnd && this.match) content = content.append(this.match.fillBeforeOrNull(Fragment.empty, true)!)
    return this.type ? this.type.createUnsafe(this.attrs, content, this.marks) : content
  }

  inlineContext(node: globalThis.Node): boolean {
    if (this.type) return this.type.inlineContent
    if (this.content.length) return this.content[0]!.isInline
    return !!node.parentNode && !hasOwn(blockTags, node.parentNode.nodeName.toLowerCase())
  }
}

/** @internal */
class ParseContext implements RuleContext {
  open: number = 0
  find: ReadonlyArray<DOMPosition> | undefined
  needsBlock: boolean
  nodes: Array<NodeContext>
  localPreserveWS = false

  constructor(
    // The parser we are using.
    readonly parser: DOMParser<any>,
    // The options passed to this parse.
    readonly options: ParseOptions<any>,
    readonly isOpen: boolean
  ) {
    const topNode = options.topNode
    let topContext: NodeContext
    const topOptions = wsOptionsFor(null, options.preserveWhitespace, 0) | (isOpen ? OPT_OPEN_LEFT : 0)
    if (topNode) {
      topContext = new NodeContext(
        topNode.type,
        topNode.attrs,
        Mark.none,
        true,
        options.topMatch || topNode.type.contentMatch,
        topOptions
      )
    } else if (isOpen) {
      topContext = new NodeContext(null, null, Mark.none, true, null, topOptions)
    } else {
      topContext = new NodeContext(parser.schema.topNodeType, null, Mark.none, true, null, topOptions)
    }
    this.nodes = [topContext]
    this.find = options.findPositions
    this.needsBlock = false
  }

  get top(): NodeContext {
    return this.nodes[this.open]!
  }

  // Add a DOM node to the content. Text is inserted as text node,
  // otherwise, the node is passed to `addElement` or, if it has a
  // `style` attribute, `addElementWithStyles`.
  addDOM(dom: globalThis.Node, marks: ReadonlyArray<Mark>) {
    if (dom.nodeType == 3) this.addTextNode(dom as Text, marks)
    else if (dom.nodeType == 1) this.addElement(dom as HTMLElement, marks)
  }

  addTextNode(dom: Text, marks: ReadonlyArray<Mark>) {
    let value = dom.nodeValue!
    const top = this.top
    const preserveWS =
      top.options & OPT_PRESERVE_WS_FULL ? "full" : this.localPreserveWS || (top.options & OPT_PRESERVE_WS) > 0
    const schema = this.parser.schema as AnySchema
    const linebreak = Option.getOrNull(schema.linebreakReplacement)
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
            (nodeBefore.isText && /[ \t\r\n\f]$/.test((nodeBefore as TextNode).text))
          ) {
            value = value.slice(1)
          }
        }
      } else if (preserveWS === "full") {
        value = value.replace(/\r\n?/g, "\n")
      } else if (linebreak && /[\r\n]/.test(value) && this.top.findWrapping(linebreak.createUnsafe())) {
        const lines = value.split(/\r?\n|\r/)
        for (let i = 0; i < lines.length; i++) {
          if (i) this.insertNode(linebreak.createUnsafe(), marks, true)
          if (lines[i]) this.insertNode(schema.textUnsafe(lines[i]!), marks, !/\S/.test(lines[i]!))
        }
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
    let ruleID: TagParseRule | null | undefined
    if (hasOwn(listTags, name) && this.parser.normalizeLists) normalizeList(dom)
    const rule: AnyRule | null | undefined =
      (this.options.ruleFromNode && this.options.ruleFromNode(dom)) ||
      (ruleID = this.parser.matchTagOrNull(dom, this, matchAfter))
    out: if (rule ? rule.ignore : hasOwn(ignoreTags, name)) {
      this.findInside(dom)
      this.ignoreFallback(dom, marks)
    } else if (!rule || rule.skip || rule.closeParent) {
      if (rule && rule.closeParent) this.open = Math.max(0, this.open - 1)
      else if (rule && (rule.skip as any).nodeType) dom = rule.skip as any as HTMLElement
      let sync = false
      const oldNeedsBlock = this.needsBlock
      if (hasOwn(blockTags, name)) {
        if (top.content.length && top.content[0]!.isInline && this.open) {
          this.open--
          top = this.top
        }
        sync = true
        if (!top.type) this.needsBlock = true
      } else if (!dom.firstChild) {
        this.leafFallback(dom, marks)
        break out
      }
      const innerMarks = rule && rule.skip ? marks : this.readStyles(dom, marks)
      if (innerMarks) this.addAll(dom, innerMarks)
      if (sync) this.sync(top)
      this.needsBlock = oldNeedsBlock
    } else {
      const innerMarks = this.readStyles(dom, marks)
      if (innerMarks) {
        this.addElementByRule(
          dom,
          rule as TagParseRule,
          innerMarks,
          rule.consuming === false ? (ruleID ?? undefined) : undefined
        )
      }
    }
    this.localPreserveWS = outerWS
  }

  // Called for leaf DOM nodes that would otherwise be ignored
  leafFallback(dom: globalThis.Node, marks: ReadonlyArray<Mark>) {
    if (dom.nodeName == "BR" && this.top.type && this.top.type.inlineContent) {
      this.addTextNode(dom.ownerDocument!.createTextNode("\n"), marks)
    }
  }

  // Called for ignored nodes
  ignoreFallback(dom: globalThis.Node, marks: ReadonlyArray<Mark>) {
    // Ignored BR nodes should at least create an inline context
    if (dom.nodeName == "BR" && (!this.top.type || !this.top.type.inlineContent)) {
      this.findPlace((this.parser.schema as AnySchema).textUnsafe("-"), marks, true)
    }
  }

  // Run any style parser associated with the node's styles. Either
  // return an updated array of marks, or null to indicate some of the
  // styles had a rule with `ignore` set.
  readStyles(dom: HTMLElement, marks: ReadonlyArray<Mark>): ReadonlyArray<Mark> | null {
    const styles = dom.style
    // Because many properties will only show up in 'normalized' form
    // in `style.item` (i.e. text-decoration becomes
    // text-decoration-line, text-decoration-color, etc), we directly
    // query the styles mentioned in our rules instead of iterating
    // over the items.
    if (styles && styles.length) {
      for (let i = 0; i < this.parser.matchedStyles.length; i++) {
        const name = this.parser.matchedStyles[i]!,
          value = styles.getPropertyValue(name)
        if (value) {
          for (let after: StyleParseRule | undefined = undefined; ;) {
            const rule = this.parser.matchStyleOrNull(name, value, this, after)
            if (!rule) break
            if (rule.ignore) return null
            if (rule.clearMark) marks = marks.filter((m) => !rule.clearMark!(m))
            else marks = marks.concat(markType(this.parser.schema, rule.mark).createUnsafe(rule.attrs))
            if (rule.consuming === false) after = rule
            else break
          }
        }
      }
    }
    return marks
  }

  // Look up a handler for the given node. If none are found, return
  // false. Otherwise, apply it, use its return value to drive the way
  // the node's content is wrapped, and return true.
  addElementByRule(dom: HTMLElement, rule: TagParseRule, marks: ReadonlyArray<Mark>, continueAfter?: TagParseRule) {
    let sync = false,
      nodeType: NodeType | undefined
    if (rule.node) {
      nodeType = (this.parser.schema as AnySchema).nodeType(rule.node)
      if (!nodeType.isLeaf) {
        const inner = this.enter(nodeType, rule.attrs || null, marks, rule.preserveWhitespace)
        if (inner) {
          sync = true
          marks = inner
        }
      } else if (!this.insertNode(nodeType.createUnsafe(rule.attrs), marks, dom.nodeName == "BR")) {
        this.leafFallback(dom, marks)
      }
    } else {
      marks = marks.concat(markType(this.parser.schema, rule.mark).createUnsafe(rule.attrs))
    }
    const startIn = this.top

    if (nodeType && nodeType.isLeaf) {
      this.findInside(dom)
    } else if (continueAfter) {
      this.addElement(dom, marks, continueAfter)
    } else if (rule.getContent) {
      this.findInside(dom)
      rule.getContent(dom, this.parser.schema).forEach((node) => this.insertNode(node, marks, false))
    } else {
      let contentDOM = dom
      if (typeof rule.contentElement == "string") contentDOM = dom.querySelector(rule.contentElement)!
      else if (typeof rule.contentElement == "function") contentDOM = rule.contentElement(dom)
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
    let index = startIndex || 0
    for (
      let dom: globalThis.Node | null = startIndex ? parent.childNodes[startIndex]! : parent.firstChild,
        end = endIndex == null ? null : parent.childNodes[endIndex];
      dom != end;
      dom = dom!.nextSibling, ++index
    ) {
      this.findAtPoint(parent, index)
      this.addDOM(dom!, marks)
    }
    this.findAtPoint(parent, index)
  }

  // Try to find a way to fit the given node type into the current
  // context. May add intermediate wrappers and/or leave non-solid
  // nodes that we're in.
  findPlace(node: Node, marks: ReadonlyArray<Mark>, cautious: boolean): ReadonlyArray<Mark> | null {
    let route: ReadonlyArray<NodeType> | undefined, sync: NodeContext | undefined
    for (let depth = this.open, penalty = 0; depth >= 0; depth--) {
      const cx = this.nodes[depth]!
      const found = cx.findWrapping(node)
      if (found && (!route || route.length > found.length + penalty)) {
        route = found
        sync = cx
        if (!found.length) break
      }
      if (cx.solid) {
        if (cautious) break
        penalty += 2
      }
    }
    if (!route) return null
    this.sync(sync!)
    for (let i = 0; i < route.length; i++) marks = this.enterInner(route[i]!, null, marks, false)
    return marks
  }

  // Try to insert the given node, adjusting the context when needed.
  insertNode(node: Node, marks: ReadonlyArray<Mark>, cautious: boolean): boolean {
    if (node.isInline && this.needsBlock && !this.top.type) {
      const block = this.textblockFromContext()
      if (block) marks = this.enterInner(block, null, marks)
    }
    const innerMarks = this.findPlace(node, marks, cautious)
    if (innerMarks) {
      this.closeExtra()
      const top = this.top
      if (top.match) top.match = top.match.matchTypeOrNull(node.type)
      let nodeMarks: ReadonlyArray<Mark> = Mark.none
      for (const m of innerMarks.concat(node.marks)) {
        if (top.type ? top.type.allowsMarkType(m.type) : markMayApply(m.type, node.type)) {
          nodeMarks = m.addToSet(nodeMarks)
        }
      }
      top.content.push(node.mark(nodeMarks))
      return true
    }
    return false
  }

  // Try to start a node of the given type, adjusting the context when
  // necessary.
  enter(
    type: NodeType,
    attrs: Attrs | null,
    marks: ReadonlyArray<Mark>,
    preserveWS?: boolean | "full"
  ): ReadonlyArray<Mark> | null {
    let innerMarks = this.findPlace(type.createUnsafe(attrs), marks, false)
    if (innerMarks) innerMarks = this.enterInner(type, attrs, marks, true, preserveWS)
    return innerMarks
  }

  // Open a node of the given type
  enterInner(
    type: NodeType,
    attrs: Attrs | null,
    marks: ReadonlyArray<Mark>,
    solid: boolean = false,
    preserveWS?: boolean | "full"
  ): ReadonlyArray<Mark> {
    this.closeExtra()
    const top = this.top
    top.match = top.match && top.match.matchTypeOrNull(type)
    let options = wsOptionsFor(type, preserveWS, top.options)
    if (top.options & OPT_OPEN_LEFT && top.content.length == 0) options |= OPT_OPEN_LEFT
    let applyMarks: ReadonlyArray<Mark> = Mark.none
    marks = marks.filter((m) => {
      if (top.type ? top.type.allowsMarkType(m.type) : markMayApply(m.type, type)) {
        applyMarks = m.addToSet(applyMarks)
        return false
      }
      return true
    })
    this.nodes.push(new NodeContext(type, attrs, applyMarks, solid, null, options))
    this.open++
    return marks
  }

  // Make sure all nodes above this.open are finished and added to
  // their parents
  closeExtra(openEnd = false) {
    let i = this.nodes.length - 1
    if (i > this.open) {
      for (; i > this.open; i--) this.nodes[i - 1]!.content.push(this.nodes[i]!.finish(openEnd) as Node)
      this.nodes.length = this.open + 1
    }
  }

  finish(): Node | Fragment {
    this.open = 0
    this.closeExtra(this.isOpen)
    return this.nodes[0]!.finish(!!(this.isOpen || this.options.topOpen))
  }

  sync(to: NodeContext): boolean {
    for (let i = this.open; i >= 0; i--) {
      if (this.nodes[i] == to) {
        this.open = i
        return true
      } else if (this.localPreserveWS) {
        this.nodes[i]!.options |= OPT_PRESERVE_WS
      }
    }
    return false
  }

  get currentPos(): number {
    this.closeExtra()
    let pos = 0
    for (let i = this.open; i >= 0; i--) {
      const content = this.nodes[i]!.content
      for (let j = content.length - 1; j >= 0; j--) pos += content[j]!.nodeSize
      if (i) pos++
    }
    return pos
  }

  findAtPoint(parent: globalThis.Node, offset: number) {
    if (this.find) {
      for (let i = 0; i < this.find.length; i++) {
        if (this.find[i]!.node == parent && this.find[i]!.offset == offset) this.find[i]!.pos = this.currentPos
      }
    }
  }

  findInside(parent: globalThis.Node) {
    if (this.find) {
      for (let i = 0; i < this.find.length; i++) {
        if (this.find[i]!.pos == null && parent.nodeType == 1 && parent.contains(this.find[i]!.node)) {
          this.find[i]!.pos = this.currentPos
        }
      }
    }
  }

  findAround(parent: globalThis.Node, content: globalThis.Node, before: boolean) {
    if (parent != content && this.find) {
      for (let i = 0; i < this.find.length; i++) {
        if (this.find[i]!.pos == null && parent.nodeType == 1 && parent.contains(this.find[i]!.node)) {
          const pos = content.compareDocumentPosition(this.find[i]!.node)
          if (pos & (before ? 2 : 4)) this.find[i]!.pos = this.currentPos
        }
      }
    }
  }

  findInText(textNode: Text) {
    if (this.find) {
      for (let i = 0; i < this.find.length; i++) {
        if (this.find[i]!.node == textNode) {
          this.find[i]!.pos = this.currentPos - (textNode.nodeValue!.length - this.find[i]!.offset)
        }
      }
    }
  }

  // Determines whether the given context string matches this context.
  matchesContext(context: string): boolean {
    if (context.indexOf("|") > -1) return context.split(/\s*\|\s*/).some(this.matchesContext, this)

    const parts = context.split("/")
    const option = this.options.context
    const useRoot = !this.isOpen && (!option || option.parent.type == this.nodes[0]!.type)
    const minDepth = -(option ? option.depth + 1 : 0) + (useRoot ? 0 : 1)
    const match = (i: number, depth: number): boolean => {
      for (; i >= 0; i--) {
        const part = parts[i]!
        if (part == "") {
          if (i == parts.length - 1 || i == 0) continue
          for (; depth >= minDepth; depth--) if (match(i - 1, depth)) return true
          return false
        } else {
          const next =
            depth > 0 || (depth == 0 && useRoot)
              ? this.nodes[depth]!.type
              : option && depth >= minDepth
                ? option.node(depth - minDepth).type
                : null
          if (!next || (next.name != part && !next.isInGroup(part))) return false
          depth--
        }
      }
      return true
    }
    return match(parts.length - 1, this.open)
  }

  textblockFromContext(): NodeType | undefined {
    const $context = this.options.context
    if ($context) {
      for (let d = $context.depth; d >= 0; d--) {
        const deflt = $context.node(d).contentMatchAtUnsafe($context.indexAfter(d)).defaultTypeOrNull
        if (deflt && deflt.isTextblock && deflt.defaultAttrs) return deflt
      }
    }
    const nodes = (this.parser.schema as AnySchema).nodes
    for (const name in nodes) {
      const type = nodes[name]!
      if (type.isTextblock && type.defaultAttrs) return type
    }
    return undefined
  }
}

function markType(schema: AnySchema, name: string | undefined): MarkType {
  const type = name === undefined ? undefined : schema.marks[name]
  if (!type) throw new SchemaDefinitionError({ message: `Parse rule refers to unknown mark type ${String(name)}` })
  return type
}

// Kludge to work around directly nested list nodes produced by some
// tools and allowed by browsers to mean that the nested list is
// actually part of the list item above it.
function normalizeList(dom: globalThis.Node) {
  for (let child = dom.firstChild, prevItem: ChildNode | null = null; child; child = child.nextSibling) {
    const name = child.nodeType == 1 ? child.nodeName.toLowerCase() : null
    if (name && hasOwn(listTags, name) && prevItem) {
      prevItem.appendChild(child)
      child = prevItem
    } else if (name == "li") {
      prevItem = child
    } else if (name) {
      prevItem = null
    }
  }
}

// Apply a CSS selector.
function matches(dom: any, selector: string): boolean {
  const f = dom.matches || dom.msMatchesSelector || dom.webkitMatchesSelector || dom.mozMatchesSelector
  return !!f && f.call(dom, selector)
}

// Used when finding a mark at the top level of a fragment parse.
// Checks whether it would be reasonable to apply a given mark type to
// a given node, by looking at the way the mark occurs in the schema.
function markMayApply(markType: MarkType, nodeType: NodeType): boolean {
  const nodes = nodeType.schema.nodes
  for (const name in nodes) {
    const parent = nodes[name]!
    if (!parent.allowsMarkType(markType)) continue
    const seen: Array<ContentMatch> = []
    const scan = (match: ContentMatch): boolean => {
      seen.push(match)
      for (let i = 0; i < match.next.length; i++) {
        const { next, type } = match.next[i]!
        if (type == nodeType) return true
        if (seen.indexOf(next) < 0 && scan(next)) return true
      }
      return false
    }
    if (scan(parent.contentMatch)) return true
  }
  return false
}
