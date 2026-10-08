/**
 * `EditorObserver`: reactive streams for an `EditorView`.
 *
 * @since 0.1.0
 */
import * as Effect from "effect/Effect"
import type * as Scope from "effect/Scope"
import type * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import type { AnySchema } from "../model.ts"
import type { EditorView } from "../view.ts"
import {
  type EditorStreams,
  makeRef,
  makeSource,
  makeStreams,
  publishTransactions,
  setRefUnsafe,
  setState
} from "./streams.ts"

/**
 * @since 0.1.0
 * @category symbols
 */
export const EditorObserverTypeId: unique symbol = Symbol.for("effect-richtext/reactive/EditorObserver") as never

/**
 * @since 0.1.0
 * @category symbols
 */
export type EditorObserverTypeId = typeof EditorObserverTypeId

/**
 * Reactive streams following the state of an editor view (see
 * `EditorStreams`), plus its focus.
 *
 * @since 0.1.0
 * @category models
 */
export interface EditorObserver<Sc extends AnySchema = AnySchema, R = never, E = never>
  extends EditorStreams<Sc, R, E>
{
  readonly [EditorObserverTypeId]: EditorObserverTypeId
  /** The observed view. */
  readonly view: EditorView<Sc, R, E>
  /** Whether the view has focus: the current value, then every change. */
  readonly focus: Stream.Stream<boolean>
}

/**
 * Observe an editor view. The observer registers a listener with
 * `view.subscribe` and focus listeners on `view.dom`, and removes them
 * (ending all its streams) when the scope closes. It doesn't change the
 * view's props or plugins.
 *
 * ```ts
 * const observer = yield* EditorObserver.make(view)
 * yield* observer.isMarkActive("strong").pipe(
 *   Stream.runForEach((active) => Effect.sync(() => button.classList.toggle("active", active))),
 *   Effect.forkScoped
 * )
 * ```
 *
 * @since 0.1.0
 * @category constructors
 */
export const make = <Sc extends AnySchema, R, E>(
  view: EditorView<Sc, R, E>
): Effect.Effect<EditorObserver<Sc, R, E>, never, Scope.Scope> =>
  Effect.gen(function*() {
    const source = yield* makeSource(view.state)
    const focused = yield* makeRef(view.hasFocus())

    yield* Effect.acquireRelease(
      Effect.sync(() =>
        view.subscribe((update) => {
          // Use the view's current state rather than `update.state`: a
          // nested update (from a plugin view) may already have replaced it.
          setState(source, view.state)
          publishTransactions(source, update.transactions, update.state, update.prevState)
        })
      ),
      (unsubscribe) => Effect.sync(unsubscribe)
    )

    // Written synchronously from DOM event handlers.
    const setFocus = (value: boolean) => setRefUnsafe(focused, value)
    const onFocusIn = () => setFocus(true)
    const onFocusOut = (event: FocusEvent) =>
      setFocus(!!event.relatedTarget && view.dom.contains(event.relatedTarget as globalThis.Node))
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        view.dom.addEventListener("focusin", onFocusIn)
        view.dom.addEventListener("focusout", onFocusOut)
      }),
      () =>
        Effect.sync(() => {
          view.dom.removeEventListener("focusin", onFocusIn)
          view.dom.removeEventListener("focusout", onFocusOut)
        })
    )

    const observer: EditorObserver<Sc, R, E> = {
      [EditorObserverTypeId]: EditorObserverTypeId,
      ...makeStreams(source, view),
      view,
      focus: SubscriptionRef.changes(focused)
    }
    return observer
  })
