/**
 * Tagged errors raised by the transform layer.
 *
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"
import { isModelError, type ModelError } from "../model/errors.ts"

/**
 * An invalid transform operation, such as wrapping content in node
 * types that can not contain it, splitting where splitting is not
 * allowed, or addressing a position that holds no node. Corresponds to
 * the `TransformError`/`RangeError`s thrown by ProseMirror's transform
 * methods.
 *
 * @since 0.1.0
 * @category errors
 */
export class TransformError extends Schema.TaggedError<TransformError>()("TransformError", {
  message: Schema.String
}) {}

/**
 * A step could not be applied to a document. The `message` is the
 * step's failure message (see `StepResult.failed`).
 *
 * @since 0.1.0
 * @category errors
 */
export class StepError extends Schema.TaggedError<StepError>()("StepError", {
  message: Schema.String
}) {}

/**
 * Union of the errors defined by the transform layer.
 *
 * @since 0.1.0
 * @category errors
 */
export type TransformFailure = TransformError | StepError

/**
 * @since 0.1.0
 * @category guards
 */
export const isTransformFailure = (u: unknown): u is TransformFailure =>
  u instanceof TransformError || u instanceof StepError

/**
 * Errors that can be produced by transform operations: the transform
 * layer's own errors plus model errors.
 *
 * @since 0.1.0
 * @category errors
 */
export type TransformOrModelError = TransformFailure | ModelError

/** @internal */
export const isTransformOrModelError = (u: unknown): u is TransformOrModelError =>
  isTransformFailure(u) || isModelError(u)
