/**
 * List commands, ported from `prosemirror-schema-list`.
 *
 * Ported from prosemirror-schema-list (MIT, Marijn Haverbeke and others).
 *
 * @since 0.1.0
 */
import { done, keepMarks, syncCommand, type SyncResult } from "../commands/internal.ts"
import {
  type AnySchema,
  type Attrs,
  Fragment,
  type Node,
  type NodeAttrsInput,
  type NodeNames,
  NodeRange,
  type NodeType,
  Slice
} from "../model.ts"
import { type Command, type EditorState, Selection, type Transaction } from "../state.ts"
import { canJoin, canSplit, type NodeTypeWithAttrs, ReplaceAroundStep } from "../transform.ts"
import { findWrappingOrNull, liftTargetOrNull } from "../transform/structure.ts"

/**
 * Returns a command function that wraps the selection in a list with
 * the given type and attributes. If `dispatch` is not given, only
 * succeeds with a value indicating whether this is possible, without
 * performing the change.
 *
 * @since 0.1.0
 * @category commands
 */
export const wrapInList = <Sc extends AnySchema, N extends NodeNames<Sc>>(
  listType: NodeType<Sc, N>,
  attrs: NodeAttrsInput<Sc, N> | null = null
): Command<Sc> =>
  syncCommand<Sc>((state, dispatching) => {
    const { $from, $to } = state.selection
    const range = $from.blockRangeOrNull($to)
    if (!range) return false
    const tr = dispatching ? state.tr : null
    if (!wrapRangeInList(tr, range, listType, attrs)) return false
    return tr ? tr.scrollIntoView() : true
  })

/**
 * Try to wrap the given node range in a list of the given type. Return
 * `true` when this is possible, `false` otherwise. When `tr` is
 * non-null, the wrapping is added to that transaction. When it is
 * `null`, the function only queries whether the wrapping is possible.
 *
 * @since 0.1.0
 * @category transforms
 */
export function wrapRangeInList<Sc extends AnySchema, N extends NodeNames<Sc>>(
  tr: Transaction<Sc> | null,
  range: NodeRange<Sc>,
  listType: NodeType<Sc, N>,
  attrs: NodeAttrsInput<Sc, N> | null = null
): boolean {
  let doJoin = false, outerRange = range
  const doc = range.$from.doc
  // This is at the top of an existing list item
  if (
    range.depth >= 2 && range.$from.node(range.depth - 1).type.compatibleContent(listType) &&
    range.startIndex === 0
  ) {
    // Don't do anything if this is the top of the list
    if (range.$from.index(range.depth - 1) === 0) return false
    const $insert = doc.resolveUnsafe(range.start - 2)
    outerRange = new NodeRange($insert, $insert, range.depth)
    if (range.endIndex < range.parent.childCount) {
      range = new NodeRange(range.$from, doc.resolveUnsafe(range.$to.end(range.depth)), range.depth)
    }
    doJoin = true
  }
  const wrap = findWrappingOrNull(outerRange, listType, attrs as Attrs | null, range)
  if (!wrap) return false
  if (tr) doWrapInList(tr, range, wrap, doJoin, listType)
  return true
}

function doWrapInList(
  tr: Transaction<any>,
  range: NodeRange<any>,
  wrappers: ReadonlyArray<NodeTypeWithAttrs<any>>,
  joinBefore: boolean,
  listType: NodeType<any, any>
) {
  let content: Fragment<any> = Fragment.empty
  for (let i = wrappers.length - 1; i >= 0; i--) {
    content = Fragment.from(wrappers[i]!.type.createUnsafe(wrappers[i]!.attrs, content))
  }

  tr.stepUnsafe(
    new ReplaceAroundStep(
      range.start - (joinBefore ? 2 : 0),
      range.end,
      range.start,
      range.end,
      new Slice(content, 0, 0),
      wrappers.length,
      true
    )
  )

  let found = 0
  for (let i = 0; i < wrappers.length; i++) if (wrappers[i]!.type === listType) found = i + 1
  const splitDepth = wrappers.length - found

  let splitPos = range.start + wrappers.length - (joinBefore ? 2 : 0)
  const parent = range.parent
  for (let i = range.startIndex, e = range.endIndex, first = true; i < e; i++, first = false) {
    if (!first && canSplit(tr.doc, splitPos, splitDepth)) {
      tr.splitUnsafe(splitPos, splitDepth)
      splitPos += 2 * splitDepth
    }
    splitPos += parent.childUnsafe(i).nodeSize
  }
  return tr
}

