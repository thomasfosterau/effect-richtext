/**
 * The editor view: renders an editor state to the DOM and turns DOM
 * events into transactions. Includes decorations, node views and mark
 * views.
 *
 * @since 0.1.0
 */

export * from "./view/decoration.ts"
export type { Rect, TextblockDir } from "./view/domcoords.ts"
export * from "./view/errors.ts"
export * from "./view/view.ts"
export type {
  MarkView,
  MarkViewConstructor,
  NodeView,
  NodeViewConstructor,
  ViewMutationRecord
} from "./view/viewdesc.ts"
