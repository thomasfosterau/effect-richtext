import * as Effect from "effect/Effect"
import type * as Fiber from "effect/Fiber"
import * as Stream from "effect/Stream"

/** Let forked fibers run until they block. */
export const settle: Effect.Effect<void> = Effect.replicateEffect(Effect.yieldNow, 20, { discard: true })

/**
 * Start collecting the first `n` elements of a stream (or all of them,
 * until it ends) in a background fiber, subscribing before returning;
 * join the result with `Fiber.join`.
 */
export const collect = <A, E, R>(
  stream: Stream.Stream<A, E, R>,
  n?: number
): Effect.Effect<Fiber.Fiber<ReadonlyArray<A>, E>, never, R> =>
  Effect.gen(function* () {
    const fiber = yield* (n === undefined ? stream : Stream.take(stream, n)).pipe(Stream.runCollect, Effect.forkChild)
    yield* settle
    return fiber
  })
