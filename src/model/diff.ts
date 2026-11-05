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
      const ta = (childA as TextNode).text,
        tb = (childB as TextNode).text
      let j = 0
      for (; ta[j] === tb[j]; j++) pos++
      // Never point between the halves of a surrogate pair (prosemirror-model 1.25.8).
      if (
        j &&
        j < ta.length &&
        j < tb.length &&
        surrogateHigh(ta.charCodeAt(j - 1)) &&
        surrogateLow(ta.charCodeAt(j))
      ) {
        pos--
      }
      return pos
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
      const ta = (childA as TextNode).text,
        tb = (childB as TextNode).text
      let iA = ta.length,
        iB = tb.length
      while (iA > 0 && iB > 0 && ta[iA - 1] === tb[iB - 1]) {
        iA--
        iB--
        posA--
        posB--
      }
      if (iA && iB && iA < ta.length && surrogateHigh(ta.charCodeAt(iA - 1)) && surrogateLow(ta.charCodeAt(iA))) {
        posA++
        posB++
      }
      return { a: posA, b: posB }
    }
    if (childA.content.size || childB.content.size) {
      const inner = findDiffEnd(childA.content, childB.content, posA - 1, posB - 1)
      if (inner) return inner
    }
    posA -= size
    posB -= size
  }
}

const surrogateLow = (ch: number): boolean => ch >= 0xdc00 && ch < 0xe000
const surrogateHigh = (ch: number): boolean => ch >= 0xd800 && ch < 0xdc00
