import * as Effect from "effect/Effect"
import * as Result from "effect/Result"

/**
 * Lift a synchronous computation that signals expected failure by
 * throwing a tagged error (as recognised by `isExpected`) into an
 * Effect. Other exceptions become defects.
 *
 * @internal
 */
export const attempt = <A, E>(f: () => A, isExpected: (u: unknown) => u is E): Effect.Effect<A, E> =>
  Effect.suspend(() =>
    Result.match(Result.try(f), {
      onSuccess: Effect.succeed,
      onFailure: (e) => (isExpected(e) ? Effect.fail(e) : Effect.die(e))
    })
  )
