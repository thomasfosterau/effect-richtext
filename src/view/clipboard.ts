// Ported from prosemirror-view (MIT, Marijn Haverbeke and others)
/**
 * Clipboard serialization and parsing.
 *
 * @internal
 */
import * as Option from "effect/Option"
import { DOMParser, DOMSerializer, Fragment, type Node, type NodeType, type ResolvedPos, Slice } from "../model.ts"
import { parseJson, stringifyJson } from "../internal/json.ts"
import * as browser from "./browser.ts"
import type { EditorView } from "./view.ts"

type AnyView = EditorView<any, any, any>

/** @internal */
export function serializeForClipboard(
  view: AnyView,
  slice: Slice<any>
): { dom: HTMLElement; text: string; slice: Slice<any> } {
  view.someProp("transformCopied", (f) => {
    slice = f(slice!, view)
  })

  const context: Array<unknown> = []
  let { content, openEnd, openStart } = slice
  while (openStart > 1 && openEnd > 1 && content.childCount == 1 && content.content[0]!.childCount == 1) {
    openStart--
    openEnd--
    const node = content.content[0]!
    context.push(node.type.name, node.attrs != node.type.defaultAttrs ? node.attrs : null)
    content = node.content
  }

  const serializer = view.someProp("clipboardSerializer") || DOMSerializer.fromSchema(view.state.schema)
  const doc = detachedDoc(),
    wrap = doc.createElement("div")
  wrap.appendChild(serializer.serializeFragment(content, { document: doc }))

  let firstChild = wrap.firstChild,
    needsWrap,
    wrappers = 0
  while (firstChild && firstChild.nodeType == 1 && (needsWrap = wrapMap[firstChild.nodeName.toLowerCase()])) {
    for (let i = needsWrap.length - 1; i >= 0; i--) {
      const wrapper = doc.createElement(needsWrap[i]!)
      while (wrap.firstChild) wrapper.appendChild(wrap.firstChild)
      wrap.appendChild(wrapper)
      wrappers++
    }
    firstChild = wrap.firstChild
  }

  if (firstChild && firstChild.nodeType == 1) {
    ;(firstChild as HTMLElement).setAttribute(
      "data-pm-slice",
      `${openStart} ${openEnd}${wrappers ? ` -${wrappers}` : ""} ${Option.getOrElse(stringifyJson(context), () => "[]")}`
    )
  }

  const text =
    view.someProp("clipboardTextSerializer", (f) => f(slice, view)) ||
    slice.content.textBetween(0, slice.content.size, "\n\n")

  return { dom: wrap, text, slice }
}