/**
 * Build a command that splits a non-empty textblock at the top level of
 * a list item by also splitting that list item.
 *
 * @since 0.1.0
 * @category commands
 */
export const splitListItem = <Sc extends AnySchema, N extends NodeNames<Sc>>(
  itemType: NodeType<Sc, N>,
  itemAttrs?: NodeAttrsInput<Sc, N>
): Command<Sc> =>
  syncCommand<Sc>((state, dispatching) => {
    const sel = state.selection, { $from, $to } = sel
    const node = (sel as { node?: Node<any> }).node
    if ((node && node.isBlock) || $from.depth < 2 || !$from.sameParent($to)) return false
    const grandParent = $from.node(-1)
    if (grandParent.type !== itemType) return false
    if ($from.parent.content.size === 0 && $from.node(-1).childCount === $from.indexAfter(-1)) {
      // In an empty block. If this is a nested list, the wrapping
      // list item should be split. Otherwise, bail out and let next
      // command handle lifting.
      if (
        $from.depth === 3 || $from.node(-3).type !== itemType ||
        $from.index(-2) !== $from.node(-2).childCount - 1
      ) return false
      return done(dispatching, () => {
        let wrap: Fragment<any> = Fragment.empty
        const depthBefore = $from.index(-1) ? 1 : $from.index(-2) ? 2 : 3
        // Build a fragment containing empty versions of the structure
        // from the outer list item to the parent node of the cursor
        for (let d = $from.depth - depthBefore; d >= $from.depth - 3; d--) {
          wrap = Fragment.from($from.node(d).copy(wrap))
        }
        const depthAfter = $from.indexAfter(-1) < $from.node(-2).childCount ?
          1 :
          $from.indexAfter(-2) < $from.node(-3).childCount ?
          2 :
          3
        // Add a second list item with an empty default start node
        wrap = wrap.append(Fragment.from(itemType.createAndFillOrNull()))
        const start = $from.beforeUnsafe($from.depth - (depthBefore - 1))
        const tr = state.tr.replaceUnsafe(start, $from.afterUnsafe(-depthAfter), new Slice(wrap, 4 - depthBefore, 0))
        let sel = -1
        tr.doc.nodesBetween(start, tr.doc.content.size, (node, pos) => {
          if (sel > -1) return false
          if (node.isTextblock && node.content.size === 0) sel = pos + 1
        })
        if (sel > -1) tr.setSelectionUnsafe(Selection.near(tr.doc.resolveUnsafe(sel)))
        return tr.scrollIntoView()
      })
    }
    const nextType = $to.pos === $from.end() ? grandParent.contentMatchAtUnsafe(0).defaultTypeOrNull : null
    const tr = state.tr.deleteUnsafe($from.pos, $to.pos)
    const types: Array<NodeTypeWithAttrs<any> | null> | undefined = nextType ?
      [itemAttrs ? { type: itemType, attrs: itemAttrs } as NodeTypeWithAttrs<any> : null, { type: nextType }] :
      undefined
    if (!canSplit(tr.doc, $from.pos, 2, types)) return false
    return done(dispatching, () => tr.splitUnsafe($from.pos, 2, types).scrollIntoView())
  })

/**
 * Acts like `splitListItem`, but without resetting the set of active
 * marks at the cursor.
 *
 * @since 0.1.0
 * @category commands
 */
export const splitListItemKeepMarks = <Sc extends AnySchema, N extends NodeNames<Sc>>(
  itemType: NodeType<Sc, N>,
  itemAttrs?: NodeAttrsInput<Sc, N>
): Command<Sc> => {
  const split = splitListItem(itemType, itemAttrs)
  return (state, dispatch) => split(state, keepMarks(state, dispatch))
}

/**
 * Create a command to lift the list item around the selection up into
 * a wrapping list.
 *
 * @since 0.1.0
 * @category commands
 */
export const liftListItem = <Sc extends AnySchema, N extends NodeNames<Sc>>(itemType: NodeType<Sc, N>): Command<Sc> =>
  syncCommand<Sc>((state, dispatching): SyncResult<Sc> => {
    const { $from, $to } = state.selection
    const range = $from.blockRangeOrNull(
      $to,
      (node) => node.childCount > 0 && node.content.content[0]!.type === itemType
    )
    if (!range) return false
    if (!dispatching) return true
    if ($from.node(range.depth - 1).type === itemType) {
      // Inside a parent list
      return liftToOuterList(state, itemType, range) as SyncResult<Sc>
    } else {
      // Outer list node
      return liftOutOfList(state, range) as SyncResult<Sc>
    }
  })

