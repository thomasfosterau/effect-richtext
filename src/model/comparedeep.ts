import * as Rec from "effect/Record"
import * as Predicate from "effect/Predicate"

/** @internal */
export function compareDeep(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (!Predicate.isObjectOrArray(a) || !Predicate.isObjectOrArray(b)) return false
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((value, i) => compareDeep(value, b[i]))
  }
  return (
    !Array.isArray(b) && Rec.keys(a).every((p) => p in b && compareDeep(a[p], b[p])) && Rec.keys(b).every((p) => p in a)
  )
}
