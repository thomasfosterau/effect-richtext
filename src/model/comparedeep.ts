import * as Predicate from "effect/Predicate"

/** @internal */
export function compareDeep(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (!Predicate.isObjectOrArray(a) || !Predicate.isObjectOrArray(b)) return false
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (!compareDeep(a[i], b[i])) return false
  } else {
    if (Array.isArray(b)) return false
    for (const p in a) if (!(p in b) || !compareDeep(a[p], b[p])) return false
    for (const p in b) if (!(p in a)) return false
  }
  return true
}
