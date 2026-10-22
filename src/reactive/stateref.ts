/**
 * `StateRef`: an editor state held in a `SubscriptionRef`, without a view.
 *
 * @since 0.1.0
 */
import * as Cause from "effect/Cause"
import type * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import type * as Scope from "effect/Scope"
import * as Semaphore from "effect/Semaphore"
import type { AnySchema } from "../model.ts"
import type { Command, Dispatch, EditorState, StateFailure, Transaction } from "../state.ts"
import { type EditorStreams, acquireSource, streamsOf, publishTransactions, setState } from "./streams.ts"

/**
 * @since 0.1.0
 * @category symbols
 */
export const StateRefTypeId: unique symbol = Symbol.for("effect-richtext/reactive/StateRef") as never

/**
 * @since 0.1.0
 * @category symbols
 */
export type StateRefTypeId = typeof StateRefTypeId

/**
 * An editor state held in a `SubscriptionRef`, updated by dispatching
 * transactions to it, without an editor view. Useful for headless or
 * server-side editing, and for tests.
 *
 * Dispatches are serialized and run the state's plugins with the context
 * captured by `StateRef.make`.
 *
 * @since 0.1.0
 * @category models
 */
export interface StateRef<Sc extends AnySchema = AnySchema, R = never, E = never> extends EditorStreams<Sc, R, E> {
  readonly [StateRefTypeId]: StateRefTypeId
  /**
   * Apply a transaction to the current state, publishing the new state
   * and the applied transactions. Fails with the errors of the plugin
   * hooks, or a `StateError` when the transaction doesn't start from the
   * current document.
   */
  readonly dispatch: (tr: Transaction<Sc>) => Effect.Effect<void, E | StateFailure>
  /**
   * Like `dispatch`, but runs synchronously and throws failures. Throws a
   * defect when a plugin hook is asynchronous.
   */
  readonly dispatchUnsafe: (tr: Transaction<Sc>) => void
  /** Replace the state (e.g. with a reconfigured one), without a transaction. */
  readonly set: (state: EditorState<Sc, R, E>) => Effect.Effect<void>
  /**
   * Run a command against the current state, dispatching its
   * transactions. Succeeds with the command's result; fails when the
   * command or one of its dispatches fails.
   */
  readonly execute: <CE, CR>(command: Command<Sc, CE, CR>) => Effect.Effect<boolean, CE | E | StateFailure, CR>
}

/**
 * Run a synchronous effect, throwing its squashed cause on failure.
 */
const runSyncOrThrow = <E>(effect: Effect.Effect<void, E>): void => {
  const exit = Effect.runSyncExit(effect)
  if (Exit.isFailure(exit)) throw Cause.squash(exit.cause)
}

/**
 * Create a `StateRef` holding `initial`. The current context (providing
 * the plugins' requirements `R`) is captured to run plugin hooks when
 * transactions are dispatched. Its streams end when the scope closes.
 *
 * ```ts skip-type-checking
 * const ref = yield* StateRef.make(EditorState.createUnsafe({ schema }))
 * yield* ref.dispatch(ref.state.getUnsafe().tr.insertTextUnsafe("hi"))
 * yield* ref.execute(toggleMark(schema.marks.strong))
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = <Sc extends AnySchema, R = never, E = never>(
  initial: EditorState<Sc, R, E>
): Effect.Effect<StateRef<Sc, R, E>, never, Scope.Scope | R> =>
  Effect.gen(function* () {
    const context = yield* Effect.context<R>()
    const source = yield* acquireSource(initial)
    const semaphore = Semaphore.makeUnsafe(1)

    const applyUnlocked = (tr: Transaction<Sc>): Effect.Effect<void, E | StateFailure, R> =>
      Effect.suspend(() => {
        const prevState = source.ref.value
        return Effect.map(prevState.applyTransaction(tr), ({ state, transactions }) => {
          setState(source, state)
          publishTransactions(source, transactions, state, prevState)
        })
      })

    const dispatch = (tr: Transaction<Sc>): Effect.Effect<void, E | StateFailure> =>
      Effect.provideContext(semaphore.withPermit(applyUnlocked(tr)), context as Context.Context<R>)

    const dispatchUnsafe = (tr: Transaction<Sc>): void =>
      runSyncOrThrow(Effect.provideContext(applyUnlocked(tr), context as Context.Context<R>))

    const set = (state: EditorState<Sc, R, E>): Effect.Effect<void> =>
      semaphore.withPermit(Effect.sync(() => setState(source, state)))

    const execute = <CE, CR>(command: Command<Sc, CE, CR>): Effect.Effect<boolean, CE | E | StateFailure, CR> =>
      Effect.suspend(() => {
        let failure: Cause.Cause<E | StateFailure> | undefined
        const commandDispatch: Dispatch<Sc> = (tr) =>
          failure ? Effect.void : Effect.catchCause(dispatch(tr), (cause) => Effect.sync(() => void (failure = cause)))
        return Effect.flatMap(command(source.ref.value, commandDispatch), (result) =>
          failure ? Effect.failCause(failure) : Effect.succeed(result)
        )
      })

    const ref: StateRef<Sc, R, E> = {
      [StateRefTypeId]: StateRefTypeId,
      ...streamsOf(source),
      dispatch,
      dispatchUnsafe,
      set,
      execute
    }
    return ref
  })
