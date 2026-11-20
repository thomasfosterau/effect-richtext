/**
 * The editor view: renders an editor state to the DOM and turns DOM
 * events into transactions. Includes decorations, node views and mark
 * views.
 *
 * @since 0.1.0
 */

/** @since 0.1.0 */
export * from "./view/decoration.ts"
export type {
  /** @since 0.1.0 */
  Rect,
  /** @since 0.1.0 */
  TextblockDir
} from "./view/domcoords.ts"
/** @since 0.1.0 */
export * from "./view/errors.ts"
/** @since 0.1.0 */
export * from "./view/view.ts"
export type {
  /** @since 0.1.0 */
  MarkView,
  /** @since 0.1.0 */
  MarkViewConstructor,
  /** @since 0.1.0 */
  NodeView,
  /** @since 0.1.0 */
  NodeViewConstructor,
  /** @since 0.1.0 */
  ViewMutationRecord
} from "./view/viewdesc.ts"
