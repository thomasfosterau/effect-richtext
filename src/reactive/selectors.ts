/**
 * Pure state selectors used by the reactive streams.
 *
 * @since 0.1.0
 */
import * as Option from "effect/Option"
import * as Arr from "effect/Array"
import * as Predicate from "effect/Predicate"
import * as Rec from "effect/Record"
import { type AnySchema, AttributeError, type Attrs, ContentError, type MarkType, type NodeType } from "../Model.ts"
import { type EditorState, NodeSelection } from "../State.ts"

const markTypeOf = (state: EditorState<any, any, any>, type: MarkType<any, any> | string): MarkType<any, any> => {
  if (!Predicate.isString(type)) return type
  const markType: Option.Option<MarkType<any, any>> = Option.fromNullishOr(state.schema.marks[type])
  return Option.getOrThrowWith(markType, () => new AttributeError({ message: "Unknown mark type " + type }))
}

const nodeTypeOf = (state: EditorState<any, any, any>, type: NodeType<any, any> | string): NodeType<any, any> => {
  if (!Predicate.isString(type)) return type
  const nodeType: Option.Option<NodeType<any, any>> = Option.fromNullishOr(state.schema.nodes[type])
  return Option.getOrThrowWith(nodeType, () => new ContentError({ message: "Unknown node type " + type }))
}

const attrsMatch = (attrs: Attrs, expected: Attrs | undefined): boolean => {
  if (!expected) return true
  return Rec.toEntries(expected).every(([name, value]) => attrs[name] === value)
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
  return ranges.some((range) => state.doc.rangeHasMark(range.$from.pos, range.$to.pos, markType))
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
  return Arr.range(0, $from.depth).some((d) => {
    const node = $from.node(d)
    return node.type === nodeType && to <= $from.end(d) && attrsMatch(node.attrs, attrs)
  })
}
