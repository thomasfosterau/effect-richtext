import * as Effect from "effect/Effect"

/**
 * Lift a synchronous computation that signals expected failure by
 * throwing a tagged error (as recognised by `isExpected`) into an
 * Effect. Other exceptions become defects.
 *
 * @internal
 */
export const attempt = <A, E>(
  f: () => A,
  isExpected: (u: unknown) => u is E
): Effect.Effect<A, E> =>
  Effect.suspend(() => {
    try {
      return Effect.succeed(f())
    } catch (e) {
      return isExpected(e) ? Effect.fail(e) : Effect.die(e)
    }
  })
