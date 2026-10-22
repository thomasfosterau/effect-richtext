/**
 * A tiny shim reproducing the `ist` assertion helper used by the
 * ProseMirror test suites, implemented on top of `@effect/vitest`'s
 * `assert`. Keeps ported tests close to the originals.
 */
import { assert } from "@effect/vitest"

type Cmp<A, B> = string | ((a: A, b: B) => boolean)

const ops: Record<string, (a: any, b: any) => boolean> = {
  "==": (a, b) => a == b,
  "===": (a, b) => a === b,
  "!=": (a, b) => a != b,
  "<": (a, b) => a < b,
  "<=": (a, b) => a <= b,
  ">": (a, b) => a > b,
  ">=": (a, b) => a >= b
}

const show = (u: unknown): string => {
  try {
    return typeof u === "string" ? JSON.stringify(u) : String(u)
  } catch {
    return Object.prototype.toString.call(u)
  }
}

export function ist(value: unknown): void
export function ist<A, B>(value: A, expected: B, cmp?: Cmp<A, B>): void
export function ist(value: any, expected: any, cmp: (a: any, b: any) => boolean): void
export function ist(value: unknown, ...rest: Array<unknown>): void {
  if (rest.length === 0) {
    assert.ok(value, `Expected ${show(value)} to be truthy`)
    return
  }
  const [expected, cmp] = rest as [unknown, Cmp<unknown, unknown> | undefined]
  if (cmp === undefined) {
    assert.ok(
      // Like `ist`, the default comparison is `==`.
      value == expected,
      `${show(value)} !== ${show(expected)}`
    )
    return
  }
  const f = typeof cmp === "string" ? ops[cmp]! : cmp
  assert.ok(
    f(value, expected),
    `${show(value)} ${typeof cmp === "string" ? cmp : cmp.name || "cmp"} ${show(expected)} failed`
  )
}

ist.throws = (f: () => unknown, pattern?: RegExp | string | ((e: any) => boolean)): void => {
  let thrown = false,
    error: unknown
  try {
    f()
  } catch (e) {
    thrown = true
    error = e
  }
  assert.ok(thrown, "Expected function to throw")
  if (pattern !== undefined) {
    const msg = error instanceof Error ? error.message : String(error)
    if (typeof pattern === "string") assert.ok(msg.includes(pattern), `Error ${show(msg)} does not include ${pattern}`)
    else if (pattern instanceof RegExp) assert.ok(pattern.test(msg), `Error ${show(msg)} does not match ${pattern}`)
    else assert.ok(pattern(error), `Error ${show(msg)} did not satisfy predicate`)
  }
}

export default ist
