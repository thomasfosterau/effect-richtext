/**
 * A tiny shim reproducing the `ist` assertion helper used by the
 * ProseMirror test suites, implemented on top of `@effect/vitest`'s
 * `assert`. Keeps ported tests close to the originals.
 */
import { assert } from "@effect/vitest"
import * as Arr from "effect/Array"
import * as HashMap from "effect/HashMap"
import * as Predicate from "effect/Predicate"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import { getSome } from "./option.ts"

type Cmp<A, B> = string | ((a: A, b: B) => boolean)

const ops = HashMap.make<ReadonlyArray<readonly [string, (a: any, b: any) => boolean]>>(
  ["==", (a, b) => a == b],
  ["===", (a, b) => a === b],
  ["!=", (a, b) => a != b],
  ["<", (a, b) => a < b],
  ["<=", (a, b) => a <= b],
  [">", (a, b) => a > b],
  [">=", (a, b) => a >= b]
)

const quote = Schema.encodeSync(Schema.fromJsonString(Schema.String))

const show = <A>(u: A): string =>
  Result.getOrElse(
    Result.try(() => (Predicate.isString(u) ? quote(u) : String(u))),
    () => Object.prototype.toString.call(u)
  )

function ist<A>(value: A): void
function ist<A, B>(value: A, expected: B, cmp?: Cmp<A, B>): void
function ist(value: any, expected: any, cmp: (a: any, b: any) => boolean): void
function ist<A>(value: A, ...rest: Array<unknown>): void {
  if (Arr.isArrayEmpty(rest)) {
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
  const f = Predicate.isString(cmp) ? getSome(HashMap.get(ops, cmp), `unknown comparison ${cmp}`) : cmp
  assert.ok(
    f(value, expected),
    `${show(value)} ${Predicate.isString(cmp) ? cmp : cmp.name || "cmp"} ${show(expected)} failed`
  )
}

ist.throws = <A>(f: () => A, pattern?: RegExp | string | ((e: any) => boolean)): void => {
  const result = Result.try(f)
  assert.ok(Result.isFailure(result), "Expected function to throw")
  if (pattern !== undefined && Result.isFailure(result)) {
    const error = result.failure
    const msg = Predicate.isError(error) ? error.message : String(error)
    if (Predicate.isString(pattern)) assert.ok(msg.includes(pattern), `Error ${show(msg)} does not include ${pattern}`)
    else if (Predicate.isRegExp(pattern)) assert.ok(pattern.test(msg), `Error ${show(msg)} does not match ${pattern}`)
    else assert.ok(pattern(error), `Error ${show(msg)} did not satisfy predicate`)
  }
}

export default ist
