/**
 * Editing commands, ported from `prosemirror-commands`.
 *
 * Ported from prosemirror-commands (MIT, Marijn Haverbeke and others).
 *
 * @since 0.1.0
 */
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import {
  type AnySchema,
  type ContentMatch,
  Fragment,
  type MarkAttrsInput,
  type MarkNames,
  type MarkType,
  type Node,
  type NodeAttrsInput,
  type NodeNames,
  type NodeType,
  type ResolvedPos,
  Slice,
  type TextNode
} from "../model.ts"
import {
  AllSelection,
  type Command,
  type Dispatch,
  type EditorState,
  type EditorViewLike,
  NodeSelection,
  Selection,
  SelectionRange,
  TextSelection,
  type Transaction
} from "../state.ts"
import { canJoin, canSplit, joinPoint, type NodeTypeWithAttrs, ReplaceAroundStep, ReplaceStep } from "../transform.ts"
import { replaceStepOrNull } from "../transform/replace.ts"
import { findWrappingOrNull, liftTargetOrNull } from "../transform/structure.ts"
import { done, keepMarks, succeedFalse, succeedTrue, syncCommand, type SyncResult } from "./internal.ts"

// -----------------------------------------------------------------------------
// View interface
// -----------------------------------------------------------------------------

/**
 * A text direction or vertical direction, as passed to
 * `TextblockBoundaryView.endOfTextblock`.
 *
 * @since 0.1.0
 * @category models
 */
export type TextblockBoundaryDirection = "up" | "down" | "left" | "right" | "forward" | "backward"

/**
 * The part of an editor view used by commands that need accurate
 * (bidi-aware) detection of textblock boundaries (`joinBackward`,
 * `joinForward`, `selectNodeBackward`, `selectNodeForward`, …). When
 * the view passed to such a command doesn't implement this interface,
 * the command falls back to checking the cursor's offset in its parent.
 *
 * @since 0.1.0
 * @category models
 */
export interface TextblockBoundaryView {
  /**
   * Whether the selection (in the given state, or the view's current
   * state) is at the end of its textblock in the given direction.
   */
  readonly endOfTextblock: (dir: TextblockBoundaryDirection, state?: EditorState<any, any, any>) => boolean
}

/**
 * Check whether a view implements `TextblockBoundaryView`.
 *
 * @since 0.1.0
 * @category guards
 */
export const isTextblockBoundaryView = (view: unknown): view is TextblockBoundaryView =>
  typeof view === "object" &&
  view !== null &&
  typeof (view as { endOfTextblock?: unknown }).endOfTextblock === "function"

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

const cursorOf = <Sc extends AnySchema>(state: EditorState<Sc, any, any>): ResolvedPos<Sc> | null => {
  const sel = state.selection
  return sel instanceof TextSelection ? sel.$cursorOrNull : null
}

const firstChildOf = (node: Node<any>): Node<any> | undefined => node.content.content[0]
const lastChildOf = (node: Node<any>): Node<any> | undefined => node.content.content[node.childCount - 1]

function atBlockStart(state: EditorState<any, any, any>, view: EditorViewLike): ResolvedPos<any> | null {
  const $cursor = cursorOf(state)
  if (!$cursor || (isTextblockBoundaryView(view) ? !view.endOfTextblock("backward", state) : $cursor.parentOffset > 0))
    return null
  return $cursor
}

function atBlockEnd(state: EditorState<any, any, any>, view: EditorViewLike): ResolvedPos<any> | null {
  const $cursor = cursorOf(state)
  if (
    !$cursor ||
    (isTextblockBoundaryView(view)
      ? !view.endOfTextblock("forward", state)
      : $cursor.parentOffset < $cursor.parent.content.size)
  )
    return null
  return $cursor
}

function findCutBefore($pos: ResolvedPos<any>): ResolvedPos<any> | null {
  if (!$pos.parent.type.spec.isolating) {
    for (let i = $pos.depth - 1; i >= 0; i--) {
      if ($pos.index(i) > 0) return $pos.doc.resolveUnsafe($pos.beforeUnsafe(i + 1))
      if ($pos.node(i).type.spec.isolating) break
    }
  }
  return null
}

function findCutAfter($pos: ResolvedPos<any>): ResolvedPos<any> | null {
  if (!$pos.parent.type.spec.isolating) {
    for (let i = $pos.depth - 1; i >= 0; i--) {
      const parent = $pos.node(i)
      if ($pos.index(i) + 1 < parent.childCount) return $pos.doc.resolveUnsafe($pos.afterUnsafe(i + 1))
      if (parent.type.spec.isolating) break
    }
  }
  return null
}

function textblockAt(node: Node<any>, side: "start" | "end", only = false): boolean {
  for (let scan: Node<any> | undefined = node; scan; scan = side === "start" ? firstChildOf(scan) : lastChildOf(scan)) {
    if (scan.isTextblock) return true
    if (only && scan.childCount !== 1) return false
  }
  return false
}

function isDeletingStep(step: unknown): step is ReplaceStep<any> {
  const s = step as ReplaceStep<any>
  return s.slice.size < s.to - s.from
}

