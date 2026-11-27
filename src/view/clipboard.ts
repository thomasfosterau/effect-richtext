// Ported from prosemirror-view (MIT, Marijn Haverbeke and others)
/**
 * Clipboard serialization and parsing.
 *
 * @internal
 */
import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import { DOMParser, DOMSerializer, Fragment, type Node, type NodeType, type ResolvedPos, Slice } from "../Model.ts"
import { parseJson, stringifyJson } from "../internal/json.ts"
import * as browser from "./browser.ts"
import { isElt } from "./dom.ts"
import { ViewError } from "./errors.ts"
import type { ClipboardSerialization, EditorView } from "./view.ts"

type AnyView = EditorView<any, any, any>

/** @internal */
export function serializeForClipboard(view: AnyView, slice: Slice<any>): ClipboardSerialization<any> {
  view.someProp("transformCopied", (f) => {
    slice = f(slice, view)
  })

  const context: Array<unknown> = []
  // Move single open parents into the context, outermost first.
  const unwrap = (inner: Slice<any>): Slice<any> => {
    const { content, openEnd, openStart } = inner
    if (!(openStart > 1 && openEnd > 1 && content.childCount == 1 && content.content[0].childCount == 1)) return inner
    const node = content.content[0]
    context.push(
      node.type.name,
      Option.exists(node.type.defaultAttrs, (defaults) => defaults === node.attrs) ? null : node.attrs
    )
    return unwrap(new Slice(node.content, openStart - 1, openEnd - 1))
  }
  const { content, openEnd, openStart } = unwrap(slice)

  const serializer = Option.getOrElse(view.someProp("clipboardSerializer"), () =>
    DOMSerializer.fromSchema(view.state.schema)
  )
  const doc = detachedDoc(),
    wrap = doc.createElement("div")
  wrap.appendChild(serializer.serializeFragment(content, { document: doc }))

  // Wrap content that needs a parent to parse (table rows and the like),
  // returning how many wrappers were added.
  const addWrappers = (added: number): number => {
    const first = wrap.firstChild
    const needsWrap = first && first.nodeType == 1 ? wrapFor(wrapMap, first.nodeName.toLowerCase()) : undefined
    if (!needsWrap) return added
    Arr.reverse(needsWrap).forEach((name) => {
      const wrapper = doc.createElement(name)
      wrapper.append(...Array.from(wrap.childNodes))
      wrap.appendChild(wrapper)
    })
    return addWrappers(added + needsWrap.length)
  }
  const wrappers = addWrappers(0),
    firstChild = wrap.firstChild

  if (firstChild && isElt(firstChild)) {
    firstChild.setAttribute(
      "data-pm-slice",
      `${openStart} ${openEnd}${wrappers ? ` -${wrappers}` : ""} ${Option.getOrElse(stringifyJson(context), () => "[]")}`
    )
  }

  const text = Option.getOrElse(
    view.someProp("clipboardTextSerializer", (f) => f(slice, view)),
    () => slice.content.textBetween(0, slice.content.size, "\n\n")
  )

  return { dom: wrap, text, slice }
}

