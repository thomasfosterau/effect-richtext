/**
 * Tagged errors raised by the view layer.
 *
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"

/**
 * An invalid view operation, such as asking for the document position
 * of a DOM position that is not inside the editor.
 *
 * @since 0.1.0
 * @category errors
 */
export class ViewError extends Schema.TaggedError<ViewError>()("ViewError", {
  message: Schema.String
}) {}

/**
 * @since 0.1.0
 * @category guards
 */
export const isViewError = (u: unknown): u is ViewError => u instanceof ViewError
