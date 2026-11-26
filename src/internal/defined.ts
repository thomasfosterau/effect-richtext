import * as Schema from "effect/Schema"

/**
 * A broken internal invariant: a value the algorithm guarantees was missing.
 * Always a bug in this library, never a result of bad input.
 *
 * @internal
 */
export class InvariantError extends Schema.TaggedError<InvariantError, { readonly brand: unique symbol }>()(
  "InvariantError",
  { message: Schema.String }
) {}

/**
 * Returns `value`, or throws an {@link InvariantError} naming `what` when it
 * is `null` or `undefined`.
 *
 * @internal
 */
export const defined = <A>(value: A, what: string): NonNullable<A> => {
  if (value === null || value === undefined) throw new InvariantError({ message: `Expected ${what}` })
  return value
}