// Read a slice of content from the clipboard (or drop data). `html` is
// empty when there is none.
/** @internal */
export function parseFromClipboard(
  view: AnyView,
  text: string,
  html: string,
  plainText: boolean,
  $context: ResolvedPos<any>
): Option.Option<Slice<any>> {
  const inCode = $context.parent.type.spec.code
  let dom: Option.Option<HTMLElement> = Option.none(),
    parsed: Option.Option<Slice<any>> = Option.none()
  if (!html && !text) return Option.none()
  const asText = !!text && (plainText || inCode || !html)
  if (asText) {
    view.someProp("transformPastedText", (f) => {
      text = f(text, inCode || plainText, view)
    })
    if (inCode) {
      let codeSlice: Slice<any> = new Slice(
        Fragment.from(view.state.schema.textUnsafe(text.replace(/\r\n?/g, "\n"))),
        0,
        0
      )
      view.someProp("transformPasted", (f) => {
        codeSlice = f(codeSlice, view, true)
      })
      return Option.some(codeSlice)
    }
    // Read as values, so that a parser returning `None` defers to the next one.
    parsed = Option.flatMap(
      view.someProp("clipboardTextParser", (f) => Option.getOrUndefined(f(text, $context, plainText, view))),
      Option.fromUndefinedOr
    )
    if (Option.isNone(parsed)) {
      const marks = $context.marks()
      const { schema } = view.state,
        serializer = DOMSerializer.fromSchema(schema)
      const div = document.createElement("div")
      dom = Option.some(div)
      text.split(/(?:\r\n?|\n)+/).forEach((block) => {
        const p = div.appendChild(document.createElement("p"))
        if (block) p.appendChild(serializer.serializeNode(schema.textUnsafe(block, marks)))
      })
    }
  } else if (html) {
    let source = html
    view.someProp("transformPastedHTML", (f) => {
      source = f(source, view)
    })
    const read = readHTML(source)
    if (browser.webkit) restoreReplacedSpaces(read)
    dom = Option.some(read)
  }

  const contextNode = Option.flatMap(dom, (d) => Option.fromNullOr(d.querySelector("[data-pm-slice]")))
  const sliceData = Option.flatMap(contextNode, (node) =>
    Option.fromNullOr(/^(\d+) (\d+)(?: -(\d+))? (.*)/.exec(node.getAttribute("data-pm-slice") || ""))
  )
  if (Option.isSome(dom) && Option.isSome(sliceData) && sliceData.value[3]) {
    dom = Option.some(intoFirstElement(dom.value, +sliceData.value[3]))
  }

  let slice: Slice<any>
  if (Option.isSome(parsed)) {
    slice = parsed.value
  } else {
    if (Option.isNone(dom)) return Option.none()
    const parser = Option.getOrElse(
      Option.orElse(view.someProp("clipboardParser"), () => view.someProp("domParser")),
      () => DOMParser.fromSchema(view.state.schema)
    )
    slice = parser.parseSliceUnsafe(dom.value, {
      preserveWhitespace: asText || Option.isSome(sliceData),
      context: $context,
      ruleFromNode(el) {
        if (el.nodeName == "BR" && !el.nextSibling && el.parentNode && !inlineParents.test(el.parentNode.nodeName))
          return Option.some({ ignore: true })
        return Option.none()
      }
    })
  }
  if (Option.isSome(sliceData)) {
    const data = sliceData.value
    slice = addContext(closeSlice(slice, +data[1], +data[2]), data[4])
  } else {
    // HTML wasn't created by ProseMirror. Make sure top-level siblings are coherent
    slice = Slice.maxOpen(normalizeSiblings(slice.content, $context), true)
    if (slice.openStart || slice.openEnd) {
      const openStart = openBelowIsolating(slice.content, slice.openStart, false),
        openEnd = openBelowIsolating(slice.content, slice.openEnd, true)
      slice = closeSlice(slice, openStart, openEnd)
    }
  }

  let pasted: Slice<any> = slice
  view.someProp("transformPasted", (f) => {
    pasted = f(pasted, view, asText)
  })
  return Option.some(pasted)
}

const inlineParents =
  /^(a|abbr|acronym|b|cite|code|del|em|i|ins|kbd|label|output|q|ruby|s|samp|span|strong|sub|sup|time|u|tt|var)$/i

// Takes a slice parsed with parseSlice, which means there hasn't been
// any content-expression checking done on the top nodes, tries to
// find a parent node in the current context that might fit the nodes,
// and if successful, rebuilds the slice so that it fits into that parent.
//
// This addresses the problem that Transform.replace expects a
// coherent slice, and will fail to place a set of siblings that don't
// fit anywhere in the schema.
// Descend `n` levels into first child elements, stopping at a non-element.
function intoFirstElement(dom: HTMLElement, n: number): HTMLElement {
  const first = dom.firstElementChild
  return n > 0 && first && isElt(first) ? intoFirstElement(first, n - 1) : dom
}

// How many levels, up to `limit`, a fragment's first (last) edge can stay
// open before an isolating node.
function openBelowIsolating(fragment: Fragment<any, any>, limit: number, last: boolean): number {
  const node = fragment.content[last ? fragment.childCount - 1 : 0]
  return limit <= 0 || node.type.spec.isolating ? 0 : 1 + openBelowIsolating(node.content, limit - 1, last)
}

