/**
 * List commands, ported from `prosemirror-schema-list`.
 *
 * Ported from prosemirror-schema-list (MIT, Marijn Haverbeke and others).
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import { done, keepMarks, syncCommand, type SyncResult } from "../commands/internal.ts"
import {
  type AnySchema,
  Fragment,
  type NodeAttrsInput,
  type NodeNames,
  NodeRange,
  type NodeType,
  Slice
} from "../Model.ts"
import { type Command, type EditorState, NodeSelection, Selection, type Transaction } from "../State.ts"
import { canJoin, canSplit, findWrapping, liftTarget, type NodeTypeWithAttrs, ReplaceAroundStep } from "../Transform.ts"

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
  attrs?: NodeAttrsInput<Sc, N>
): Command<Sc> =>
  syncCommand<Sc>((state, dispatching) => {
    const { $from, $to } = state.selection
    const range = $from.blockRange($to)
    if (Option.isNone(range)) return false
    const tr = dispatching ? Option.some(state.tr) : Option.none()
    if (!wrapRangeInList(tr, range.value, listType, attrs)) return false
    return Option.isSome(tr) ? tr.value.scrollIntoView() : true
  })

/**
 * Try to wrap the given node range in a list of the given type. Return
 * `true` when this is possible, `false` otherwise. When `tr` holds a
 * transaction, the wrapping is added to it. When it is `None`, the
 * function only queries whether the wrapping is possible.
 *
 * @since 0.1.0
 * @category transforms
 */