// Read a slice of content from the clipboard (or drop data).
/** @internal */
export function parseFromClipboard(
  view: AnyView,
  text: string,
  html: string | null,
  plainText: boolean,
  $context: ResolvedPos<any>
): Slice<any> | null {
  const inCode = $context.parent.type.spec.code
  let dom: HTMLElement | undefined, slice: Slice<any> | undefined
  if (!html && !text) return null
  const asText = !!text && (plainText || inCode || !html)
  if (asText) {
    view.someProp("transformPastedText", (f) => {
      text = f(text, !!(inCode || plainText), view)
    })
    if (inCode) {
      slice = new Slice(Fragment.from(view.state.schema.textUnsafe(text.replace(/\r\n?/g, "\n"))), 0, 0)
      view.someProp("transformPasted", (f) => {
        slice = f(slice!, view, true)
      })
      return slice
    }
    const parsed = view.someProp("clipboardTextParser", (f) => f(text, $context, plainText, view))
    if (parsed) {
      slice = parsed
    } else {
      const marks = $context.marks()
      const { schema } = view.state,
        serializer = DOMSerializer.fromSchema(schema)
      dom = document.createElement("div")
      text.split(/(?:\r\n?|\n)+/).forEach((block) => {
        const p = dom!.appendChild(document.createElement("p"))
        if (block) p.appendChild(serializer.serializeNode(schema.textUnsafe(block, marks)))
      })
    }
  } else {
    view.someProp("transformPastedHTML", (f) => {
      html = f(html!, view)
    })
    dom = readHTML(html!)
    if (browser.webkit) restoreReplacedSpaces(dom)
  }

  const contextNode = dom && dom.querySelector("[data-pm-slice]")
  const sliceData = contextNode && /^(\d+) (\d+)(?: -(\d+))? (.*)/.exec(contextNode.getAttribute("data-pm-slice") || "")
  if (sliceData && sliceData[3]) {
    for (let i = +sliceData[3]; i > 0; i--) {
      let child = dom!.firstChild
      while (child && child.nodeType != 1) child = child.nextSibling
      if (!child) break
      dom = child as HTMLElement
    }
  }

  if (!slice) {
    const parser =
      view.someProp("clipboardParser") || view.someProp("domParser") || DOMParser.fromSchema(view.state.schema)
    slice = parser.parseSliceUnsafe(dom!, {
      preserveWhitespace: !!(asText || sliceData),
      context: $context,
      ruleFromNode(dom) {
        if (dom.nodeName == "BR" && !dom.nextSibling && dom.parentNode && !inlineParents.test(dom.parentNode.nodeName))
          return { ignore: true }
        return null
      }
    })
  }
  if (sliceData) {
    slice = addContext(closeSlice(slice, +sliceData[1]!, +sliceData[2]!), sliceData[4]!)
  } else {
    // HTML wasn't created by ProseMirror. Make sure top-level siblings are coherent
    slice = Slice.maxOpen(normalizeSiblings(slice.content, $context), true)
    if (slice.openStart || slice.openEnd) {
      let openStart = 0,
        openEnd = 0
      for (
        let node = slice.content.content[0];
        openStart < slice.openStart && !node!.type.spec.isolating;
        openStart++, node = node!.content.content[0]
      ) {
        // empty
      }
      for (
        let node = slice.content.content[slice.content.childCount - 1];
        openEnd < slice.openEnd && !node!.type.spec.isolating;
        openEnd++, node = node!.content.content[node!.childCount - 1]
      ) {
        // empty
      }
      slice = closeSlice(slice, openStart, openEnd)
    }
  }

  view.someProp("transformPasted", (f) => {
    slice = f(slice!, view, asText)
  })
  return slice
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
function normalizeSiblings(fragment: Fragment<any, any>, $context: ResolvedPos<any>) {
  if (fragment.childCount < 2) return fragment
  for (let d = $context.depth; d >= 0; d--) {
    const parent = $context.node(d)
    let match = parent.contentMatchAtUnsafe($context.index(d))
    let lastWrap: ReadonlyArray<NodeType<any, any>> | undefined,
      result: Array<Node<any, any>> | null = []
    fragment.forEach((node) => {
      if (!result) return
      const wrap = match.findWrappingOrNull(node.type)
      let inLast
      if (!wrap) return (result = null)
      if (
        (inLast =
          result.length && lastWrap!.length && addToSibling(wrap, lastWrap!, node, result[result.length - 1]!, 0))
      ) {
        result[result.length - 1] = inLast
      } else {
        if (result.length) result[result.length - 1] = closeRight(result[result.length - 1]!, lastWrap!.length)
        const wrapped = withWrappers(node, wrap)
        result.push(wrapped)
        match = match.matchTypeOrNull(wrapped.type)!
        lastWrap = wrap
      }
      return undefined
    })
    if (result) return Fragment.from(result as Array<Node<any, any>>)
  }
  return fragment
}

function withWrappers(node: Node<any, any>, wrap: ReadonlyArray<NodeType<any, any>>, from = 0) {
  for (let i = wrap.length - 1; i >= from; i--) {
    node = wrap[i]!.createUnsafe(null, Fragment.from(node))
  }
  return node
}

// Used to group adjacent nodes wrapped in similar parents by
// normalizeSiblings into the same parent node
function addToSibling(
  wrap: ReadonlyArray<NodeType<any, any>>,
  lastWrap: ReadonlyArray<NodeType<any, any>>,
  node: Node<any, any>,
  sibling: Node<any, any>,
  depth: number
): Node<any, any> | undefined {
  if (depth < wrap.length && depth < lastWrap.length && wrap[depth] == lastWrap[depth]) {
    const inner = addToSibling(wrap, lastWrap, node, sibling.content.content[sibling.childCount - 1]!, depth + 1)
    if (inner) return sibling.copy(sibling.content.replaceChild(sibling.childCount - 1, inner))
    const match = sibling.contentMatchAtUnsafe(sibling.childCount)
    if (match.matchTypeOrNull(depth == wrap.length - 1 ? node.type : wrap[depth + 1]!)) {
      return sibling.copy(sibling.content.append(Fragment.from(withWrappers(node, wrap, depth + 1))))
    }
  }
  return undefined
}

function closeRight(node: Node<any, any>, depth: number): Node<any, any> {
  if (depth == 0) return node
  const fragment = node.content.replaceChild(
    node.childCount - 1,
    closeRight(node.content.content[node.childCount - 1]!, depth - 1)
  )
  const fill = node.contentMatchAtUnsafe(node.childCount).fillBeforeOrNull(Fragment.empty, true)!
  return node.copy(fragment.append(fill))
}

function closeRange(
  fragment: Fragment<any, any>,
  side: number,
  from: number,
  to: number,
  depth: number,
  openEnd: number
): Fragment<any, any> {
  const node = side < 0 ? fragment.content[0]! : fragment.content[fragment.childCount - 1]!
  let inner = node.content
  if (fragment.childCount > 1) openEnd = 0
  if (depth < to - 1) inner = closeRange(inner, side, from, to, depth + 1, openEnd)
  if (depth >= from) {
    inner =
      side < 0
        ? node
            .contentMatchAtUnsafe(0)
            .fillBeforeOrNull(inner, openEnd <= depth)!
            .append(inner)
        : inner.append(node.contentMatchAtUnsafe(node.childCount).fillBeforeOrNull(Fragment.empty, true)!)
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
const wrapMap: { [node: string]: Array<string> } = {
  thead: ["table"],
  tbody: ["table"],
  tfoot: ["table"],
  caption: ["table"],
  colgroup: ["table"],
  col: ["table", "colgroup"],
  tr: ["table", "tbody"],
  td: ["table", "tbody", "tr"],
  th: ["table", "tbody", "tr"]
}

let _detachedDoc: Document | null = null
function detachedDoc() {
  return _detachedDoc || (_detachedDoc = document.implementation.createHTMLDocument("title"))
}

let _policy: any = null

function maybeWrapTrusted(html: string): string {
  const trustedTypes = (window as any).trustedTypes
  if (!trustedTypes) return html
  // With the require-trusted-types-for CSP, Chrome will block
  // innerHTML, even on a detached document. This wraps the string in
  // a way that makes the browser allow us to use its parser again.
  if (!_policy) {
    _policy =
      trustedTypes.defaultPolicy || trustedTypes.createPolicy("ProseMirrorClipboard", { createHTML: (s: string) => s })
  }
  return _policy.createHTML(html)
}

function readHTML(html: string) {
  const metas = /^(\s*<meta [^>]*>)*/.exec(html)
  if (metas) html = html.slice(metas[0].length)
  let elt = detachedDoc().createElement("div")
  const firstTag = /<([a-z][^>\s]+)/i.exec(html)
  let wrap
  if ((wrap = firstTag && wrapMap[firstTag[1]!.toLowerCase()])) {
    html =
      wrap.map((n) => "<" + n + ">").join("") +
      html +
      wrap
        .map((n) => "</" + n + ">")
        .reverse()
        .join("")
  }
  elt.innerHTML = maybeWrapTrusted(html)
  if (wrap) {
    for (let i = 0; i < wrap.length; i++) elt = elt.querySelector(wrap[i]!) || elt
  }
  return elt
}

// Webkit browsers do some hard-to-predict replacement of regular
// spaces with non-breaking spaces when putting content on the
// clipboard. This tries to convert such non-breaking spaces (which
// will be wrapped in a plain span on Chrome, a span with class
// Apple-converted-space on Safari) back to regular spaces.
function restoreReplacedSpaces(dom: HTMLElement) {
  const nodes = dom.querySelectorAll(browser.chrome ? "span:not([class]):not([style])" : "span.Apple-converted-space")
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!
    if (node.childNodes.length == 1 && node.textContent == " " && node.parentNode) {
      node.parentNode.replaceChild(dom.ownerDocument.createTextNode(" "), node)
    }
  }
}

function addContext(slice: Slice<any>, context: string) {
  if (!slice.size) return slice
  const schema = slice.content.content[0]!.type.schema
  const array = Option.getOrUndefined(parseJson(context))
  if (!Array.isArray(array)) return slice
  let { content, openEnd, openStart } = slice
  for (let i = array.length - 2; i >= 0; i -= 2) {
    const type = schema.nodes[array[i]]
    if (!type || type.hasRequiredAttrs()) break
    content = Fragment.from(type.createUnsafe(array[i + 1], content))
    openStart++
    openEnd++
  }
  return new Slice(content, openStart, openEnd)
}