function normalizeSiblings(fragment: Fragment<any, any>, $context: ResolvedPos<any>) {
  if (fragment.childCount < 2) return fragment
  const normalized = Arr.findFirst(Arr.reverse(Arr.range(0, $context.depth)), (d) => {
    const parent = $context.node(d)
    let match = parent.contentMatchAtUnsafe($context.index(d))
    let lastWrap: ReadonlyArray<NodeType<any, any>> = [],
      failed = false
    const result: Array<Node<any, any>> = []
    fragment.forEach((node) => {
      if (failed) return
      const wrapFound = match.findWrapping(node.type)
      if (Option.isNone(wrapFound)) {
        failed = true
        return
      }
      const wrap = wrapFound.value
      const inLast =
        result.length && lastWrap.length
          ? addToSibling(wrap, lastWrap, node, result[result.length - 1], 0)
          : Option.none()
      if (Option.isSome(inLast)) {
        result[result.length - 1] = inLast.value
      } else {
        if (result.length) result[result.length - 1] = closeRight(result[result.length - 1], lastWrap.length)
        const wrapped = withWrappers(node, wrap)
        result.push(wrapped)
        const next = match.matchType(wrapped.type)
        if (Option.isNone(next)) {
          failed = true
          return
        }
        match = next.value
        lastWrap = wrap
      }
    })
    return failed ? Option.none() : Option.some(Fragment.from(result))
  })
  return Option.getOrElse(normalized, () => fragment)
}

function withWrappers(node: Node<any, any>, wrap: ReadonlyArray<NodeType<any, any>>, from = 0) {
  return wrap.slice(from).reduceRight((inner, type) => type.createUnsafe(undefined, Fragment.from(inner)), node)
}

// Used to group adjacent nodes wrapped in similar parents by
// normalizeSiblings into the same parent node
function addToSibling(
  wrap: ReadonlyArray<NodeType<any, any>>,
  lastWrap: ReadonlyArray<NodeType<any, any>>,
  node: Node<any, any>,
  sibling: Node<any, any>,
  depth: number
): Option.Option<Node<any, any>> {
  if (depth < wrap.length && depth < lastWrap.length && wrap[depth] == lastWrap[depth]) {
    const inner = addToSibling(wrap, lastWrap, node, sibling.content.content[sibling.childCount - 1], depth + 1)
    if (Option.isSome(inner))
      return Option.some(sibling.copy(sibling.content.replaceChild(sibling.childCount - 1, inner.value)))
    const match = sibling.contentMatchAtUnsafe(sibling.childCount)
    if (Option.isSome(match.matchType(depth == wrap.length - 1 ? node.type : wrap[depth + 1]))) {
      return Option.some(sibling.copy(sibling.content.append(Fragment.from(withWrappers(node, wrap, depth + 1)))))
    }
  }
  return Option.none()
}

function closeRight(node: Node<any, any>, depth: number): Node<any, any> {
  if (depth == 0) return node
  const fragment = node.content.replaceChild(
    node.childCount - 1,
    closeRight(node.content.content[node.childCount - 1], depth - 1)
  )
  return node.copy(fragment.append(fillToEnd(node)))
}

// The content that closes `node` after its last child.
function fillToEnd(node: Node<any, any>): Fragment<any, any> {
  const fill = node.contentMatchAtUnsafe(node.childCount).fillBefore(Fragment.empty, true)
  if (Option.isNone(fill)) throw new ViewError({ message: "Can't complete the content of " + node.type.name })
  return fill.value
}

function closeRange(
  fragment: Fragment<any, any>,
  side: number,
  from: number,
  to: number,
  depth: number,
  openEnd: number
): Fragment<any, any> {
  const node = side < 0 ? fragment.content[0] : fragment.content[fragment.childCount - 1]
  let inner = node.content
  if (fragment.childCount > 1) openEnd = 0
  if (depth < to - 1) inner = closeRange(inner, side, from, to, depth + 1, openEnd)
  if (depth >= from) {
    if (side < 0) {
      const before = node.contentMatchAtUnsafe(0).fillBefore(inner, openEnd <= depth)
      if (Option.isNone(before)) throw new ViewError({ message: "Can't open the start of " + node.type.name })
      inner = before.value.append(inner)
    } else {
      inner = inner.append(fillToEnd(node))
    }
  }
  return fragment.replaceChild(side < 0 ? 0 : fragment.childCount - 1, node.copy(inner))
}

function closeSlice(slice: Slice<any>, openStart: number, openEnd: number) {
  if (openStart < slice.openStart) {
    slice = new Slice(
      closeRange(slice.content, -1, openStart, slice.openStart, 0, slice.openEnd),
      openStart,
      slice.openEnd
    )
  }
  if (openEnd < slice.openEnd) {
    slice = new Slice(closeRange(slice.content, 1, openEnd, slice.openEnd, 0, 0), slice.openStart, openEnd)
  }
  return slice
}

// Trick from jQuery -- some elements must be wrapped in other
// elements for innerHTML to work. I.e. if you do `div.innerHTML =
// "<td>..</td>"` the table cells are ignored.
type WrapTable = { readonly [node: string]: ReadonlyArray<string> }