function defaultBlockAt(match: ContentMatch): NodeType<any, any> | null {
  for (let i = 0; i < match.edgeCount; i++) {
    const { type } = match.next[i]!
    if (type.isTextblock && !type.hasRequiredAttrs()) return type
  }
  return null
}

function joinTextblocksAround(state: EditorState<any, any, any>, $cut: ResolvedPos<any>, dispatching: boolean) {
  const before = $cut.nodeBeforeOrNull!
  let beforeText = before,
    beforePos = $cut.pos - 1
  for (; !beforeText.isTextblock; beforePos--) {
    if (beforeText.type.spec.isolating) return false
    const child = lastChildOf(beforeText)
    if (!child) return false
    beforeText = child
  }
  const after = $cut.nodeAfterOrNull!
  let afterText = after,
    afterPos = $cut.pos + 1
  for (; !afterText.isTextblock; afterPos++) {
    if (afterText.type.spec.isolating) return false
    const child = firstChildOf(afterText)
    if (!child) return false
    afterText = child
  }
  const step = replaceStepOrNull(state.doc, beforePos, afterPos, Slice.empty) as ReplaceStep<any> | null
  if (!step || step.from !== beforePos || (step instanceof ReplaceStep && step.slice.size >= afterPos - beforePos))
    return false
  return done(dispatching, () => {
    const tr = state.tr.stepUnsafe(step)
    tr.setSelectionUnsafe(TextSelection.createUnsafe(tr.doc, beforePos))
    return tr.scrollIntoView()
  })
}

function joinMaybeClear(state: EditorState<any, any, any>, $pos: ResolvedPos<any>, dispatching: boolean): SyncResult {
  const before = $pos.nodeBeforeOrNull,
    after = $pos.nodeAfterOrNull,
    index = $pos.index()
  if (!before || !after || !before.type.compatibleContent(after.type)) return false
  if (!before.content.size && $pos.parent.canReplace(index - 1, index)) {
    return done(dispatching, () => state.tr.deleteUnsafe($pos.pos - before.nodeSize, $pos.pos).scrollIntoView())
  }
  if (!$pos.parent.canReplace(index, index + 1) || !(after.isTextblock || canJoin(state.doc, $pos.pos))) {
    return false
  }
  return done(dispatching, () => state.tr.joinUnsafe($pos.pos).scrollIntoView())
}

function deleteBarrier(
  state: EditorState<any, any, any>,
  $cut: ResolvedPos<any>,
  dispatching: boolean,
  dir: number
): SyncResult {
  const before = $cut.nodeBeforeOrNull!,
    after = $cut.nodeAfterOrNull!
  let conn: ReadonlyArray<NodeType<any, any>> | null, match: ContentMatch
  const isolated = before.type.spec.isolating || after.type.spec.isolating
  if (!isolated) {
    const joined = joinMaybeClear(state, $cut, dispatching)
    if (joined !== false) return joined
  }

  const canDelAfter = !isolated && $cut.parent.canReplace($cut.index(), $cut.index() + 1)
  if (
    canDelAfter &&
    (conn = (match = before.contentMatchAtUnsafe(before.childCount)).findWrappingOrNull(after.type)) &&
    match.matchTypeOrNull(conn[0] || after.type)!.validEnd
  ) {
    const wrappers = conn
    return done(dispatching, () => {
      const end = $cut.pos + after.nodeSize
      let wrap: Fragment<any> = Fragment.empty
      for (let i = wrappers.length - 1; i >= 0; i--) wrap = Fragment.from(wrappers[i]!.createUnsafe(null, wrap))
      wrap = Fragment.from(before.copy(wrap))
      const tr = state.tr.stepUnsafe(
        new ReplaceAroundStep($cut.pos - 1, end, $cut.pos, end, new Slice(wrap, 1, 0), wrappers.length, true)
      )
      const $joinAt = tr.doc.resolveUnsafe(end + 2 * wrappers.length)
      const joinAfter = $joinAt.nodeAfterOrNull
      if (joinAfter && joinAfter.type === before.type && canJoin(tr.doc, $joinAt.pos)) tr.joinUnsafe($joinAt.pos)
      return tr.scrollIntoView()
    })
  }

  const selAfter = after.type.spec.isolating || (dir > 0 && isolated) ? null : Selection.findFromOrNull($cut, 1)
  const range = selAfter && selAfter.$from.blockRangeOrNull(selAfter.$to)
  const target = range && liftTargetOrNull(range)
  if (target != null && target >= $cut.depth) {
    return done(dispatching, () => state.tr.liftUnsafe(range!, target).scrollIntoView())
  }

  if (canDelAfter && textblockAt(after, "start", true) && textblockAt(before, "end")) {
    let at = before
    const wrap: Array<Node<any>> = []
    for (;;) {
      wrap.push(at)
      if (at.isTextblock) break
      at = lastChildOf(at)!
    }
    let afterText = after,
      afterDepth = 1
    for (; !afterText.isTextblock; afterText = firstChildOf(afterText)!) afterDepth++
    if (at.canReplace(at.childCount, at.childCount, afterText.content)) {
      return done(dispatching, () => {
        let end: Fragment<any> = Fragment.empty
        for (let i = wrap.length - 1; i >= 0; i--) end = Fragment.from(wrap[i]!.copy(end))
        const tr = state.tr.stepUnsafe(
          new ReplaceAroundStep(
            $cut.pos - wrap.length,
            $cut.pos + after.nodeSize,
            $cut.pos + afterDepth,
            $cut.pos + after.nodeSize - afterDepth,
            new Slice(end, wrap.length, 0),
            0,
            true
          )
        )
        return tr.scrollIntoView()
      })
    }
  }

  return false
}

