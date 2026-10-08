/**
 * Tagged errors raised by the view layer.
 *
 * @since 0.1.0
 */
import * as Data from "effect/Data"

/**
 * An invalid view operation, such as asking for the document position
 * of a DOM position that is not inside the editor.
 *
 * @since 0.1.0
 * @category errors
 */
export class ViewError extends Data.TaggedError("ViewError")<{
  readonly message: string
}> {}

/**
 * @since 0.1.0
 * @category guards
 */
export const isViewError = (u: unknown): u is ViewError => u instanceof ViewError