export function wrapRangeInList<Sc extends AnySchema, N extends NodeNames<Sc>>(
  tr: Option.Option<Transaction<Sc>>,
  range: NodeRange<Sc>,
  listType: NodeType<Sc, N>,
  attrs?: NodeAttrsInput<Sc, N>
): boolean {
  let doJoin = false,
    outerRange = range
  const doc = range.$from.doc
  // This is at the top of an existing list item
  if (
    range.depth >= 2 &&
    range.$from.node(range.depth - 1).type.compatibleContent(listType) &&
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
  const wrap = findWrapping(outerRange, listType, attrs, range)
  if (Option.isNone(wrap)) return false
  if (Option.isSome(tr)) doWrapInList(tr.value, range, wrap.value, doJoin, listType)
  return true
}

function doWrapInList(
  tr: Transaction<any>,
  range: NodeRange<any>,
  wrappers: ReadonlyArray<NodeTypeWithAttrs<any>>,
  joinBefore: boolean,
  listType: NodeType<any, any>
) {
  const content = wrappers.reduceRight(
    (inner: Fragment<any>, wrapper) => Fragment.from(wrapper.type.createUnsafe(wrapper.attrs, inner)),
    Fragment.empty
  )

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

  const found = Option.match(
    Arr.findLastIndex(wrappers, (wrapper) => wrapper.type === listType),
    { onNone: () => 0, onSome: (i) => i + 1 }
  )
  const splitDepth = wrappers.length - found

  let splitPos = range.start + wrappers.length - (joinBefore ? 2 : 0)
  range.parent.content.content.slice(range.startIndex, range.endIndex).forEach((child, i) => {
    if (i > 0 && splitDepth && canSplit(tr.doc, splitPos, splitDepth)) {
      tr.splitUnsafe(splitPos, splitDepth)
      splitPos += 2 * splitDepth
    }
    splitPos += child.nodeSize
  })
  return tr
}

/**
 * The list item type(s) a list command acts on: one node type, or
 * several for lists that mix kinds of items (prosemirror-schema-list
 * 1.6.0).
 *
 * @since 0.1.0
 * @category models
 */
export type ItemTypes<Sc extends AnySchema, N extends NodeNames<Sc>> = NodeType<Sc, N> | ReadonlyArray<NodeType<Sc, N>>

const isItem = (itemType: ItemTypes<any, any>, type: NodeType<any, any>): boolean =>
  Array.isArray(itemType) ? itemType.indexOf(type) > -1 : type === itemType

// The block range around the selection whose parent is a list (its first
// child is one of the item types).
const itemRange = (state: EditorState<any, any, any>, itemType: ItemTypes<any, any>) => {
  const { $from, $to } = state.selection
  return $from.blockRange($to, (node) => Option.exists(node.firstChild, (first) => isItem(itemType, first.type)))
}

/**
 * Build a command that splits a non-empty textblock at the top level of
 * a list item by also splitting that list item.
 *
 * @since 0.1.0
 * @category commands
 */
export const splitListItem = <Sc extends AnySchema, N extends NodeNames<Sc>>(
  itemType: ItemTypes<Sc, N>,
  itemAttrs?: NodeAttrsInput<Sc, N>
): Command<Sc> =>
  syncCommand<Sc>((state, dispatching) => {
    const sel = state.selection,
      { $from, $to } = sel
    const node = sel instanceof NodeSelection ? sel.node : undefined
    if ((node && node.isBlock) || $from.depth < 2 || !$from.sameParent($to)) return false
    const grandParent = $from.node(-1)
    if (!isItem(itemType, grandParent.type)) return false
    if ($from.parent.content.size === 0 && $from.node(-1).childCount === $from.indexAfter(-1)) {
      // In an empty block. If this is a nested list, the wrapping
      // list item should be split. Otherwise, bail out and let next
      // command handle lifting.
      if (
        $from.depth === 3 ||
        !isItem(itemType, $from.node(-3).type) ||
        $from.index(-2) !== $from.node(-2).childCount - 1
      )
        return false
      return done(dispatching, () => {
        const depthBefore = $from.index(-1) ? 1 : $from.index(-2) ? 2 : 3
        // Build a fragment containing empty versions of the structure
        // from the outer list item to the parent node of the cursor
        let wrap = Arr.reverse(Arr.range($from.depth - 3, $from.depth - depthBefore)).reduce(
          (inner: Fragment<any>, d) => Fragment.from($from.node(d).copy(inner)),
          Fragment.empty
        )
        const depthAfter =
          $from.indexAfter(-1) < $from.node(-2).childCount
            ? 1
            : $from.indexAfter(-2) < $from.node(-3).childCount
              ? 2
              : 3
        // Add a second list item with an empty default start node
        wrap = wrap.append(Fragment.from(Option.getOrUndefined($from.node(-3).type.createAndFillOption())))
        const start = $from.beforeUnsafe($from.depth - (depthBefore - 1))
        const tr = state.tr.replaceUnsafe(start, $from.afterUnsafe(-depthAfter), new Slice(wrap, 4 - depthBefore, 0))
        let cursor = -1
        tr.doc.nodesBetween(start, tr.doc.content.size, (child, pos) => {
          if (cursor > -1) return false
          if (child.isTextblock && child.content.size === 0) cursor = pos + 1
          return true
        })
        if (cursor > -1) tr.setSelectionUnsafe(Selection.near(tr.doc.resolveUnsafe(cursor)))
        return tr.scrollIntoView()
      })
    }
    const nextType = $to.pos === $from.end() ? grandParent.contentMatchAtUnsafe(0).defaultType : Option.none()
    const tr = state.tr.deleteUnsafe($from.pos, $to.pos)
    const types: ReadonlyArray<Option.Option<NodeTypeWithAttrs<any>>> = Option.isSome(nextType)
      ? [
          itemAttrs ? Option.some({ type: grandParent.type, attrs: itemAttrs }) : Option.none(),
          Option.some({ type: nextType.value })
        ]
      : []
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
  itemType: ItemTypes<Sc, N>,
  itemAttrs?: NodeAttrsInput<Sc, N>
): Command<Sc> => {
  return keepMarks(splitListItem(itemType, itemAttrs))
}

/**
 * Create a command to lift the list item around the selection up into
 * a wrapping list.
 *
 * @since 0.1.0
 * @category commands
 */
export const liftListItem = <Sc extends AnySchema, N extends NodeNames<Sc>>(itemType: ItemTypes<Sc, N>): Command<Sc> =>
  syncCommand<Sc>((state, dispatching): SyncResult<Sc> => {
    const { $from } = state.selection
    const found = itemRange(state, itemType)
    if (Option.isNone(found)) return false
    if (!dispatching) return true
    const range = found.value
    if (isItem(itemType, $from.node(range.depth - 1).type)) {
      // Inside a parent list
      return liftToOuterList(state, range)
    } else {
      // Outer list node
      return liftOutOfList(state, range)
    }
  })

function liftToOuterList<Sc extends AnySchema>(state: EditorState<Sc, any, any>, range: NodeRange<Sc>): SyncResult<Sc> {
  const tr = state.tr,
    end = range.end,
    endOfList = range.$to.end(range.depth)
  const itemType = range.parent.childUnsafe(range.endIndex - 1).type
  if (end < endOfList) {
    // There are siblings after the lifted items, which must become
    // children of the last item
    tr.stepUnsafe(
      new ReplaceAroundStep(
        end - 1,
        endOfList,
        end,
        endOfList,
        new Slice(Fragment.from(itemType.createUnsafe(undefined, range.parent.copy())), 1, 0),
        1,
        true
      )
    )
    range = new NodeRange(tr.doc.resolveUnsafe(range.$from.pos), tr.doc.resolveUnsafe(endOfList), range.depth)
  }
  const target = liftTarget(range)
  if (Option.isNone(target)) return false
  tr.liftUnsafe(range, target.value)
  const $after = tr.doc.resolveUnsafe(tr.mapping.map(end, -1) - 1)
  if (
    canJoin(tr.doc, $after.pos) &&
    Option.getOrUndefined($after.nodeBefore)?.type === Option.getOrUndefined($after.nodeAfter)?.type
  ) {
    tr.joinUnsafe($after.pos)
  }
  return tr.scrollIntoView()
}

function liftOutOfList<Sc extends AnySchema>(state: EditorState<Sc, any, any>, range: NodeRange<Sc>): SyncResult<Sc> {
  const tr = state.tr,
    list = range.parent
  // Merge the list items into a single big item
  list.content.content.slice(range.startIndex + 1, range.endIndex).reduceRight((end, child) => {
    const pos = end - child.nodeSize
    tr.deleteUnsafe(pos - 1, pos + 1)
    return pos
  }, range.end)
  const $start = tr.doc.resolveUnsafe(range.start)
  const itemFound = $start.nodeAfter
  if (Option.isNone(itemFound)) return false
  const item = itemFound.value
  if (tr.mapping.map(range.end) !== range.start + item.nodeSize) return false
  const atStart = range.startIndex === 0,
    atEnd = range.endIndex === list.childCount
  const parent = $start.node(-1),
    indexBefore = $start.index(-1)
  if (
    !parent.canReplace(
      indexBefore + (atStart ? 0 : 1),
      indexBefore + 1,
      item.content.append(atEnd ? Fragment.empty : Fragment.from(list))
    )
  )
    return false
  const start = $start.pos,
    end = start + item.nodeSize
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
        (atStart ? Fragment.empty : Fragment.from(list.copy(Fragment.empty))).append(
          atEnd ? Fragment.empty : Fragment.from(list.copy(Fragment.empty))
        ),
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
export const sinkListItem = <Sc extends AnySchema, N extends NodeNames<Sc>>(itemType: ItemTypes<Sc, N>): Command<Sc> =>
  syncCommand<Sc>((state, dispatching) => {
    const found = itemRange(state, itemType)
    if (Option.isNone(found)) return false
    const range = found.value
    const startIndex = range.startIndex
    if (startIndex === 0) return false
    const parent = range.parent,
      nodeBefore = parent.childUnsafe(startIndex - 1)
    if (!isItem(itemType, nodeBefore.type)) return false

    return done(dispatching, () => {
      const nested = Option.filter(nodeBefore.lastChild, (last) => last.type === parent.type)
      const nestedBefore = Option.isSome(nested)
      const nestedItem = Option.flatMap(nested, (list) => list.lastChild)
      const inner = Fragment.from(
        // SAFETY: the nested item's type is a node type of this schema.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        Option.isSome(nestedItem) ? (nestedItem.value.type as NodeType<any, any>).createUnsafe() : undefined
      )
      // SAFETY: the item's type is a node type of this schema.
      const slice = new Slice(
        Fragment.from(
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion
          (nodeBefore.type as NodeType<any, any>).createUnsafe(
            undefined,
            Fragment.from(parent.type.createUnsafe(undefined, inner))
          )
        ),
        nestedBefore ? 3 : 1,
        0
      )
      const before = range.start,
        after = range.end
      return state.tr
        .stepUnsafe(new ReplaceAroundStep(before - (nestedBefore ? 3 : 1), after, before, after, slice, 1, true))
        .scrollIntoView()
    })
  })