// -----------------------------------------------------------------------------
// Commands
// -----------------------------------------------------------------------------

/**
 * Delete the selection, if there is one.
 *
 * @since 0.1.0
 * @category commands
 */
export const deleteSelection: Command = syncCommand((state, dispatching) => {
  if (state.selection.empty) return false
  return done(dispatching, () => state.tr.deleteSelection().scrollIntoView())
})

/**
 * If the selection is empty and at the start of a textblock, try to
 * reduce the distance between that block and the one before it—if
 * there's a block directly before it that can be joined, join them.
 * If not, try to move the selected block closer to the next one in
 * the document structure by lifting it out of its parent or moving it
 * into a parent of the previous block. Will use the view for accurate
 * (bidi-aware) start-of-textblock detection if given (see
 * `TextblockBoundaryView`).
 *
 * @since 0.1.0
 * @category commands
 */
export const joinBackward: Command = syncCommand((state, dispatching, view) => {
  const $cursor = atBlockStart(state, view)
  if (!$cursor) return false

  const $cut = findCutBefore($cursor)

  // If there is no node before this, try to lift
  if (!$cut) {
    const range = $cursor.blockRangeOrNull(),
      target = range && liftTargetOrNull(range)
    if (target == null) return false
    return done(dispatching, () => state.tr.liftUnsafe(range!, target).scrollIntoView())
  }

  const before = $cut.nodeBeforeOrNull!
  // Apply the joining algorithm
  const barrier = deleteBarrier(state, $cut, dispatching, -1)
  if (barrier !== false) return barrier

  // If the node below has no content and the node above is
  // selectable, delete the node below and select the one above.
  if ($cursor.parent.content.size === 0 && (textblockAt(before, "end") || NodeSelection.isSelectable(before))) {
    for (let depth = $cursor.depth; ; depth--) {
      const delStep = replaceStepOrNull(state.doc, $cursor.beforeUnsafe(depth), $cursor.afterUnsafe(depth))
      if (delStep && isDeletingStep(delStep)) {
        return done(dispatching, () => {
          const tr = state.tr.stepUnsafe(delStep)
          tr.setSelectionUnsafe(
            textblockAt(before, "end")
              ? Selection.findFromOrNull(tr.doc.resolveUnsafe(tr.mapping.map($cut.pos, -1)), -1)!
              : NodeSelection.createUnsafe(tr.doc, $cut.pos - before.nodeSize)
          )
          return tr.scrollIntoView()
        })
      }
      if (depth === 1 || $cursor.node(depth - 1).childCount > 1) break
    }
  }

  // If the node before is an atom, delete it
  if (before.isAtom && $cut.depth === $cursor.depth - 1) {
    return done(dispatching, () => state.tr.deleteUnsafe($cut.pos - before.nodeSize, $cut.pos).scrollIntoView())
  }

  return false
})

/**
 * A more limited form of `joinBackward` that only tries to join the
 * current textblock to the one before it, if the cursor is at the start
 * of a textblock.
 *
 * @since 0.1.0
 * @category commands
 */
export const joinTextblockBackward: Command = syncCommand((state, dispatching, view) => {
  const $cursor = atBlockStart(state, view)
  if (!$cursor) return false
  const $cut = findCutBefore($cursor)
  return $cut ? joinTextblocksAround(state, $cut, dispatching) : false
})

/**
 * A more limited form of `joinForward` that only tries to join the
 * current textblock to the one after it, if the cursor is at the end of
 * a textblock.
 *
 * @since 0.1.0
 * @category commands
 */
export const joinTextblockForward: Command = syncCommand((state, dispatching, view) => {
  const $cursor = atBlockEnd(state, view)
  if (!$cursor) return false
  const $cut = findCutAfter($cursor)
  return $cut ? joinTextblocksAround(state, $cut, dispatching) : false
})

/**
 * When the selection is empty and at the start of a textblock, select
 * the node before that textblock, if possible. This is intended to be
 * bound to keys like backspace, after `joinBackward` or other deleting
 * commands, as a fall-back behavior when the schema doesn't allow
 * deletion at the selected point.
 *
 * @since 0.1.0
 * @category commands
 */
