/**
 * Serializing documents to Markdown.
 *
 * @since 0.1.0
 */
// Ported from prosemirror-markdown (MIT, Marijn Haverbeke and others)
import * as Arr from "effect/Array"
import * as Order from "effect/Order"
import type { AnySchema, Attrs, Mark, Node, TextNode } from "../model.ts"
import { MarkdownError } from "./errors.ts"

/**
 * A function serializing a node to Markdown, by calling methods on the
 * serializer state.
 *
 * @since 0.1.0
 * @category models
 */
export type NodeSerializer<Sc extends AnySchema = AnySchema> = (
  state: MarkdownSerializerState<Sc>,
  node: Node<Sc, any>,
  parent: Node<Sc, any>,
  index: number
) => void

/**
 * Describes how to serialize a mark to Markdown.
 *
 * @since 0.1.0
 * @category models
 */
export interface MarkSerializerSpec<Sc extends AnySchema = AnySchema> {
  /**
   * The string that should appear before a piece of content marked by
   * this mark, either directly or as a function that returns an
   * appropriate string.
   */
  readonly open:
    | string
    | ((state: MarkdownSerializerState<Sc>, mark: Mark<Sc, any>, parent: Node<Sc, any>, index: number) => string)
  /** The string that should appear after a piece of content marked by this mark. */
  readonly close:
    | string
    | ((state: MarkdownSerializerState<Sc>, mark: Mark<Sc, any>, parent: Node<Sc, any>, index: number) => string)
  /**
   * When `true`, this indicates that the order in which the mark's
   * opening and closing syntax appears relative to other mixable marks
   * can be varied. (For example, you can say `**a *b***` and `*a **b***`,
   * but not `` `a *b*` ``.)
   */
  readonly mixable?: boolean | undefined
  /**
   * When enabled, causes the serializer to move enclosing whitespace
   * from inside the marks to outside the marks. This is necessary for
   * emphasis marks as CommonMark does not permit enclosing whitespace
   * inside emphasis marks, see:
   * http://spec.commonmark.org/0.26/#example-330
   */
  readonly expelEnclosingWhitespace?: boolean | undefined
  /**
   * Can be set to `false` to disable character escaping in a mark. A
   * non-escaping mark has to have the highest precedence (must always
   * be the innermost mark).
   */
  readonly escape?: boolean | undefined
}

/**
 * Options for a `MarkdownSerializer`.
 *
 * @since 0.1.0
 * @category models
 */
export interface MarkdownSerializerOptions {
  /**
   * Extra characters can be added for escaping. This is passed directly
   * to `String.replace()`, and the matching characters are preceded by
   * a backslash.
   */
  readonly escapeExtraCharacters?: RegExp | undefined
  /** Specify the node name of hard breaks. Defaults to `"hard_break"`. */
  readonly hardBreakNodeName?: string | undefined
  /**
   * By default, the serializer throws a `MarkdownError` when it finds a
   * node or mark type for which no serializer is defined. Set this to
   * `false` to make it just ignore such elements, rendering only their
   * content.
   */
  readonly strict?: boolean | undefined
}

/**
 * Options for `MarkdownSerializer.serialize`.
 *
 * @since 0.1.0
 * @category models
 */
export interface MarkdownSerializeOptions {
  /**
   * Whether to render lists in a tight style. This can be overridden on
   * a node level by specifying a tight attribute on the node. Defaults
   * to false.
   */
  readonly tightLists?: boolean | undefined
}

/**
 * The options available on a `MarkdownSerializerState`.
 *
 * @since 0.1.0
 * @category models
 */
export interface MarkdownSerializerStateOptions extends MarkdownSerializerOptions {
  readonly tightLists: boolean
  readonly hardBreakNodeName: string
}

const blankMark: MarkSerializerSpec<any> = { open: "", close: "", mixable: true }

/**
 * A specification for serializing a document as Markdown/CommonMark
 * text.
 *
 * @since 0.1.0
 * @category models
 */
export class MarkdownSerializer<Sc extends AnySchema = AnySchema> {
  /**
   * Construct a serializer with the given configuration. The `nodes`
   * object should map node names in a given schema to function that
   * take a serializer state and such a node, and serialize the node.
   */
  constructor(
    /** The node serializer functions for this serializer. */
    readonly nodes: { readonly [node: string]: NodeSerializer<Sc> },
    /** The mark serializer info. */
    readonly marks: { readonly [mark: string]: MarkSerializerSpec<Sc> },
    readonly options: MarkdownSerializerOptions = {}
  ) {}

