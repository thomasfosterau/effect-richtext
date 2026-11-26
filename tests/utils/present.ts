/**
 * Presence checks for the test suites.
 */
import { assert } from "@effect/vitest"

/**
 * Returns `value`, failing the current test with `message` when it is `null`
 * or `undefined`. Use it where a ported test relies on a value being there
 * (ProseMirror's suites write `value!`), so a missing value fails the test
 * with a message instead of a `TypeError`.
 */
export const present = <A>(value: A, message = "expected a value, got null or undefined"): NonNullable<A> => {
  if (value === null || value === undefined) return assert.fail(message)
  return value
}

/**
 * Returns `value`, failing the current test with `message` unless it is an
 * instance of `cls`. Use it where a ported test casts a value to a class
 * (ProseMirror's suites write `value as Class`).
 */
export const instanceOf = <I extends object, A>(
  cls: abstract new (...args: Array<any>) => I,
  value: A,
  message = `expected an instance of ${cls.name}`
): A & I => {
  if (!(value instanceof cls)) return assert.fail(message)
  return value
}
