/**
 * Framework-neutral reactive bindings: editor states and views as
 * `SubscriptionRef`s and `Stream`s.
 *
 * - `StateRef.make(state)` holds a state without a view (headless editing,
 *   servers, tests) and applies dispatched transactions.
 * - `EditorObserver.make(view)` (or `observe(view)`) follows a view.
 *
 * Both expose the same `EditorStreams`: `state`, `transactions`,
 * `docChanges`, `selection`, `select(f, eq?)`, `isMarkActive`,
 * `isNodeActive` and `canExecute`.
 *
 * @since 0.1.0
 */
import * as EditorObserver from "./reactive/observer.ts"
import * as StateRef from "./reactive/stateref.ts"

export {
  /**
   * @since 0.1.0
   */
  EditorObserver,
  /**
   * @since 0.1.0
   */
  StateRef
}

export {
  /** @since 0.1.0 */
  isMarkActive,
  /** @since 0.1.0 */
  isNodeActive
} from "./reactive/selectors.ts"
export type {
  /** @since 0.1.0 */
  EditorStreams,
  /** @since 0.1.0 */
  ReadonlyRef,
  /** @since 0.1.0 */
  TransactionEvent
} from "./reactive/streams.ts"

/**
 * Observe an editor view (alias of `EditorObserver.make`).
 *
 * @since 0.1.0
 * @category constructors
 */
export const observe = EditorObserver.make
