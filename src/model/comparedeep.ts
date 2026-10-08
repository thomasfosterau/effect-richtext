/** @internal */
export function compareDeep(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (!(a && typeof a === "object") || !(b && typeof b === "object")) return false
  const array = Array.isArray(a)
  if (Array.isArray(b) !== array) return false
  if (array) {
    const aa = a as Array<unknown>, bb = b as Array<unknown>
    if (aa.length !== bb.length) return false
    for (let i = 0; i < aa.length; i++) if (!compareDeep(aa[i], bb[i])) return false
  } else {
    const ao = a as Record<string, unknown>, bo = b as Record<string, unknown>
    for (const p in ao) if (!(p in bo) || !compareDeep(ao[p], bo[p])) return false
    for (const p in bo) if (!(p in ao)) return false
  }
  return true
}