export const selectNodeBackward: Command = syncCommand((state, dispatching, view) => {
  const { $head, empty } = state.selection
  let $cut: ResolvedPos<any> | null = $head
  if (!empty) return false

  if ($head.parent.isTextblock) {
    if (isTextblockBoundaryView(view) ? !view.endOfTextblock("backward", state) : $head.parentOffset > 0) {
      return false
    }
    $cut = findCutBefore($head)
  }
  const node = $cut && $cut.nodeBeforeOrNull
  if (!node || !NodeSelection.isSelectable(node)) return false
  return done(dispatching, () =>
    state.tr.setSelectionUnsafe(NodeSelection.createUnsafe(state.doc, $cut!.pos - node.nodeSize)).scrollIntoView()
  )
})

/**
 * If the selection is empty and the cursor is at the end of a
 * textblock, try to reduce or remove the boundary between that block
 * and the one after it, either by joining them or by moving the other
 * block closer to this one in the tree structure. Will use the view for
 * accurate start-of-textblock detection if given.
 *
 * @since 0.1.0
 * @category commands
 */
export const joinForward: Command = syncCommand((state, dispatching, view) => {
  const $cursor = atBlockEnd(state, view)
  if (!$cursor) return false

  const $cut = findCutAfter($cursor)
  // If there is no node after this, there's nothing to do
  if (!$cut) return false

  const after = $cut.nodeAfterOrNull!
  // Try the joining algorithm
  const barrier = deleteBarrier(state, $cut, dispatching, 1)
  if (barrier !== false) return barrier

  // If the node above has no content and the node below is
  // selectable, delete the node above and select the one below.
  if ($cursor.parent.content.size === 0 && (textblockAt(after, "start") || NodeSelection.isSelectable(after))) {
    const delStep = replaceStepOrNull(state.doc, $cursor.beforeUnsafe(), $cursor.afterUnsafe())
    if (delStep && isDeletingStep(delStep)) {
      return done(dispatching, () => {
        const tr = state.tr.stepUnsafe(delStep)
        tr.setSelectionUnsafe(
          textblockAt(after, "start")
            ? Selection.findFromOrNull(tr.doc.resolveUnsafe(tr.mapping.map($cut.pos)), 1)!
            : NodeSelection.createUnsafe(tr.doc, tr.mapping.map($cut.pos))
        )
        return tr.scrollIntoView()
      })
    }
  }

  // If the next node is an atom, delete it
  if (after.isAtom && $cut.depth === $cursor.depth - 1) {
    return done(dispatching, () => state.tr.deleteUnsafe($cut.pos, $cut.pos + after.nodeSize).scrollIntoView())
  }

  return false
})

/**
 * When the selection is empty and at the end of a textblock, select the
 * node coming after that textblock, if possible. This is intended to be
 * bound to keys like delete, after `joinForward` and similar deleting
 * commands, to provide a fall-back behavior when the schema doesn't
 * allow deletion at the selected point.
 *
 * @since 0.1.0
 * @category commands
 */
export const selectNodeForward: Command = syncCommand((state, dispatching, view) => {
  const { $head, empty } = state.selection
  let $cut: ResolvedPos<any> | null = $head
  if (!empty) return false
  if ($head.parent.isTextblock) {
    if (
      isTextblockBoundaryView(view)
        ? !view.endOfTextblock("forward", state)
        : $head.parentOffset < $head.parent.content.size
    )
      return false
    $cut = findCutAfter($head)
  }
  const node = $cut && $cut.nodeAfterOrNull
  if (!node || !NodeSelection.isSelectable(node)) return false
  return done(dispatching, () =>
    state.tr.setSelectionUnsafe(NodeSelection.createUnsafe(state.doc, $cut!.pos)).scrollIntoView()
  )
})

/**
 * Join the selected block or, if there is a text selection, the closest
 * ancestor block of the selection that can be joined, with the sibling
 * above it.
 *
 * @since 0.1.0
 * @category commands
 */
export const joinUp: Command = syncCommand((state, dispatching) => {
  const sel = state.selection,
    nodeSel = sel instanceof NodeSelection
  let point: number
  if (nodeSel) {
    if (sel.node.isTextblock || !canJoin(state.doc, sel.from)) return false
    point = sel.from
  } else {
    const found = Option.getOrNull(joinPoint(state.doc, sel.from, -1))
    if (found == null) return false
    point = found
  }
  return done(dispatching, () => {
    const tr = state.tr.joinUnsafe(point)
    if (nodeSel) {
      tr.setSelectionUnsafe(
        NodeSelection.createUnsafe(tr.doc, point - state.doc.resolveUnsafe(point).nodeBeforeOrNull!.nodeSize)
      )
    }
    return tr.scrollIntoView()
  })
})

/**
 * Join the selected block, or the closest ancestor of the selection
 * that can be joined, with the sibling after it.
 *
 * @since 0.1.0
 * @category commands
 */
export const joinDown: Command = syncCommand((state, dispatching) => {
  const sel = state.selection
  let point: number
  if (sel instanceof NodeSelection) {
    if (sel.node.isTextblock || !canJoin(state.doc, sel.to)) return false
    point = sel.to
  } else {
    const found = Option.getOrNull(joinPoint(state.doc, sel.to, 1))
    if (found == null) return false
    point = found
  }
  return done(dispatching, () => state.tr.joinUnsafe(point).scrollIntoView())
})

