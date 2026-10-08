/**
 * Tagged errors raised by the state layer.
 *
 * @since 0.1.0
 */
import * as Data from "effect/Data"

/**
 * An invalid editor state operation: a state configuration without a
 * schema or document, two different instances of a keyed plugin, a
 * transaction applied to a state it wasn't created for, or invalid
 * JSON field names.
 *
 * @since 0.1.0
 * @category errors
 */
export class StateError extends Data.TaggedError("StateError")<{
  readonly message: string
}> {}

/**
 * An invalid selection: a node selection at a position with no node
 * after it, a selection that points into a different document than the
 * one it is used with, or a duplicate selection JSON id.
 *
 * @since 0.1.0
 * @category errors
 */
export class SelectionError extends Data.TaggedError("SelectionError")<{
  readonly message: string
}> {}

/**
 * Union of the errors defined by the state layer.
 *
 * @since 0.1.0
 * @category errors
 */
export type StateFailure = StateError | SelectionError

/**
 * @since 0.1.0
 * @category guards
 */
export const isStateFailure = (u: unknown): u is StateFailure => u instanceof StateError || u instanceof SelectionError
