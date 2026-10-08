/**
 * Document transformations: steps, position mapping and the
 * `Transform` builder.
 *
 * Importing this module registers the built-in step types for JSON
 * deserialization.
 *
 * @since 0.1.0
 */

/** @since 0.1.0 */
export * from "./transform/attr_step.ts"
/** @since 0.1.0 */
export * from "./transform/errors.ts"
/** @since 0.1.0 */
export * from "./transform/map.ts"
/** @since 0.1.0 */
export * from "./transform/mark_step.ts"
export {
  /** @since 0.1.0 */
  replaceStep
} from "./transform/replace.ts"
/** @since 0.1.0 */
export * from "./transform/replace_step.ts"
/** @since 0.1.0 */
export * from "./transform/step.ts"
export {
  /** @since 0.1.0 */
  canJoin,
  /** @since 0.1.0 */
  canSplit,
  /** @since 0.1.0 */
  dropPoint,
  /** @since 0.1.0 */
  findWrapping,
  /** @since 0.1.0 */
  insertPoint,
  /** @since 0.1.0 */
  joinPoint,
  /** @since 0.1.0 */
  liftTarget,
  /** @since 0.1.0 */
  type NodeTypeWithAttrs
} from "./transform/structure.ts"
/** @since 0.1.0 */
export * from "./transform/transform.ts"