/**
 * Lift the selected block, or the closest ancestor block of the
 * selection that can be lifted, out of its parent node.
 *
 * @since 0.1.0
 * @category commands
 */
export const lift: Command = syncCommand((state, dispatching) => {
  const { $from, $to } = state.selection
  const range = $from.blockRangeOrNull($to),
    target = range && liftTargetOrNull(range)
  if (target == null) return false
  return done(dispatching, () => state.tr.liftUnsafe(range!, target).scrollIntoView())
})

/**
 * If the selection is in a node whose type has a truthy `code` property
 * in its spec, replace the selection with a newline character.
 *
 * @since 0.1.0
 * @category commands
 */
export const newlineInCode: Command = syncCommand((state, dispatching) => {
  const { $anchor, $head } = state.selection
  if (!$head.parent.type.spec.code || !$head.sameParent($anchor)) return false
  return done(dispatching, () => state.tr.insertTextUnsafe("\n").scrollIntoView())
})

/**
 * When the selection is in a node with a truthy `code` property in its
 * spec, create a default block after the code block, and move the
 * cursor there.
 *
 * @since 0.1.0
 * @category commands
 */
export const exitCode: Command = syncCommand((state, dispatching) => {
  const { $anchor, $head } = state.selection
  if (!$head.parent.type.spec.code || !$head.sameParent($anchor)) return false
  const above = $head.node(-1),
    after = $head.indexAfter(-1)
  const type = defaultBlockAt(above.contentMatchAtUnsafe(after))
  if (!type || !above.canReplaceWith(after, after, type)) return false
  return done(dispatching, () => {
    const pos = $head.afterUnsafe(),
      tr = state.tr.replaceWithUnsafe(pos, pos, type.createAndFillOrNull()!)
    tr.setSelectionUnsafe(Selection.near(tr.doc.resolveUnsafe(pos), 1))
    return tr.scrollIntoView()
  })
})

/**
 * If a block node is selected, create an empty paragraph before (if it
 * is its parent's first child) or after it.
 *
 * @since 0.1.0
 * @category commands
 */
export const createParagraphNear: Command = syncCommand((state, dispatching) => {
  const sel = state.selection,
    { $from, $to } = sel
  if (sel instanceof AllSelection || $from.parent.inlineContent || $to.parent.inlineContent) return false
  const type = defaultBlockAt($to.parent.contentMatchAtUnsafe($to.indexAfter()))
  if (!type || !type.isTextblock) return false
  return done(dispatching, () => {
    const side = (!$from.parentOffset && $to.index() < $to.parent.childCount ? $from : $to).pos
    const tr = state.tr.insertUnsafe(side, type.createAndFillOrNull()!)
    tr.setSelectionUnsafe(TextSelection.createUnsafe(tr.doc, side + 1))
    return tr.scrollIntoView()
  })
})

/**
 * If the cursor is in an empty textblock that can be lifted, lift the
 * block.
 *
 * @since 0.1.0
 * @category commands
 */
export const liftEmptyBlock: Command = syncCommand((state, dispatching) => {
  const $cursor = cursorOf(state)
  if (!$cursor || $cursor.parent.content.size) return false
  if ($cursor.depth > 1 && $cursor.afterUnsafe() !== $cursor.end(-1)) {
    const before = $cursor.beforeUnsafe()
    if (canSplit(state.doc, before)) {
      return done(dispatching, () => state.tr.splitUnsafe(before).scrollIntoView())
    }
  }
  const range = $cursor.blockRangeOrNull(),
    target = range && liftTargetOrNull(range)
  if (target == null) return false
  return done(dispatching, () => state.tr.liftUnsafe(range!, target).scrollIntoView())
})

/**
 * A function that determines the type of the block split off by
 * `splitBlockAs`, given the parent node of the selection end, whether
 * the split happens at the end of that node, and the selection start.
 * Returning `null` (or `undefined`) uses the default behavior.
 *
 * @since 0.1.0
 * @category models
 */
export type SplitNodeType<Sc extends AnySchema = AnySchema> = (
  node: Node<Sc>,
  atEnd: boolean,
  $from: ResolvedPos<Sc>
) => NodeTypeWithAttrs<Sc> | null | undefined

/**
 * Create a variant of `splitBlock` that uses a custom function to
 * determine the type of the newly split off block.
 *
 * @since 0.1.0
 * @category commands
 */
