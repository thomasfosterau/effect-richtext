/**
 * Pure state selectors used by the reactive streams.
 *
 * @since 0.1.0
 */
import * as Predicate from "effect/Predicate"
import { type AnySchema, AttributeError, type Attrs, ContentError, type MarkType, type NodeType } from "../model.ts"
import { type EditorState, NodeSelection } from "../state.ts"

const markTypeOf = (state: EditorState<any, any, any>, type: MarkType<any, any> | string): MarkType<any, any> => {
  if (!Predicate.isString(type)) return type
  const markType = state.schema.marks[type] as MarkType<any, any> | undefined
  if (!markType) throw new AttributeError({ message: "Unknown mark type " + type })
  return markType
}

const nodeTypeOf = (state: EditorState<any, any, any>, type: NodeType<any, any> | string): NodeType<any, any> => {
  if (!Predicate.isString(type)) return type
  const nodeType = state.schema.nodes[type] as NodeType<any, any> | undefined
  if (!nodeType) throw new ContentError({ message: "Unknown node type " + type })
  return nodeType
}

const attrsMatch = (attrs: Attrs, expected: Attrs | undefined): boolean => {
  if (!expected) return true
  for (const name in expected) if (attrs[name] !== expected[name]) return false
  return true
}

/**
 * Whether a mark of the given type is active: for an empty selection, it
 * is in the stored marks (or the marks at the cursor); otherwise it is
 * present somewhere in one of the selection's ranges.
 *
 * @since 0.1.0
 * @category selectors
 */
export const isMarkActive = <Sc extends AnySchema>(
  state: EditorState<Sc, any, any>,
  type: MarkType<Sc, any> | string
): boolean => {
  const markType = markTypeOf(state, type)
  const { empty, $from, ranges } = state.selection
  if (empty) return markType.findInSet(state.storedMarksOrNull || $from.marks()) !== undefined
  for (const range of ranges) {
    if (state.doc.rangeHasMark(range.$from.pos, range.$to.pos, markType)) return true
  }
  return false
}

/**
 * Whether a node of the given type (with the given attributes, when
 * provided) is selected (as a node selection) or wraps the start of the
 * selection.
 *
 * @since 0.1.0
 * @category selectors
 */
export const isNodeActive = <Sc extends AnySchema>(
  state: EditorState<Sc, any, any>,
  type: NodeType<Sc, any> | string,
  attrs?: Attrs
): boolean => {
  const nodeType = nodeTypeOf(state, type)
  const { selection } = state
  if (selection instanceof NodeSelection && selection.node.type === nodeType) {
    return attrsMatch(selection.node.attrs, attrs)
  }
  const { $from, to } = selection
  for (let d = $from.depth; d >= 0; d--) {
    const node = $from.node(d)
    if (node.type === nodeType && to <= $from.end(d) && attrsMatch(node.attrs, attrs)) return true
  }
  return false
}
