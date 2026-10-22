/**
 * Option helpers for the test suites.
 */
import { assert } from "@effect/vitest"
import * as Option from "effect/Option"

/**
 * Unwraps a `Some`, failing the current test with `message` on `None`. Use it
 * where a ported test expects a value to be present: absence is a test
 * failure, not a thrown defect. Works in a pipe (`x.pipe(getSome)`).
 */
export const getSome = <A>(option: Option.Option<A>, message = "expected Some, got None"): A =>
  Option.getOrElse(option, () => assert.fail(message))