export const splitBlockAs = <Sc extends AnySchema = AnySchema>(splitNode?: SplitNodeType<Sc>): Command<Sc> =>
  syncCommand<Sc>((state, dispatching) => {
    const sel = state.selection,
      { $from, $to } = sel
    if (sel instanceof NodeSelection && sel.node.isBlock) {
      if (!$from.parentOffset || !canSplit(state.doc, $from.pos)) return false
      return done(dispatching, () => state.tr.splitUnsafe($from.pos).scrollIntoView())
    }

    if (!$from.depth) return false
    const types: Array<NodeTypeWithAttrs<any> | null> = []
    let splitDepth = 0,
      deflt: NodeType<any, any> | null = null,
      atEnd = false,
      atStart = false
    for (let d = $from.depth; ; d--) {
      const node = $from.node(d)
      if (node.isBlock) {
        atEnd = $from.end(d) === $from.pos + ($from.depth - d)
        atStart = $from.start(d) === $from.pos - ($from.depth - d)
        deflt = defaultBlockAt($from.node(d - 1).contentMatchAtUnsafe($from.indexAfter(d - 1)))
        const splitType = splitNode && splitNode($to.parent, atEnd, $from)
        types.unshift(splitType || (atEnd && deflt ? { type: deflt } : null))
        splitDepth = d
        break
      } else {
        if (d === 1) return false
        types.unshift(null)
      }
    }

    const tr = state.tr
    if (sel instanceof TextSelection || sel instanceof AllSelection) tr.deleteSelection()
    const splitPos = tr.mapping.map($from.pos)
    let can = canSplit(tr.doc, splitPos, types.length, types)
    if (!can) {
      types[0] = deflt ? { type: deflt } : null
      can = canSplit(tr.doc, splitPos, types.length, types)
    }
    if (!can) return false
    tr.splitUnsafe(splitPos, types.length, types)
    if (!atEnd && atStart && $from.node(splitDepth).type !== deflt) {
      const first = tr.mapping.map($from.beforeUnsafe(splitDepth)),
        $first = tr.doc.resolveUnsafe(first)
      if (deflt && $from.node(splitDepth - 1).canReplaceWith($first.index(), $first.index() + 1, deflt)) {
        tr.setNodeMarkupUnsafe(tr.mapping.map($from.beforeUnsafe(splitDepth)), deflt)
      }
    }
    return tr.scrollIntoView()
  })

/**
 * Split the parent block of the selection. If the selection is a text
 * selection, also delete its content.
 *
 * @since 0.1.0
 * @category commands
 */
export const splitBlock: Command = splitBlockAs()

/**
 * Acts like `splitBlock`, but without resetting the set of active marks
 * at the cursor.
 *
 * @since 0.1.0
 * @category commands
 */
export const splitBlockKeepMarks: Command = (state, dispatch) => splitBlock(state, keepMarks(state, dispatch))

/**
 * Move the selection to the node wrapping the current selection, if
 * any. (Will not select the document node.)
 *
 * @since 0.1.0
 * @category commands
 */
export const selectParentNode: Command = syncCommand((state, dispatching) => {
  const { $from, to } = state.selection
  const same = $from.sharedDepth(to)
  if (same === 0) return false
  const pos = $from.beforeUnsafe(same)
  return done(dispatching, () => state.tr.setSelectionUnsafe(NodeSelection.createUnsafe(state.doc, pos)))
})

/**
 * Select the whole document.
 *
 * @since 0.1.0
 * @category commands
 */
export const selectAll: Command = syncCommand((state, dispatching) =>
  done(dispatching, () => state.tr.setSelectionUnsafe(new AllSelection(state.doc)))
)

function selectTextblockSide(side: number): Command {
  return syncCommand((state, dispatching) => {
    const sel = state.selection,
      $pos = side < 0 ? sel.$from : sel.$to
    let depth = $pos.depth
    while ($pos.node(depth).isInline) {
      if (!depth) return false
      depth--
    }
    if (!$pos.node(depth).isTextblock) return false
    return done(dispatching, () =>
      state.tr.setSelectionUnsafe(TextSelection.createUnsafe(state.doc, side < 0 ? $pos.start(depth) : $pos.end(depth)))
    )
  })
}

/**
 * Moves the cursor to the start of current text block.
 *
 * @since 0.1.0
 * @category commands
 */
export const selectTextblockStart: Command = selectTextblockSide(-1)

/**
 * Moves the cursor to the end of current text block.
 *
 * @since 0.1.0
 * @category commands
 */
export const selectTextblockEnd: Command = selectTextblockSide(1)

// -----------------------------------------------------------------------------
// Parameterized commands
// -----------------------------------------------------------------------------

/**
 * Wrap the selection in a node of the given type with the given
 * attributes.
 *
 * @since 0.1.0
 * @category commands
 */
export const wrapIn = <Sc extends AnySchema, N extends NodeNames<Sc>>(
  nodeType: NodeType<Sc, N>,
  attrs: NodeAttrsInput<Sc, N> | null = null
): Command<Sc> =>
  syncCommand<Sc>((state, dispatching) => {
    const { $from, $to } = state.selection
    const range = $from.blockRangeOrNull($to),
      wrapping = range && findWrappingOrNull(range, nodeType, attrs)
    if (!wrapping) return false
    return done(dispatching, () => state.tr.wrapUnsafe(range!, wrapping).scrollIntoView())
  })

/**
 * Returns a command that tries to set the selected textblocks to the
 * given node type with the given attributes.
 *
 * @since 0.1.0
 * @category commands
 */
