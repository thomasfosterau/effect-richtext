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
import * as Schema from "effect/Schema"

/**
 * A position or index was outside of the valid range of a node or
 * fragment.
 *
 * @since 0.1.0
 * @category errors
 */
export class PositionError extends Schema.TaggedError<PositionError>()("PositionError", {
  message: Schema.String
}) {}

/**
 * Raised when a [`Slice`](#Slice) cannot be fitted into a document,
 * typically by `Node.replace`.
 *
 * @since 0.1.0
 * @category errors
 */
export class ReplaceError extends Schema.TaggedError<ReplaceError>()("ReplaceError", {
  message: Schema.String
}) {}

/**
 * Content that does not satisfy a node type's content expression or
 * mark restrictions.
 *
 * @since 0.1.0
 * @category errors
 */
export class ContentError extends Schema.TaggedError<ContentError>()("ContentError", {
  message: Schema.String
}) {}

/**
 * Missing, unknown, or invalid node or mark attributes.
 *
 * @since 0.1.0
 * @category errors
 */
export class AttributeError extends Schema.TaggedError<AttributeError>()("AttributeError", {
  message: Schema.String
}) {}

/**
 * A schema definition (or a content expression in it) is invalid.
 *
 * @since 0.1.0
 * @category errors
 */
export class SchemaDefinitionError extends Schema.TaggedError<SchemaDefinitionError>()("SchemaDefinitionError", {
  message: Schema.String
}) {}

/**
 * Raised when deserializing JSON that does not describe a valid
 * document structure for the schema.
 *
 * @since 0.1.0
 * @category errors
 */
export class JSONError extends Schema.TaggedError<JSONError>()("JSONError", {
  message: Schema.String
}) {}

/**
 * An invalid [`DOMOutputSpec`](#DOMOutputSpec) was passed to the DOM
 * serializer (for example a misplaced content hole, or an array taken
 * from an attribute value).
 *
 * @since 0.1.0
 * @category errors
 */
export class DOMSpecError extends Schema.TaggedError<DOMSpecError>()("DOMSpecError", {
  message: Schema.String
}) {}

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
  | DOMSpecError

const modelErrorTags: ReadonlySet<string> = new Set([
  "PositionError",
  "ReplaceError",
  "ContentError",
  "AttributeError",
  "SchemaDefinitionError",
  "JSONError",
  "DOMSpecError"
])

/**
 * @since 0.1.0
 * @category guards
 */
export const isModelError = (u: unknown): u is ModelError =>
  typeof u === "object" && u !== null && modelErrorTags.has((u as { _tag?: unknown })._tag as string)