  /**
   * Serialize the content of the given node to
   * [CommonMark](http://commonmark.org/).
   *
   * Serialization can't fail for nodes that the serializer knows; in
   * strict mode (the default) an unknown node or mark type is a
   * programming error and throws a `MarkdownError`.
   */
  serialize(content: Node<Sc, any>, options: MarkdownSerializeOptions = {}): string {
    const state = new MarkdownSerializerState(this.nodes, this.marks, { ...this.options, ...options })
    state.renderContent(content)
    return state.out
  }
}

function backticksFor(node: Node<any, any>, side: number): string {
  const ticks = /`+/g
  let m: RegExpExecArray | null,
    len = 0
  if (node.isText) {
    while ((m = ticks.exec((node as TextNode<any>).text))) len = Math.max(len, m[0].length)
  }
  let result = len > 0 && side > 0 ? " `" : "`"
  for (let i = 0; i < len; i++) result += "`"
  if (len > 0 && side < 0) result += " "
  return result
}

function isPlainURL(link: Mark<any, any>, parent: Node<any, any>, index: number): boolean {
  if (link.attrs.title || !/^\w+:/.test(link.attrs.href)) return false
  const content = parent.childUnsafe(index)
  if (
    !content.isText ||
    (content as TextNode<any>).text != link.attrs.href ||
    content.marks[content.marks.length - 1] != link
  )
    return false
  return index == parent.childCount - 1 || !link.isInSet(parent.childUnsafe(index + 1).marks)
}

/**
 * A serializer for the Markdown schema (or any schema using the same
 * node and mark names).
 *
 * @since 0.1.0
 * @category serializers
 */
export const defaultMarkdownSerializer: MarkdownSerializer = new MarkdownSerializer(
  {
    blockquote(state, node) {
      state.wrapBlock("> ", null, node, () => state.renderContent(node))
    },
    code_block(state, node) {
      // Make sure the front matter fences are longer than any dash sequence within it
      const backticks = node.textContent.match(/`{3,}/gm)
      const fence = backticks ? Arr.sort(backticks, Order.String).slice(-1)[0] + "`" : "```"

      state.write(fence + (node.attrs.params || "") + "\n")
      state.text(node.textContent, false)
      // Add a newline to the current content before adding closing marker
      state.write("\n")
      state.write(fence)
      state.closeBlock(node)
    },
    heading(state, node) {
      state.write(state.repeat("#", node.attrs.level) + " ")
      state.renderInline(node, false)
      state.closeBlock(node)
    },
    horizontal_rule(state, node) {
      state.write(node.attrs.markup || "---")
      state.closeBlock(node)
    },
    bullet_list(state, node) {
      state.renderList(node, "  ", () => (node.attrs.bullet || "*") + " ")
    },
    ordered_list(state, node) {
      const start = node.attrs.order || 1
      const maxW = String(start + node.childCount - 1).length
      const space = state.repeat(" ", maxW + 2)
      state.renderList(node, space, (i) => {
        const nStr = String(start + i)
        return state.repeat(" ", maxW - nStr.length) + nStr + ". "
      })
    },
    list_item(state, node) {
      state.renderContent(node)
    },
    paragraph(state, node) {
      state.renderInline(node)
      state.closeBlock(node)
    },

    image(state, node) {
      state.write(
        "![" +
          state.esc(node.attrs.alt || "") +
          "](" +
          node.attrs.src.replace(/[()]/g, "\\$&") +
          (node.attrs.title ? ' "' + node.attrs.title.replace(/"/g, '\\"') + '"' : "") +
          ")"
      )
    },
    hard_break(state, node, parent, index) {
      for (let i = index + 1; i < parent.childCount; i++) {
        if (parent.childUnsafe(i).type != node.type) {
          state.write("\\\n")
          return
        }
      }
    },
    text(state, node) {
      state.text((node as TextNode<any>).text, !state.inAutolink)
    }
  },
  {
    em: { open: "*", close: "*", mixable: true, expelEnclosingWhitespace: true },
    strong: { open: "**", close: "**", mixable: true, expelEnclosingWhitespace: true },
    link: {
      open(state, mark, parent, index) {
        state.inAutolink = isPlainURL(mark, parent, index)
        return state.inAutolink ? "<" : "["
      },
      close(state, mark) {
        const { inAutolink } = state
        state.inAutolink = undefined
        return inAutolink
          ? ">"
          : "](" +
              mark.attrs.href.replace(/[()"]/g, "\\$&") +
              (mark.attrs.title ? ` "${mark.attrs.title.replace(/"/g, '\\"')}"` : "") +
              ")"
      },
      mixable: true
    },
    code: {
      open(_state, _mark, parent, index) {
        return backticksFor(parent.childUnsafe(index), -1)
      },
      close(_state, _mark, parent, index) {
        return backticksFor(parent.childUnsafe(index - 1), 1)
      },
      escape: false
    }
  }
)

