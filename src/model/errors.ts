/**
 * Tagged errors raised by the document model.
 *
 * Every fallible operation in `effect-richtext/model` reports failure
 * through the Effect error channel using one of these errors. The
 * `*Unsafe` variants of those operations throw the same error values
 * instead, which makes them usable from synchronous code.
 *
 * @since 0.1.0
 */
import * as Data from "effect/Data"

/**
 * A position or index was outside of the valid range of a node or
 * fragment.
 *
 * @since 0.1.0
 * @category errors
 */
export class PositionError extends Data.TaggedError("PositionError")<{
  readonly message: string
}> {}

/**
 * Raised when a [`Slice`](#Slice) cannot be fitted into a document,
 * typically by `Node.replace`.
 *
 * @since 0.1.0
 * @category errors
 */
export class ReplaceError extends Data.TaggedError("ReplaceError")<{
  readonly message: string
}> {}

/**
 * Content that does not satisfy a node type's content expression or
 * mark restrictions.
 *
 * @since 0.1.0
 * @category errors
 */
export class ContentError extends Data.TaggedError("ContentError")<{
  readonly message: string
}> {}

/**
 * Missing, unknown, or invalid node or mark attributes.
 *
 * @since 0.1.0
 * @category errors
 */
export class AttributeError extends Data.TaggedError("AttributeError")<{
  readonly message: string
}> {}

/**
 * A schema definition (or a content expression in it) is invalid.
 *
 * @since 0.1.0
 * @category errors
 */
export class SchemaDefinitionError extends Data.TaggedError("SchemaDefinitionError")<{
  readonly message: string
}> {}

/**
 * Raised when deserializing JSON that does not describe a valid
 * document structure for the schema.
 *
 * @since 0.1.0
 * @category errors
 */
export class JSONError extends Data.TaggedError("JSONError")<{
  readonly message: string
}> {}

/**
 * Union of all errors produced by the model.
 *
 * @since 0.1.0
 * @category errors
 */
export type ModelError =
  | PositionError
  | ReplaceError
  | ContentError
  | AttributeError
  | SchemaDefinitionError
  | JSONError

const modelErrorTags: ReadonlySet<string> = new Set([
  "PositionError",
  "ReplaceError",
  "ContentError",
  "AttributeError",
  "SchemaDefinitionError",
  "JSONError"
])

/**
 * @since 0.1.0
 * @category guards
 */
export const isModelError = (u: unknown): u is ModelError =>
  typeof u === "object" && u !== null && modelErrorTags.has((u as { _tag?: unknown })._tag as string)
