import * as Effect from "effect/Effect"
import * as Result from "effect/Result"

/**
 * Lift a synchronous computation that signals expected failure by
 * throwing a tagged error (as recognised by `isExpected`) into an
 * Effect. Other exceptions become defects.
 *
 * `E` may be narrower than the errors `isExpected` recognises: it names
 * the ones `f` is documented to throw, and is usually inferred from the
 * caller's return type.
 *
 * @internal
 */
export const attempt = <A, E extends W, W = E>(f: () => A, isExpected: (u: unknown) => u is W): Effect.Effect<A, E> =>
  Effect.suspend(() =>
    Result.match(Result.try(f), {
      onSuccess: Effect.succeed,
      // SAFETY: `f` throws only the `E` subset of `W` (see above).
      onFailure: (e) => (isExpected(e) ? Effect.fail(e as E) : Effect.die(e))
    })
  )
