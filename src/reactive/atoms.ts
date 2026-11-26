/**
 * `effect/reactivity` atoms over the editor streams.
 *
 * @since 0.4.0
 */
import { identity } from "effect/Function"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import * as Atom from "effect/reactivity/Atom"
import type { AnySchema } from "../Model.ts"
import type { EditorState } from "../State.ts"
import type { EditorStreams } from "./streams.ts"

/**
 * An atom of a projection of the editor state (`f`), for UIs that render
 * from `effect/reactivity` atoms. It follows `source.select(f, eq)`, so
 * it only changes when `eq` (default: `Equal.equals`) says the projected
 * value did. Until the stream's first value arrives, and after the
 * source's scope closes, it reads the projection of the current state.
 *
 * `source` is a `StateRef` or an `EditorObserver`. The atom is read-only:
 * change the state by dispatching to the source.
 *
 * Built on `effect/reactivity`, whose `Atom` API Effect still marks as
 * unstable, so this may change with an Effect minor release.
 *
 * @example
 * ```ts
 * import * as assert from "node:assert"
 * import * as Effect from "effect/Effect"
 * import * as AtomRegistry from "effect/reactivity/AtomRegistry"
 * import { selectAtom, StateRef } from "@thomasfosterau/effect-richtext/Reactive"
 * import { EditorState } from "@thomasfosterau/effect-richtext/State"
 * import { schema } from "@thomasfosterau/effect-richtext/SchemaBasic"
 *
 * const program = Effect.scoped(
 *   Effect.gen(function* () {
 *     const ref = yield* StateRef.make(EditorState.createUnsafe({ schema }))
 *     const size = selectAtom(ref, (state) => state.doc.content.size)
 *     const registry = AtomRegistry.make()
 *     return registry.get(size)
 *   })
 * )
 *
 * assert.strictEqual(Effect.runSync(program), 2)
 * ```
 *
 * @since 0.4.0
 * @category constructors
 */
export const selectAtom = <Sc extends AnySchema, R, E, A>(
  source: EditorStreams<Sc, R, E>,
  f: (state: EditorState<Sc, R, E>) => A,
  eq?: (self: A, that: A) => boolean
): Atom.Atom<A> =>
  Atom.map(Atom.make(source.select(f, eq)), (result) =>
    AsyncResult.isSuccess(result) ? result.value : f(source.state.getUnsafe())
  )

/**
 * An atom of the editor state, changing whenever the state does (by
 * identity). See `selectAtom`, which this specializes.
 *
 * @since 0.4.0
 * @category constructors
 */
export const editorStateAtom = <Sc extends AnySchema, R, E>(
  source: EditorStreams<Sc, R, E>
): Atom.Atom<EditorState<Sc, R, E>> => selectAtom(source, identity, (a, b) => a === b)
