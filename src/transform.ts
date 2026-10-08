/**
 * Document transformations: steps, position mapping and the
 * `Transform` builder.
 *
 * Importing this module registers the built-in step types for JSON
 * deserialization.
 *
 * @since 0.1.0
 */

export * from "./transform/attr_step.ts"
export * from "./transform/errors.ts"
export * from "./transform/map.ts"
export * from "./transform/mark_step.ts"
export { replaceStep } from "./transform/replace.ts"
export * from "./transform/replace_step.ts"
export * from "./transform/step.ts"
export {
  canJoin,
  canSplit,
  dropPoint,
  findWrapping,
  insertPoint,
  joinPoint,
  liftTarget,
  type NodeTypeWithAttrs
} from "./transform/structure.ts"
export * from "./transform/transform.ts"