export const setBlockType = <Sc extends AnySchema, N extends NodeNames<Sc>>(
  nodeType: NodeType<Sc, N>,
  attrs: NodeAttrsInput<Sc, N> | null = null
): Command<Sc> =>
  syncCommand<Sc>((state, dispatching) => {
    let applicable = false
    const ranges = state.selection.ranges
    for (let i = 0; i < ranges.length && !applicable; i++) {
      const {
        $from: { pos: from },
        $to: { pos: to }
      } = ranges[i]!
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (applicable) return false
        if (!node.isTextblock || node.hasMarkup(nodeType, attrs)) return
        if (node.type === nodeType) {
          applicable = true
        } else {
          const $pos = state.doc.resolveUnsafe(pos),
            index = $pos.index()
          applicable = $pos.parent.canReplaceWith(index, index + 1, nodeType)
        }
      })
    }
    if (!applicable) return false
    return done(dispatching, () => {
      const tr = state.tr
      for (let i = 0; i < ranges.length; i++) {
        const {
          $from: { pos: from },
          $to: { pos: to }
        } = ranges[i]!
        tr.setBlockTypeUnsafe(from, to, nodeType, attrs)
      }
      return tr.scrollIntoView()
    })
  })

function markApplies(
  doc: Node<any>,
  ranges: ReadonlyArray<SelectionRange<any>>,
  type: MarkType<any, any>,
  enterAtoms: boolean
): boolean {
  for (let i = 0; i < ranges.length; i++) {
    const { $from, $to } = ranges[i]!
    let can = $from.depth === 0 ? doc.inlineContent && doc.type.allowsMarkType(type) : false
    doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
      if (can || (!enterAtoms && node.isAtom && node.isInline && pos >= $from.pos && pos + node.nodeSize <= $to.pos))
        return false
      can = node.inlineContent && node.type.allowsMarkType(type)
    })
    if (can) return true
  }
  return false
}

function removeInlineAtoms(ranges: ReadonlyArray<SelectionRange<any>>): ReadonlyArray<SelectionRange<any>> {
  const result: Array<SelectionRange<any>> = []
  for (let i = 0; i < ranges.length; i++) {
    let { $from } = ranges[i]!
    const { $to } = ranges[i]!
    $from.doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
      if (node.isAtom && node.content.size && node.isInline && pos >= $from.pos && pos + node.nodeSize <= $to.pos) {
        if (pos + 1 > $from.pos) result.push(new SelectionRange($from, $from.doc.resolveUnsafe(pos + 1)))
        $from = $from.doc.resolveUnsafe(pos + 1 + node.content.size)
        return false
      }
    })
    if ($from.pos < $to.pos) result.push(new SelectionRange($from, $to))
  }
  return result
}

/**
 * Options for `toggleMark`.
 *
 * @since 0.1.0
 * @category models
 */
export interface ToggleMarkOptions {
  /**
   * Controls whether, when part of the selected range has the mark
   * already and part doesn't, the mark is removed (`true`, the default)
   * or added (`false`).
   */
  readonly removeWhenPresent?: boolean | undefined
  /**
   * When set to false, this will prevent the command from acting on the
   * content of inline nodes marked as atoms that are completely covered
   * by a selection range.
   */
  readonly enterInlineAtoms?: boolean | undefined
  /**
   * By default, this command doesn't apply to leading and trailing
   * whitespace in the selection. Set this to `true` to change that.
   */
  readonly includeWhitespace?: boolean | undefined
}

/**
 * Create a command function that toggles the given mark with the given
 * attributes. Will return `false` when the current selection doesn't
 * support that mark. This will remove the mark if any marks of that
 * type exist in the selection, or add it otherwise. If the selection is
 * empty, this applies to the stored marks instead of a range of the
 * document.
 *
 * @since 0.1.0
 * @category commands
 */
export const toggleMark = <Sc extends AnySchema, M extends MarkNames<Sc>>(
  markType: MarkType<Sc, M>,
  attrs: MarkAttrsInput<Sc, M> | null = null,
  options?: ToggleMarkOptions
): Command<Sc> => {
  const removeWhenPresent = (options && options.removeWhenPresent) !== false
  const enterAtoms = (options && options.enterInlineAtoms) !== false
  const dropSpace = !(options && options.includeWhitespace)
  return syncCommand<Sc>((state, dispatching) => {
    const sel = state.selection,
      empty = sel.empty,
      $cursor = cursorOf(state)
    let ranges = sel.ranges
    if ((empty && !$cursor) || !markApplies(state.doc, ranges, markType, enterAtoms)) return false
    if (!dispatching) return true
    if ($cursor) {
      if (markType.findInSet(state.storedMarksOrNull || $cursor.marks())) {
        return state.tr.removeStoredMark(markType)
      }
      return state.tr.addStoredMark(markType.createUnsafe(attrs))
    }
    let add: boolean
    const tr = state.tr
    if (!enterAtoms) ranges = removeInlineAtoms(ranges)
    if (removeWhenPresent) {
      add = !ranges.some((r) => state.doc.rangeHasMark(r.$from.pos, r.$to.pos, markType))
    } else {
      add = !ranges.every((r) => {
        let missing = false
        tr.doc.nodesBetween(r.$from.pos, r.$to.pos, (node, pos, parent) => {
          if (missing) return false
          missing =
            !markType.findInSet(node.marks) &&
            Option.isSome(parent) &&
            parent.value.type.allowsMarkType(markType) &&
            !(
              node.isText &&
              /^\s*$/.test(node.textBetween(Math.max(0, r.$from.pos - pos), Math.min(node.nodeSize, r.$to.pos - pos)))
            )
        })
        return !missing
      })
    }
    for (let i = 0; i < ranges.length; i++) {
      const { $from, $to } = ranges[i]!
      if (!add) {
        tr.removeMark($from.pos, $to.pos, markType)
      } else {
        let from = $from.pos,
          to = $to.pos
        const start = $from.nodeAfterOrNull,
          end = $to.nodeBeforeOrNull
        const spaceStart = dropSpace && start && start.isText ? /^\s*/.exec((start as TextNode<Sc>).text)![0].length : 0
        const spaceEnd = dropSpace && end && end.isText ? /\s*$/.exec((end as TextNode<Sc>).text)![0].length : 0
        if (from + spaceStart < to) {
          from += spaceStart
          to -= spaceEnd
        }
        tr.addMark(from, to, markType.createUnsafe(attrs))
      }
    }
    return tr.scrollIntoView()
  })
}

