/**
 * Helpers shared by the command modules.
 *
 * @internal
 */
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import type { AnySchema } from "../Model.ts"
import type { Command, EditorState, EditorViewLike, Transaction } from "../State.ts"

/** @internal */
export const succeedTrue: Effect.Effect<boolean> = Effect.succeed(true)

/** @internal */
export const succeedFalse: Effect.Effect<boolean> = Effect.succeed(false)

/**
 * The result of a synchronous command body: `false` when the command
 * doesn't apply, `true` when it applies (and there is nothing to
 * dispatch), or a transaction to dispatch (which also means it
 * applies).
 *
 * @internal
 */
export type SyncResult<Sc extends AnySchema = AnySchema> = boolean | Transaction<Sc>

/**
 * Build a command from a synchronous body. The body receives whether a
 * dispatch function was given, and returns `false`, `true`, or a
 * transaction to dispatch. Exceptions thrown by the body are defects.
 *
 * @internal
 */
export const syncCommand =
  <Sc extends AnySchema = AnySchema>(
    body: (state: EditorState<Sc, any, any>, dispatching: boolean, view?: EditorViewLike) => SyncResult<Sc>
  ): Command<Sc> =>
  (state, dispatch, view) =>
    Effect.suspend(() => {
      const result = body(state, dispatch !== undefined, view)
      if (result === true) return succeedTrue
      if (result === false) return succeedFalse
      return dispatch ? Effect.as(dispatch(result), true) : succeedTrue
    })

/**
 * When dispatching, build the transaction; otherwise just report that
 * the command applies.
 *
 * @internal
 */
export const done = <Sc extends AnySchema>(dispatching: boolean, build: () => Transaction<Sc>): SyncResult<Sc> =>
  dispatching ? build() : true

/**
 * Wrap a command so that the marks active before it runs (a split) are
 * kept active after it.
 *
 * @internal
 */
export const keepMarks =
  <Sc extends AnySchema, E, R>(command: Command<Sc, E, R>): Command<Sc, E, R> =>
  (state, dispatch) =>
    command(
      state,
      dispatch &&
        ((tr) =>
          Effect.suspend(() => {
            const marks = Option.orElse(state.storedMarks, () =>
              state.selection.$to.parentOffset ? Option.some(state.selection.$from.marks()) : Option.none()
            )
            if (Option.isSome(marks)) tr.ensureMarks(marks.value)
            return dispatch(tr)
          }))
    )