const wrapFor = (table: WrapTable, node: string) => table[node]

const wrapMap = {
  thead: ["table"],
  tbody: ["table"],
  tfoot: ["table"],
  caption: ["table"],
  colgroup: ["table"],
  col: ["table", "colgroup"],
  tr: ["table", "tbody"],
  td: ["table", "tbody", "tr"],
  th: ["table", "tbody", "tr"]
} satisfies WrapTable

// A fresh document per read, so style sheets from earlier pastes don't
// apply to later ones (prosemirror-view 1.42.0).
function detachedDoc() {
  return document.implementation.createHTMLDocument("title")
}

let _policy: any = null

function maybeWrapTrusted(html: string): string {
  const win: Window & { readonly trustedTypes?: any } = window
  const trustedTypes = win.trustedTypes
  if (!trustedTypes) return html
  // With the require-trusted-types-for CSP, Chrome will block
  // innerHTML, even on a detached document. This wraps the string in
  // a way that makes the browser allow us to use its parser again.
  if (!_policy) {
    // A default policy may lack `createHTML`; use our own policy then
    // (prosemirror-view 1.42.3).
    const fallback = trustedTypes.defaultPolicy
    _policy =
      fallback && Predicate.isFunction(fallback.createHTML)
        ? fallback
        : trustedTypes.createPolicy("ProseMirrorClipboard", { createHTML: (s: string) => s })
  }
  return _policy.createHTML(html)
}

function readHTML(html: string) {
  const metas = /^(\s*<meta [^>]*>)*/.exec(html)
  if (metas) html = html.slice(metas[0].length)
  const doc = detachedDoc()
  let elt: HTMLElement = doc.body
  const firstTag = /<([a-z][^>\s]+)/i.exec(html)
  let wrap
  if ((wrap = firstTag && wrapFor(wrapMap, firstTag[1].toLowerCase()))) {
    html =
      wrap.map((n) => "<" + n + ">").join("") +
      html +
      wrap
        .map((n) => "</" + n + ">")
        .reverse()
        .join("")
  }
  elt.innerHTML = maybeWrapTrusted(html)
  if (wrap) elt = wrap.reduce((inner, selector) => inner.querySelector<HTMLElement>(selector) || inner, elt)
  // Inline styles defined in the pasted content, so that parse rules
  // pick them up (prosemirror-view 1.42.0).
  const root = elt
  Array.from(doc.styleSheets).forEach((sheet) =>
    Array.from(sheet.cssRules).forEach((rule) => {
      if (rule instanceof CSSStyleRule) {
        root.querySelectorAll<HTMLElement>(rule.selectorText).forEach((match) => {
          match.style.cssText += rule.style.cssText
        })
      }
    })
  )
  return elt
}

// Webkit browsers do some hard-to-predict replacement of regular
// spaces with non-breaking spaces when putting content on the
// clipboard. This tries to convert such non-breaking spaces (which
// will be wrapped in a plain span on Chrome, a span with class
// Apple-converted-space on Safari) back to regular spaces.
function restoreReplacedSpaces(dom: HTMLElement) {
  const nodes = dom.querySelectorAll(browser.chrome ? "span:not([class]):not([style])" : "span.Apple-converted-space")
  nodes.forEach((node) => {
    if (node.childNodes.length == 1 && node.textContent == " " && node.parentNode) {
      node.parentNode.replaceChild(dom.ownerDocument.createTextNode(" "), node)
    }
  })
}

function addContext(slice: Slice<any>, context: string) {
  if (!slice.size) return slice
  const schema = slice.content.content[0].type.schema
  const array = Option.getOrUndefined(parseJson(context))
  if (!Array.isArray(array)) return slice
  // Wrap in the context's nodes, innermost (last) first.
  const wrapIn = (i: number, inner: Slice<any>): Slice<any> => {
    const type = i >= 0 ? schema.nodes[array[i]] : undefined
    if (!type || type.hasRequiredAttrs()) return inner
    // Context attributes come from the pasted HTML: stop wrapping at the
    // first node whose attributes the schema rejects (prosemirror-view
    // 1.42.3, an XSS fix).
    let content: Fragment<any>
    try {
      content = Fragment.from(type.createUnsafe(array[i + 1], inner.content))
    } catch {
      return inner
    }
    return wrapIn(i - 2, new Slice(content, inner.openStart + 1, inner.openEnd + 1))
  }
  return wrapIn(array.length - 2, slice)
}