function liftToOuterList(
  state: EditorState<any, any, any>,
  itemType: NodeType<any, any>,
  range: NodeRange<any>
): SyncResult {
  const tr = state.tr, end = range.end, endOfList = range.$to.end(range.depth)
  if (end < endOfList) {
    // There are siblings after the lifted items, which must become
    // children of the last item
    tr.stepUnsafe(
      new ReplaceAroundStep(
        end - 1,
        endOfList,
        end,
        endOfList,
        new Slice(Fragment.from(itemType.createUnsafe(null, range.parent.copy())), 1, 0),
        1,
        true
      )
    )
    range = new NodeRange(tr.doc.resolveUnsafe(range.$from.pos), tr.doc.resolveUnsafe(endOfList), range.depth)
  }
  const target = liftTargetOrNull(range)
  if (target == null) return false
  tr.liftUnsafe(range, target)
  const $after = tr.doc.resolveUnsafe(tr.mapping.map(end, -1) - 1)
  if (canJoin(tr.doc, $after.pos) && $after.nodeBeforeOrNull!.type === $after.nodeAfterOrNull!.type) {
    tr.joinUnsafe($after.pos)
  }
  return tr.scrollIntoView()
}

function liftOutOfList(state: EditorState<any, any, any>, range: NodeRange<any>): SyncResult {
  const tr = state.tr, list = range.parent
  // Merge the list items into a single big item
  for (let pos = range.end, i = range.endIndex - 1, e = range.startIndex; i > e; i--) {
    pos -= list.childUnsafe(i).nodeSize
    tr.deleteUnsafe(pos - 1, pos + 1)
  }
  const $start = tr.doc.resolveUnsafe(range.start), item = $start.nodeAfterOrNull!
  if (tr.mapping.map(range.end) !== range.start + item.nodeSize) return false
  const atStart = range.startIndex === 0, atEnd = range.endIndex === list.childCount
  const parent = $start.node(-1), indexBefore = $start.index(-1)
  if (
    !parent.canReplace(
      indexBefore + (atStart ? 0 : 1),
      indexBefore + 1,
      item.content.append(atEnd ? Fragment.empty : Fragment.from(list))
    )
  ) return false
  const start = $start.pos, end = start + item.nodeSize
  // Strip off the surrounding list. At the sides where we're not at
  // the end of the list, the existing list is closed. At sides where
  // this is the end, it is overwritten to its end.
  tr.stepUnsafe(
    new ReplaceAroundStep(
      start - (atStart ? 1 : 0),
      end + (atEnd ? 1 : 0),
      start + 1,
      end - 1,
      new Slice(
        (atStart ? Fragment.empty : Fragment.from(list.copy(Fragment.empty)))
          .append(atEnd ? Fragment.empty : Fragment.from(list.copy(Fragment.empty))),
        atStart ? 0 : 1,
        atEnd ? 0 : 1
      ),
      atStart ? 0 : 1
    )
  )
  return tr.scrollIntoView()
}

/**
 * Create a command to sink the list item around the selection down into
 * an inner list.
 *
 * @since 0.1.0
 * @category commands
 */
export const sinkListItem = <Sc extends AnySchema, N extends NodeNames<Sc>>(itemType: NodeType<Sc, N>): Command<Sc> =>
  syncCommand<Sc>((state, dispatching) => {
    const { $from, $to } = state.selection
    const range = $from.blockRangeOrNull(
      $to,
      (node) => node.childCount > 0 && node.content.content[0]!.type === itemType
    )
    if (!range) return false
    const startIndex = range.startIndex
    if (startIndex === 0) return false
    const parent = range.parent, nodeBefore = parent.childUnsafe(startIndex - 1)
    if (nodeBefore.type !== itemType) return false

    return done(dispatching, () => {
      const lastBefore = nodeBefore.content.content[nodeBefore.childCount - 1]
      const nestedBefore = !!lastBefore && lastBefore.type === parent.type
      const inner = Fragment.from(nestedBefore ? (itemType as NodeType<any, any>).createUnsafe() : null)
      const slice = new Slice(
        Fragment.from(
          (itemType as NodeType<any, any>).createUnsafe(null, Fragment.from(parent.type.createUnsafe(null, inner)))
        ),
        nestedBefore ? 3 : 1,
        0
      )
      const before = range.start, after = range.end
      return state.tr.stepUnsafe(
        new ReplaceAroundStep(before - (nestedBefore ? 3 : 1), after, before, after, slice, 1, true)
      ).scrollIntoView()
    })
  })
