import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import type { Fragment } from "./fragment.ts"

/** @internal */
export function findDiffStart(a: Fragment<any, any>, b: Fragment<any, any>, pos: number): Option.Option<number> {
  // Positions are never negative, so -1 means no difference found yet.
  let found = -1
  a.content.some((childA, i) => {
    if (i === b.childCount) return true
    const childB = b.content[i]
    if (childA !== childB) {
      if (!childA.sameMarkup(childB)) found = pos
      else if (childA.isTextNode() && childB.isTextNode() && childA.text !== childB.text) {
        found = pos + sameTextStart(childA.text, childB.text)
      } else if (childA.content.size || childB.content.size) {
        found = Option.getOrElse(findDiffStart(childA.content, childB.content, pos + 1), () => -1)
      }
      if (found >= 0) return true
    }
    pos += childA.nodeSize
    return false
  })
  if (found >= 0) return Option.some(found)
  return a.childCount === b.childCount ? Option.none() : Option.some(pos)
}

/** @internal */
export function findDiffEnd(
  a: Fragment<any, any>,
  b: Fragment<any, any>,
  posA: number,
  posB: number
): Option.Option<{ a: number; b: number }> {
  const shift = b.childCount - a.childCount
  let found = { a: 0, b: 0 }
  // Scans backwards, stopping at the first child pair that differs.
  const differs = Arr.findLastIndex(a.content, (childA, iA) => {
    if (iA + shift < 0) return false
    const childB = b.content[iA + shift],
      size = childA.nodeSize
    if (childA !== childB) {
      if (!childA.sameMarkup(childB)) {
        found = { a: posA, b: posB }
        return true
      }
      if (childA.isTextNode() && childB.isTextNode() && childA.text !== childB.text) {
        const same = sameTextEnd(childA.text, childB.text)
        found = { a: posA - same, b: posB - same }
        return true
      }
      if (childA.content.size || childB.content.size) {
        const inner = findDiffEnd(childA.content, childB.content, posA - 1, posB - 1)
        if (Option.isSome(inner)) {
          found = inner.value
          return true
        }
      }
    }
    posA -= size
    posB -= size
    return false
  })
  if (Option.isSome(differs)) return Option.some(found)
  return a.childCount === b.childCount ? Option.none() : Option.some({ a: posA, b: posB })
}

// The length of the common prefix of two different strings, never
// ending between the halves of a surrogate pair (prosemirror-model 1.25.8).
function sameTextStart(ta: string, tb: string): number {
  const j = indexWhere(ta, (ch, i) => ch !== tb[i])
  return j && j < ta.length && j < tb.length && splitsPair(ta, j) ? j - 1 : j
}

// The length of the common suffix of two different strings, never
// starting between the halves of a surrogate pair.
function sameTextEnd(ta: string, tb: string): number {
  const most = Math.min(ta.length, tb.length)
  const same = indexWhere(ta, (_, i) => i === most || ta[ta.length - i - 1] !== tb[tb.length - i - 1])
  const end = ta.length - same
  return end && same && same < tb.length && splitsPair(ta, end) ? same - 1 : same
}

// The index of the first code unit of `text` that passes `f`, or its
// length. Strings are array-like, so this walks one without copying it.
const indexWhere = (text: string, f: (ch: string, i: number) => boolean): number => {
  const i = Array.prototype.findIndex.call<string, [(ch: string, i: number) => boolean], number>(text, f)
  return i < 0 ? text.length : i
}

// Whether index `i` of `text` falls between a high and a low surrogate.
const splitsPair = (text: string, i: number): boolean =>
  surrogateHigh(text.charCodeAt(i - 1)) && surrogateLow(text.charCodeAt(i))

const surrogateLow = (ch: number): boolean => ch >= 0xdc00 && ch < 0xe000
const surrogateHigh = (ch: number): boolean => ch >= 0xd800 && ch < 0xdc00