/**
 * This is an object used to track state and expose methods related to
 * markdown serialization. Instances are passed to node and mark
 * serialization methods.
 *
 * @since 0.1.0
 * @category models
 */
export class MarkdownSerializerState<Sc extends AnySchema = AnySchema> {
  /** @internal */
  delim: string = ""
  /** @internal */
  out: string = ""
  /** @internal */
  closed: Node<Sc, any> | null = null
  /** @internal */
  inAutolink: boolean | undefined = undefined
  /** @internal */
  atBlockStart: boolean = false
  /** @internal */
  inTightList: boolean = false

  /** The options passed to the serializer. */
  readonly options: MarkdownSerializerStateOptions

  /** @internal */
  constructor(
    /** @internal */
    readonly nodes: { readonly [node: string]: NodeSerializer<Sc> },
    /** @internal */
    readonly marks: { readonly [mark: string]: MarkSerializerSpec<Sc> },
    options: MarkdownSerializerOptions & MarkdownSerializeOptions
  ) {
    this.options = {
      ...options,
      tightLists: options.tightLists ?? false,
      hardBreakNodeName: options.hardBreakNodeName ?? "hard_break"
    }
  }

  /** @internal */
  flushClose(size: number = 2): void {
    if (this.closed) {
      if (!this.atBlank()) this.out += "\n"
      if (size > 1) {
        let delimMin = this.delim
        const trim = /\s+$/.exec(delimMin)
        if (trim) delimMin = delimMin.slice(0, delimMin.length - trim[0].length)
        for (let i = 1; i < size; i++) this.out += delimMin + "\n"
      }
      this.closed = null
    }
  }

  /** @internal */
  getMark(name: string): MarkSerializerSpec<Sc> {
    let info = this.marks[name]
    if (!info) {
      if (this.options.strict !== false) {
        throw new MarkdownError({ message: `Mark type \`${name}\` not supported by Markdown renderer` })
      }
      info = blankMark
    }
    return info
  }

  /**
   * Render a block, prefixing each line with `delim`, and the first line
   * in `firstDelim`. `node` should be the node that is closed at the end
   * of the block, and `f` is a function that renders the content of the
   * block.
   */
  wrapBlock(delim: string, firstDelim: string | null, node: Node<Sc, any>, f: () => void): void {
    const old = this.delim
    this.write(firstDelim != null ? firstDelim : delim)
    this.delim += delim
    f()
    this.delim = old
    this.closeBlock(node)
  }

  /** @internal */
  atBlank(): boolean {
    return /(^|\n)$/.test(this.out)
  }

  /** Ensure the current content ends with a newline. */
  ensureNewLine(): void {
    if (!this.atBlank()) this.out += "\n"
  }

  /**
   * Prepare the state for writing output (closing closed paragraphs,
   * adding delimiters, and so on), and then optionally add content
   * (unescaped) to the output.
   */
  write(content?: string): void {
    this.flushClose()
    if (this.delim && this.atBlank()) this.out += this.delim
    if (content) this.out += content
  }

  /** Close the block for the given node. */
  closeBlock(node: Node<Sc, any>): void {
    this.closed = node
  }

  /** Add the given text to the document. When escape is not `false`, it will be escaped. */
  text(text: string, escape = true): void {
    const lines = text.split("\n")
    for (let i = 0; i < lines.length; i++) {
      this.write()
      // Escape exclamation marks in front of links
      if (!escape && lines[i]![0] == "[" && /(^|[^\\])!$/.test(this.out)) {
        this.out = this.out.slice(0, this.out.length - 1) + "\\!"
      }
      this.out += escape ? this.esc(lines[i]!, this.atBlockStart) : lines[i]
      if (i != lines.length - 1) this.out += "\n"
    }
  }

