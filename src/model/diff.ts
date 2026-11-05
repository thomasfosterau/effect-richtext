import type { Fragment } from "./fragment.ts"
import type { TextNode } from "./node.ts"

/** @internal */
export function findDiffStart(a: Fragment<any, any>, b: Fragment<any, any>, pos: number): number | null {
  for (let i = 0; ; i++) {
    if (i === a.childCount || i === b.childCount) return a.childCount === b.childCount ? null : pos

    const childA = a.content[i]!,
      childB = b.content[i]!
    if (childA === childB) {
      pos += childA.nodeSize
      continue
    }

    if (!childA.sameMarkup(childB)) return pos

    if (childA.isText && (childA as TextNode).text !== (childB as TextNode).text) {
      return pos + sameTextStart((childA as TextNode).text, (childB as TextNode).text)
    }
    if (childA.content.size || childB.content.size) {
      const inner = findDiffStart(childA.content, childB.content, pos + 1)
      if (inner != null) return inner
    }
    pos += childA.nodeSize
  }
}

/** @internal */
export function findDiffEnd(
  a: Fragment<any, any>,
  b: Fragment<any, any>,
  posA: number,
  posB: number
): { a: number; b: number } | null {
  for (let iA = a.childCount, iB = b.childCount; ;) {
    if (iA === 0 || iB === 0) return iA === iB ? null : { a: posA, b: posB }

    const childA = a.content[--iA]!,
      childB = b.content[--iB]!,
      size = childA.nodeSize
    if (childA === childB) {
      posA -= size
      posB -= size
      continue
    }

    if (!childA.sameMarkup(childB)) return { a: posA, b: posB }

    if (childA.isText && (childA as TextNode).text !== (childB as TextNode).text) {
      const same = sameTextEnd((childA as TextNode).text, (childB as TextNode).text)
      return { a: posA - same, b: posB - same }
    }
    if (childA.content.size || childB.content.size) {
      const inner = findDiffEnd(childA.content, childB.content, posA - 1, posB - 1)
      if (inner) return inner
    }
    posA -= size
    posB -= size
  }
}

// The length of the common prefix of two different strings, never
// ending between the halves of a surrogate pair (prosemirror-model 1.25.8).
function sameTextStart(ta: string, tb: string): number {
  let j = 0
  while (ta[j] === tb[j]) j++
  return j && j < ta.length && j < tb.length && splitsPair(ta, j) ? j - 1 : j
}

// The length of the common suffix of two different strings, never
// starting between the halves of a surrogate pair.
function sameTextEnd(ta: string, tb: string): number {
  let same = 0
  while (same < ta.length && same < tb.length && ta[ta.length - same - 1] === tb[tb.length - same - 1]) same++
  const end = ta.length - same
  return end && same && same < tb.length && splitsPair(ta, end) ? same - 1 : same
}

// Whether index `i` of `text` falls between a high and a low surrogate.
const splitsPair = (text: string, i: number): boolean =>
  surrogateHigh(text.charCodeAt(i - 1)) && surrogateLow(text.charCodeAt(i))

const surrogateLow = (ch: number): boolean => ch >= 0xdc00 && ch < 0xe000
const surrogateHigh = (ch: number): boolean => ch >= 0xd800 && ch < 0xdc00
