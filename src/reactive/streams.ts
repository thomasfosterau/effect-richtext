/**
 * The streams shared by `StateRef` and `EditorObserver`.
 *
 * @since 0.1.0
 */
import * as Effect from "effect/Effect"
import * as Equal from "effect/Equal"
import * as PubSub from "effect/PubSub"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import type { AnySchema, Attrs, MarkNames, MarkType, Node, NodeNames, NodeType } from "../model.ts"
import type { Command, EditorState, EditorViewLike, Selection, Transaction } from "../state.ts"
import * as selectors from "./selectors.ts"

/**
 * A transaction applied to an editor state, as emitted by the
 * `transactions` stream.
 *
 * @since 0.1.0
 * @category models
 */
export interface TransactionEvent<Sc extends AnySchema = AnySchema, R = never, E = never> {
  /** The dispatched transaction. */
  readonly tr: Transaction<Sc>
  /**
   * All the transactions that were applied: `tr` followed by those
   * appended by plugins (`appendTransaction`).
   */
  readonly transactions: ReadonlyArray<Transaction<Sc>>
  /** The state after the transactions were applied. */
  readonly state: EditorState<Sc, R, E>
  /** The state before the transactions were applied. */
  readonly prevState: EditorState<Sc, R, E>
}

/**
 * A read-only view of a `SubscriptionRef`.
 *
 * @since 0.1.0
 * @category models
 */
export interface ReadonlyRef<A> {
  /** The current value. */
  readonly get: Effect.Effect<A>
  /** The current value, read synchronously. */
  readonly getUnsafe: () => A
  /** The current value followed by every subsequent change. */
  readonly changes: Stream.Stream<A>
}

/**
 * The reactive streams of an editor state, shared by `StateRef` (headless)
 * and `EditorObserver` (bound to a view).
 *
 * The state-like streams (`state.changes`, `docChanges`, `selection`,
 * `select` and the convenience selectors) start with the current value
 * and only emit when the projected value changes. `transactions` is hot:
 * subscribers only see the transactions applied after they subscribed.
 * All streams end when the scope the source was created in closes.
 *
 * @since 0.1.0
 * @category models
 */
export interface EditorStreams<Sc extends AnySchema = AnySchema, R = never, E = never> {
  /** The current state, and its changes. */
  readonly state: ReadonlyRef<EditorState<Sc, R, E>>
  /** The transactions applied to the state (hot). */
  readonly transactions: Stream.Stream<TransactionEvent<Sc, R, E>>
  /** The document, emitted again whenever it changes. */
  readonly docChanges: Stream.Stream<Node<Sc>>
  /** The selection, emitted again whenever it changes (compared with `Selection.eq`). */
  readonly selection: Stream.Stream<Selection<Sc>>
  /**
   * A projection of the state, emitted again whenever it changes, as
   * determined by `eq` (default: `Equal.equals`).
   */
  readonly select: <A>(
    f: (state: EditorState<Sc, R, E>) => A,
    eq?: (self: A, that: A) => boolean
  ) => Stream.Stream<A>
  /** Whether a mark is active in the selection (see `isMarkActive`). */
  readonly isMarkActive: (type: MarkType<Sc, any> | MarkNames<Sc>) => Stream.Stream<boolean>
  /** Whether a node is selected or wraps the selection (see `isNodeActive`). */
  readonly isNodeActive: (type: NodeType<Sc, any> | NodeNames<Sc>, attrs?: Attrs) => Stream.Stream<boolean>
  /**
   * Whether a command can be executed (the command is run without a
   * dispatch function for each new state).
   */
  readonly canExecute: <CE, CR>(command: Command<Sc, CE, CR>) => Stream.Stream<boolean, CE, CR>
}

/** The writable side of the streams, owned by `StateRef` / `EditorObserver`. @internal */
export interface Source<Sc extends AnySchema, R, E> {
  readonly ref: SubscriptionRef.SubscriptionRef<EditorState<Sc, R, E>>
  readonly pubsub: PubSub.PubSub<TransactionEvent<Sc, R, E>>
}

/**
 * Create a `SubscriptionRef` whose pubsub is shut down (ending its
 * `changes` streams) when the scope closes.
 *
 * @internal
 */
export const makeRef = <A>(initial: A): Effect.Effect<SubscriptionRef.SubscriptionRef<A>, never, Scope.Scope> =>
  Effect.acquireRelease(SubscriptionRef.make(initial), (ref) => PubSub.shutdown(ref.pubsub))

/**
 * Set a `SubscriptionRef` synchronously, publishing the value when it
 * changed (by identity). Used for writes made from synchronous callbacks
 * (view listeners, DOM events, synchronous dispatches).
 *
 * @internal
 */
export const setRefUnsafe = <A>(ref: SubscriptionRef.SubscriptionRef<A>, value: A): void => {
  if (ref.value === value) return
  ref.value = value
  PubSub.publishUnsafe(ref.pubsub, value)
}

/**
 * Create the source of the streams; its pubsubs are shut down (ending all
 * streams) when the scope closes.
 *
 * @internal
 */
export const makeSource = <Sc extends AnySchema, R, E>(
  initial: EditorState<Sc, R, E>
): Effect.Effect<Source<Sc, R, E>, never, Scope.Scope> =>
  Effect.zipWith(
    makeRef(initial),
    Effect.acquireRelease(PubSub.unbounded<TransactionEvent<Sc, R, E>>(), PubSub.shutdown),
    (ref, pubsub) => ({ ref, pubsub })
  )

/**
 * Set the current state synchronously (publishing it when it changed).
 *
 * @internal
 */
export const setState = <Sc extends AnySchema, R, E>(source: Source<Sc, R, E>, state: EditorState<Sc, R, E>): void =>
  setRefUnsafe(source.ref, state)

/**
 * Publish an applied transaction (and the resulting state).
 *
 * @internal
 */
export const publishTransactions = <Sc extends AnySchema, R, E>(
  source: Source<Sc, R, E>,
  transactions: ReadonlyArray<Transaction<Sc>>,
  state: EditorState<Sc, R, E>,
  prevState: EditorState<Sc, R, E>
): void => {
  if (transactions.length) {
    PubSub.publishUnsafe(source.pubsub, { tr: transactions[0]!, transactions, state, prevState })
  }
}

/**
 * Build the streams of a source.
 *
 * @internal
 */
export const makeStreams = <Sc extends AnySchema, R, E>(
  source: Source<Sc, R, E>,
  view?: EditorViewLike
): EditorStreams<Sc, R, E> => {
  const { pubsub, ref } = source
  const changes = SubscriptionRef.changes(ref)
  const select = <A>(
    f: (state: EditorState<Sc, R, E>) => A,
    eq: (self: A, that: A) => boolean = Equal.equals
  ): Stream.Stream<A> => Stream.changesWith(Stream.map(changes, f), eq)
  return {
    state: { get: SubscriptionRef.get(ref), getUnsafe: () => ref.value, changes },
    transactions: Stream.fromPubSub(pubsub),
    docChanges: select((state) => state.doc, (a, b) => a === b),
    selection: select((state) => state.selection, (a, b) => a.eq(b)),
    select,
    isMarkActive: (type) => select((state) => selectors.isMarkActive(state, type)),
    isNodeActive: (type, attrs) => select((state) => selectors.isNodeActive(state, type, attrs)),
    canExecute: (command) =>
      Stream.changesWith(
        Stream.mapEffect(changes, (state) => command(state, undefined, view)),
        (a, b) => a === b
      )
  }
}