  /**
   * Render the given node as a block. In strict mode, throws a
   * `MarkdownError` for node types without a serializer.
   */
  render(node: Node<Sc, any>, parent: Node<Sc, any>, index: number): void {
    const serializer = this.nodes[node.type.name]
    if (serializer) {
      serializer(this, node, parent, index)
    } else {
      if (this.options.strict !== false) {
        throw new MarkdownError({ message: "Token type `" + node.type.name + "` not supported by Markdown renderer" })
      } else if (!node.type.isLeaf) {
        if (node.type.inlineContent) this.renderInline(node)
        else this.renderContent(node)
        if (node.isBlock) this.closeBlock(node)
      }
    }
  }

  /** Render the contents of `parent` as block nodes. */
  renderContent(parent: Node<Sc, any>): void {
    parent.forEach((node, _, i) => this.render(node, parent, i))
  }

  /** Render the contents of `parent` as inline content. */
  renderInline(parent: Node<Sc, any>, fromBlockStart = true): void {
    this.atBlockStart = fromBlockStart
    const active: Array<Mark<Sc, any>> = []
    let trailing = ""
    const progress = (node: Node<Sc, any> | null, _offset: number, index: number) => {
      let marks: ReadonlyArray<Mark<Sc, any>> = node ? node.marks : []

      // Remove marks from `hard_break` that are the last node inside
      // that mark to prevent parser edge cases with new lines just
      // before closing marks.
      if (node && node.type.name === this.options.hardBreakNodeName) {
        marks = marks.filter((m) => {
          if (index + 1 == parent.childCount) return false
          const next = parent.childUnsafe(index + 1)
          return m.isInSet(next.marks) && (!next.isText || /\S/.test((next as TextNode<Sc>).text))
        })
      }

      let leading = trailing
      trailing = ""
      // If whitespace has to be expelled from the node, adjust
      // leading and trailing accordingly.
      if (
        node &&
        node.isText &&
        marks.some((mark) => {
          const info = this.getMark(mark.type.name)
          return info && info.expelEnclosingWhitespace && !mark.isInSet(active)
        })
      ) {
        const [_, lead, rest] = /^(\s*)(.*)$/m.exec((node as TextNode<Sc>).text)!
        if (lead) {
          leading += lead
          node = rest ? (node as TextNode<Sc>).withText(rest) : null
          if (!node) marks = active
        }
      }
      if (
        node &&
        node.isText &&
        marks.some((mark) => {
          const info = this.getMark(mark.type.name)
          return info && info.expelEnclosingWhitespace && !this.isMarkAhead(parent, index + 1, mark)
        })
      ) {
        const [_, rest, trail] = /^(.*?)(\s*)$/m.exec((node as TextNode<Sc>).text)!
        if (trail) {
          trailing = trail
          node = rest ? (node as TextNode<Sc>).withText(rest) : null
          if (!node) marks = active
        }
      }
      const inner = marks.length ? marks[marks.length - 1]! : null
      const noEsc = inner && this.getMark(inner.type.name).escape === false
      const len = marks.length - (noEsc ? 1 : 0)

      // Try to reorder 'mixable' marks, such as em and strong, which
      // in Markdown may be opened and closed in different order, so
      // that order of the marks for the token matches the order in
      // active.
      outer: for (let i = 0; i < len; i++) {
        const mark = marks[i]!
        if (!this.getMark(mark.type.name).mixable) break
        for (let j = 0; j < active.length; j++) {
          const other = active[j]!
          if (!this.getMark(other.type.name).mixable) break
          if (mark.eq(other)) {
            if (i > j) {
              marks = marks
                .slice(0, j)
                .concat(mark)
                .concat(marks.slice(j, i))
                .concat(marks.slice(i + 1, len))
            } else if (j > i) {
              marks = marks
                .slice(0, i)
                .concat(marks.slice(i + 1, j))
                .concat(mark)
                .concat(marks.slice(j, len))
            }
            continue outer
          }
        }
      }

      // Find the prefix of the mark set that didn't change
      let keep = 0
      while (keep < Math.min(active.length, len) && marks[keep]!.eq(active[keep]!)) ++keep

      // Close the marks that need to be closed
      while (keep < active.length) this.text(this.markString(active.pop()!, false, parent, index), false)

      // Output any previously expelled trailing whitespace outside the marks
      if (leading) this.text(leading)

      // Open the marks that need to be opened
      if (node) {
        while (active.length < len) {
          const add = marks[active.length]!
          active.push(add)
          this.text(this.markString(add, true, parent, index), false)
          this.atBlockStart = false
        }

        // Render the node. Special case code marks, since their content
        // may not be escaped.
        if (noEsc && node.isText) {
          this.text(
            this.markString(inner!, true, parent, index) +
              (node as TextNode<Sc>).text +
              this.markString(inner!, false, parent, index + 1),
            false
          )
        } else {
          this.render(node, parent, index)
        }
        this.atBlockStart = false
      }

      // After the first non-empty text node is rendered, the end of output
      // is no longer at block start.
      //
      // FIXME: If a non-text node writes something to the output for this
      // block, the end of output is also no longer at block start. But how
      // can we detect that?
      if (node?.isText && node.nodeSize > 0) {
        this.atBlockStart = false
      }
    }
    parent.forEach(progress)
    progress(null, 0, parent.childCount)
    this.atBlockStart = false
  }