function wrapDispatchForJoin<Sc extends AnySchema>(
  dispatch: Dispatch<Sc>,
  isJoinable: (a: Node<Sc>, b: Node<Sc>) => boolean
): Dispatch<Sc> {
  return (tr: Transaction<Sc>) =>
    Effect.suspend(() => {
      if (!tr.isGeneric) return dispatch(tr)

      const ranges: Array<number> = []
      for (let i = 0; i < tr.mapping.maps.length; i++) {
        const map = tr.mapping.maps[i]!
        for (let j = 0; j < ranges.length; j++) ranges[j] = map.map(ranges[j]!)
        map.forEach((_s, _e, from, to) => ranges.push(from, to))
      }

      // Figure out which joinable points exist inside those ranges,
      // by checking all node boundaries in their parent nodes.
      const joinable: Array<number> = []
      for (let i = 0; i < ranges.length; i += 2) {
        const from = ranges[i]!,
          to = ranges[i + 1]!
        const $from = tr.doc.resolveUnsafe(from),
          depth = $from.sharedDepth(to),
          parent = $from.node(depth)
        for (let index = $from.indexAfter(depth), pos = $from.afterUnsafe(depth + 1); pos <= to; ++index) {
          const after = parent.content.content[index]
          if (!after) break
          if (index && joinable.indexOf(pos) === -1) {
            const before = parent.content.content[index - 1]!
            if (before.type === after.type && isJoinable(before, after)) joinable.push(pos)
          }
          pos += after.nodeSize
        }
      }
      // Join the joinable points
      joinable.sort((a, b) => a - b)
      for (let i = joinable.length - 1; i >= 0; i--) {
        if (canJoin(tr.doc, joinable[i]!)) tr.joinUnsafe(joinable[i]!)
      }
      return dispatch(tr)
    })
}

/**
 * Wrap a command so that, when it produces a transform that causes two
 * joinable nodes to end up next to each other, those are joined. Nodes
 * are considered joinable when they are of the same type and when the
 * `isJoinable` predicate returns true for them or, if an array of
 * strings was passed, if their node type name is in that array.
 *
 * @since 0.1.0
 * @category combinators
 */
export const autoJoin = <Sc extends AnySchema, E, R>(
  command: Command<Sc, E, R>,
  isJoinable: ((before: Node<Sc>, after: Node<Sc>) => boolean) | ReadonlyArray<string>
): Command<Sc, E, R> => {
  const canJoinNodes = Array.isArray(isJoinable)
    ? (node: Node<Sc>) => (isJoinable as ReadonlyArray<string>).indexOf(node.type.name) > -1
    : (isJoinable as (a: Node<Sc>, b: Node<Sc>) => boolean)
  return (state, dispatch, view) => command(state, dispatch && wrapDispatchForJoin(dispatch, canJoinNodes), view)
}

/**
 * The union of the error types of the given commands.
 *
 * @since 0.1.0
 * @category type-level
 */
export type CommandError<C> = C extends (...args: any) => Effect.Effect<any, infer E, any> ? E : never

/**
 * The union of the requirements of the given commands.
 *
 * @since 0.1.0
 * @category type-level
 */
export type CommandRequirements<C> = C extends (...args: any) => Effect.Effect<any, any, infer R> ? R : never

/**
 * Combine a number of command functions into a single function (which
 * calls them one by one until one returns true). The resulting
 * command's errors and requirements are the unions of those of the
 * given commands.
 *
 * @since 0.1.0
 * @category combinators
 */
export const chainCommands =
  <const Commands extends ReadonlyArray<Command<any, any, any>>>(
    ...commands: Commands
  ): Command<AnySchema, CommandError<Commands[number]>, CommandRequirements<Commands[number]>> =>
  (state, dispatch, view) => {
    const loop = (i: number): Effect.Effect<boolean, any, any> =>
      i === commands.length
        ? succeedFalse
        : Effect.flatMap(
            Effect.suspend(() => commands[i]!(state, dispatch, view)),
            (handled) => (handled ? succeedTrue : loop(i + 1))
          )
    return loop(0)
  }