  /**
   * Render a node's content as a list. `delim` should be the extra
   * indentation added to all lines except the first in an item,
   * `firstDelim` is a function going from an item index to a delimiter
   * for the first line of the item.
   */
  renderList(node: Node<Sc, any>, delim: string, firstDelim: (index: number) => string): void {
    if (this.closed && this.closed.type == node.type) this.flushClose(3)
    else if (this.inTightList) this.flushClose(1)

    const attrs: Attrs = node.attrs
    const isTight = typeof attrs.tight != "undefined" ? attrs.tight : this.options.tightLists
    const prevTight = this.inTightList
    this.inTightList = isTight
    node.forEach((child, _, i) => {
      if (i && isTight) this.flushClose(1)
      this.wrapBlock(delim, firstDelim(i), node, () => this.render(child, node, i))
    })
    this.inTightList = prevTight
  }

  /**
   * Escape the given string so that it can safely appear in Markdown
   * content. If `startOfLine` is true, also escape characters that have
   * special meaning only at the start of the line.
   */
  esc(str: string, startOfLine = false): string {
    str = str.replace(/[`*\\~[\]_]/g, (m, i) =>
      m == "_" && i > 0 && i + 1 < str.length && str[i - 1]!.match(/\w/) && str[i + 1]!.match(/\w/) ? m : "\\" + m
    )
    if (startOfLine) {
      str = str
        .replace(/^(\+[ ]|[-*>])/, "\\$&")
        .replace(/^(\s*)(#{1,6})(\s|$)/, "$1\\$2$3")
        .replace(/^(\s*\d+)\.\s/, "$1\\. ")
    }
    if (this.options.escapeExtraCharacters) str = str.replace(this.options.escapeExtraCharacters, "\\$&")
    return str
  }

  /** @internal */
  quote(str: string): string {
    const wrap = str.indexOf('"') == -1 ? '""' : str.indexOf("'") == -1 ? "''" : "()"
    return wrap[0] + str + wrap[1]
  }

  /** Repeat the given string `n` times. */
  repeat(str: string, n: number): string {
    let out = ""
    for (let i = 0; i < n; i++) out += str
    return out
  }

  /** Get the markdown string for a given opening or closing mark. */
  markString(mark: Mark<Sc, any>, open: boolean, parent: Node<Sc, any>, index: number): string {
    const info = this.getMark(mark.type.name)
    const value = open ? info.open : info.close
    return typeof value == "string" ? value : value(this, mark, parent, index)
  }

  /**
   * Get leading and trailing whitespace from a string. Values of leading
   * or trailing property of the return object will be undefined if there
   * is no match.
   */
  getEnclosingWhitespace(text: string): { leading?: string | undefined; trailing?: string | undefined } {
    return {
      leading: (text.match(/^(\s+)/) || [undefined])[0],
      trailing: (text.match(/(\s+)$/) || [undefined])[0]
    }
  }

  /** @internal */
  isMarkAhead(parent: Node<Sc, any>, index: number, mark: Mark<Sc, any>): boolean {
    for (; ; index++) {
      if (index >= parent.childCount) return false
      const next = parent.childUnsafe(index)
      if (next.type.name != this.options.hardBreakNodeName) return mark.isInSet(next.marks)
      index++
    }
  }
}
