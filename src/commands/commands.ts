/**
 * Editing commands, ported from `prosemirror-commands`.
 *
 * Ported from prosemirror-commands (MIT, Marijn Haverbeke and others).
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Num from "effect/Number"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
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
  Slice
} from "../Model.ts"
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
} from "../State.ts"
import { canJoin, canSplit, joinPoint, type NodeTypeWithAttrs, ReplaceAroundStep, ReplaceStep } from "../Transform.ts"
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
  Predicate.isObjectOrArray(view) &&
  Predicate.hasProperty(view, "endOfTextblock") &&
  Predicate.isFunction(view.endOfTextblock)

/** `isTextblockBoundaryView`, typed on the views commands receive. */
const isBoundaryView = (view: EditorViewLike): view is Extract<EditorViewLike, TextblockBoundaryView> =>
  // SAFETY: read only to check that it is a function.
  Predicate.isObjectOrArray(view) && Predicate.isFunction((view as { endOfTextblock?: unknown }).endOfTextblock)

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

const cursorOf = <Sc extends AnySchema>(state: EditorState<Sc, any, any>): Option.Option<ResolvedPos<Sc>> => {
  const sel = state.selection
  return sel instanceof TextSelection ? sel.$cursor : Option.none()
}

// The length of the whitespace that starts or ends a string, as `\s*` matches it.
const leadingSpace = (text: string): number => text.length - text.trimStart().length
const trailingSpace = (text: string): number => text.length - text.trimEnd().length

const firstChildOf = (node: Node<any>): Option.Option<Node<any>> => node.firstChild
const lastChildOf = (node: Node<any>): Option.Option<Node<any>> => node.lastChild

const atBlockStart = (state: EditorState<any, any, any>, view: EditorViewLike): Option.Option<ResolvedPos<any>> =>
  Option.filter(cursorOf(state), ($cursor) =>
    isBoundaryView(view) ? view.endOfTextblock("backward", state) : $cursor.parentOffset === 0
  )

const atBlockEnd = (state: EditorState<any, any, any>, view: EditorViewLike): Option.Option<ResolvedPos<any>> =>
  Option.filter(cursorOf(state), ($cursor) =>
    isBoundaryView(view) ? view.endOfTextblock("forward", state) : $cursor.parentOffset >= $cursor.parent.content.size
  )

function findCutBefore($pos: ResolvedPos<any>): Option.Option<ResolvedPos<any>> {
  return $pos.parent.type.spec.isolating ? Option.none() : cutFrom($pos, $pos.depth - 1, -1)
}

function findCutAfter($pos: ResolvedPos<any>): Option.Option<ResolvedPos<any>> {
  return $pos.parent.type.spec.isolating ? Option.none() : cutFrom($pos, $pos.depth - 1, 1)
}

// The nearest position at `depth` or above with a sibling on `side`, without crossing an isolating node.
function cutFrom($pos: ResolvedPos<any>, depth: number, side: number): Option.Option<ResolvedPos<any>> {
  if (depth < 0) return Option.none()
  const parent = $pos.node(depth)
  if (side < 0 ? $pos.index(depth) > 0 : $pos.index(depth) + 1 < parent.childCount) {
    return Option.some($pos.doc.resolveUnsafe(side < 0 ? $pos.beforeUnsafe(depth + 1) : $pos.afterUnsafe(depth + 1)))
  }
  return parent.type.spec.isolating ? Option.none() : cutFrom($pos, depth - 1, side)
}

function textblockAt(node: Node<any>, side: "start" | "end", only = false): boolean {
  if (node.isTextblock) return true
  if (only && node.childCount !== 1) return false
  const next = side === "start" ? firstChildOf(node) : lastChildOf(node)
  return Option.isSome(next) && textblockAt(next.value, side, only)
}

// The textblock reached by descending into `node` along its `side` edge, with the number of levels descended.
function textblockInside(
  node: Node<any>,
  side: "start" | "end",
  stopAtIsolating: boolean
): Option.Option<readonly [Node<any>, number]> {
  if (node.isTextblock) return Option.some([node, 0])
  if (stopAtIsolating && node.type.spec.isolating) return Option.none()
  return Option.map(
    Option.flatMap(side === "start" ? firstChildOf(node) : lastChildOf(node), (child) =>
      textblockInside(child, side, stopAtIsolating)
    ),
    ([textblock, depth]) => [textblock, depth + 1] as const
  )
}

// `node` and its last descendants down to a textblock.
function pathToLastTextblock(node: Node<any>): Option.Option<Array<Node<any>>> {
  if (node.isTextblock) return Option.some([node])
  return Option.map(Option.flatMap(lastChildOf(node), pathToLastTextblock), (path) => [node, ...path])
}

function isDeletingStep(step: unknown): step is ReplaceStep<any> {
  // SAFETY: callers pass the step of a deletion, a `ReplaceStep`.
  const s = step as ReplaceStep<any>
  return s.slice.size < s.to - s.from
}

const defaultBlockAt = (match: ContentMatch): Option.Option<NodeType<any, any>> =>
  Arr.findFirst(match.next, ({ type }) => type.isTextblock && !type.hasRequiredAttrs()).pipe(
    Option.map(({ type }) => type)
  )

function joinTextblocksAround(state: EditorState<any, any, any>, $cut: ResolvedPos<any>, dispatching: boolean) {
  const before = $cut.nodeBeforeOrNull
  if (!before) return false
  const beforeText = textblockInside(before, "end", true)
  if (Option.isNone(beforeText)) return false
  const beforePos = $cut.pos - 1 - beforeText.value[1]
  const after = $cut.nodeAfterOrNull
  if (!after) return false
  const afterText = textblockInside(after, "start", true)
  if (Option.isNone(afterText)) return false
  const afterPos = $cut.pos + 1 + afterText.value[1]
  const step = replaceStepOrNull(state.doc, beforePos, afterPos, Slice.empty)
  if (
    !(step instanceof ReplaceStep || step instanceof ReplaceAroundStep) ||
    step.from !== beforePos ||
    (step instanceof ReplaceStep && step.slice.size >= afterPos - beforePos)
  )
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
  const before = $cut.nodeBeforeOrNull,
    after = $cut.nodeAfterOrNull
  if (!before || !after) return false
  const isolated = before.type.spec.isolating || after.type.spec.isolating
  if (!isolated) {
    const joined = joinMaybeClear(state, $cut, dispatching)
    if (joined !== false) return joined
  }

  const canDelAfter = !isolated && $cut.parent.canReplace($cut.index(), $cut.index() + 1)
  const match = before.contentMatchAtUnsafe(before.childCount)
  const conn = canDelAfter ? match.findWrapping(after.type) : Option.none()
  if (Option.isSome(conn) && match.matchTypeOrNull(conn.value[0] || after.type)?.validEnd) {
    const wrappers = conn.value
    return done(dispatching, () => {
      const end = $cut.pos + after.nodeSize
      const inner = wrappers.reduceRight(
        (content: Fragment<any>, type) => Fragment.from(type.createUnsafe(null, content)),
        Fragment.empty
      )
      const wrap = Fragment.from(before.copy(inner))
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
  if (range && target != null && target >= $cut.depth) {
    return done(dispatching, () => state.tr.liftUnsafe(range, target).scrollIntoView())
  }

  if (canDelAfter && textblockAt(after, "start", true) && textblockAt(before, "end")) {
    const path = pathToLastTextblock(before)
    const inside = textblockInside(after, "start", false)
    if (Option.isNone(path) || Option.isNone(inside)) return false
    const wrap = path.value,
      at = wrap[wrap.length - 1]
    const afterText = inside.value[0],
      afterDepth = inside.value[1] + 1
    if (at.canReplace(at.childCount, at.childCount, afterText.content)) {
      return done(dispatching, () => {
        const end = wrap.reduceRight(
          (content: Fragment<any>, node) => Fragment.from(node.copy(content)),
          Fragment.empty
        )
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
  const cursor = atBlockStart(state, view)
  if (Option.isNone(cursor)) return false
  const $cursor = cursor.value

  const cut = findCutBefore($cursor)

  // If there is no node before this, try to lift
  if (Option.isNone(cut)) {
    const range = $cursor.blockRangeOrNull(),
      target = range && liftTargetOrNull(range)
    if (!range || target == null) return false
    return done(dispatching, () => state.tr.liftUnsafe(range, target).scrollIntoView())
  }

  const $cut = cut.value
  const before = $cut.nodeBeforeOrNull
  if (!before) return false
  // Apply the joining algorithm
  const barrier = deleteBarrier(state, $cut, dispatching, -1)
  if (barrier !== false) return barrier

  // If the node below has no content and the node above is
  // selectable, delete the node below and select the one above.
  if ($cursor.parent.content.size === 0 && (textblockAt(before, "end") || NodeSelection.isSelectable(before))) {
    // Delete the innermost of the empty node and its only-child ancestors that can be deleted.
    const deletion = (depth: number): Option.Option<ReplaceStep<any>> => {
      const delStep = replaceStepOrNull(state.doc, $cursor.beforeUnsafe(depth), $cursor.afterUnsafe(depth))
      if (delStep && isDeletingStep(delStep)) return Option.some(delStep)
      return depth === 1 || $cursor.node(depth - 1).childCount > 1 ? Option.none() : deletion(depth - 1)
    }
    const found = deletion($cursor.depth)
    if (Option.isSome(found)) {
      const delStep = found.value
      return done(dispatching, () => {
        const tr = state.tr.stepUnsafe(delStep)
        tr.setSelectionUnsafe(
          textblockAt(before, "end")
            ? Selection.findFromOrNull(tr.doc.resolveUnsafe(tr.mapping.map($cut.pos, -1)), -1) ||
                Selection.near(tr.doc.resolveUnsafe(tr.mapping.map($cut.pos, -1)), -1)
            : NodeSelection.createUnsafe(tr.doc, $cut.pos - before.nodeSize)
        )
        return tr.scrollIntoView()
      })
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
export const joinTextblockBackward: Command = syncCommand((state, dispatching, view) =>
  atBlockStart(state, view).pipe(
    Option.flatMap(findCutBefore),
    Option.match({ onNone: () => false, onSome: ($cut) => joinTextblocksAround(state, $cut, dispatching) })
  )
)

/**
 * A more limited form of `joinForward` that only tries to join the
 * current textblock to the one after it, if the cursor is at the end of
 * a textblock.
 *
 * @since 0.1.0
 * @category commands
 */
export const joinTextblockForward: Command = syncCommand((state, dispatching, view) =>
  atBlockEnd(state, view).pipe(
    Option.flatMap(findCutAfter),
    Option.match({ onNone: () => false, onSome: ($cut) => joinTextblocksAround(state, $cut, dispatching) })
  )
)

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
  if (!empty) return false
  let cut = Option.some($head)

  if ($head.parent.isTextblock) {
    if (isBoundaryView(view) ? !view.endOfTextblock("backward", state) : $head.parentOffset > 0) {
      return false
    }
    cut = findCutBefore($head)
  }
  if (Option.isNone(cut)) return false
  const node = cut.value.nodeBeforeOrNull
  if (!node || !NodeSelection.isSelectable(node)) return false
  const cutPos = cut.value.pos
  return done(dispatching, () =>
    state.tr.setSelectionUnsafe(NodeSelection.createUnsafe(state.doc, cutPos - node.nodeSize)).scrollIntoView()
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
  const cursor = atBlockEnd(state, view)
  if (Option.isNone(cursor)) return false
  const $cursor = cursor.value

  const cut = findCutAfter($cursor)
  // If there is no node after this, there's nothing to do
  if (Option.isNone(cut)) return false
  const $cut = cut.value

  const after = $cut.nodeAfterOrNull
  if (!after) return false
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
            ? Selection.findFromOrNull(tr.doc.resolveUnsafe(tr.mapping.map($cut.pos)), 1) ||
                Selection.near(tr.doc.resolveUnsafe(tr.mapping.map($cut.pos)), 1)
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
  if (!empty) return false
  let cut = Option.some($head)
  if ($head.parent.isTextblock) {
    if (
      isTextblockBoundaryView(view)
        ? !view.endOfTextblock("forward", state)
        : $head.parentOffset < $head.parent.content.size
    )
      return false
    cut = findCutAfter($head)
  }
  if (Option.isNone(cut)) return false
  const node = cut.value.nodeAfterOrNull
  if (!node || !NodeSelection.isSelectable(node)) return false
  const cutPos = cut.value.pos
  return done(dispatching, () =>
    state.tr.setSelectionUnsafe(NodeSelection.createUnsafe(state.doc, cutPos)).scrollIntoView()
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
  const joined = nodeSel ? state.doc.resolveUnsafe(point).nodeBeforeOrNull : null
  return done(dispatching, () => {
    const tr = state.tr.joinUnsafe(point)
    if (joined) tr.setSelectionUnsafe(NodeSelection.createUnsafe(tr.doc, point - joined.nodeSize))
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
  if (!range || target == null) return false
  return done(dispatching, () => state.tr.liftUnsafe(range, target).scrollIntoView())
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
  const type = Option.getOrNull(defaultBlockAt(above.contentMatchAtUnsafe(after)))
  if (!type || !above.canReplaceWith(after, after, type)) return false
  const block = type.createAndFillOrNull()
  if (!block) return false
  return done(dispatching, () => {
    const pos = $head.afterUnsafe(),
      tr = state.tr.replaceWithUnsafe(pos, pos, block)
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
  const type = Option.getOrNull(defaultBlockAt($to.parent.contentMatchAtUnsafe($to.indexAfter())))
  if (!type || !type.isTextblock) return false
  const block = type.createAndFillOrNull()
  if (!block) return false
  return done(dispatching, () => {
    const side = (!$from.parentOffset && $to.index() < $to.parent.childCount ? $from : $to).pos
    const tr = state.tr.insertUnsafe(side, block)
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
  const $cursor = Option.getOrNull(cursorOf(state))
  if (!$cursor || $cursor.parent.content.size) return false
  if ($cursor.depth > 1 && $cursor.afterUnsafe() !== $cursor.end(-1)) {
    const before = $cursor.beforeUnsafe()
    if (canSplit(state.doc, before)) {
      return done(dispatching, () => state.tr.splitUnsafe(before).scrollIntoView())
    }
  }
  const range = $cursor.blockRangeOrNull(),
    target = range && liftTargetOrNull(range)
  if (!range || target == null) return false
  return done(dispatching, () => state.tr.liftUnsafe(range, target).scrollIntoView())
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
    const sel = state.selection
    if (sel instanceof NodeSelection && sel.node.isBlock) {
      const { $from } = sel
      if (!$from.parentOffset || !canSplit(state.doc, $from.pos)) return false
      return done(dispatching, () => state.tr.splitUnsafe($from.pos).scrollIntoView())
    }

    if (!sel.$from.depth) return false
    // Delete a non-empty selection first and work out the split from the
    // resulting cursor, so the split types describe the block actually
    // being split (prosemirror-commands 1.7.2).
    const tr = state.tr
    if (!sel.empty && (sel instanceof TextSelection || sel instanceof AllSelection)) tr.deleteSelection()
    const { $from } = tr.selection,
      mapFrom = tr.steps.length
    // The innermost block around the cursor (giving up below depth 1).
    const block = Arr.findFirst(
      Arr.makeBy(Math.max(1, $from.depth), (k) => $from.depth - k),
      (d) => $from.node(d).isBlock
    )
    if (Option.isNone(block)) return false
    const splitDepth = block.value
    const atEnd = $from.end(splitDepth) === $from.pos + ($from.depth - splitDepth),
      atStart = $from.start(splitDepth) === $from.pos - ($from.depth - splitDepth)
    const deflt = Option.getOrNull(
      defaultBlockAt($from.node(splitDepth - 1).contentMatchAtUnsafe($from.indexAfter(splitDepth - 1)))
    )
    const splitType = splitNode && splitNode($from.parent, atEnd, $from)
    const types: Array<NodeTypeWithAttrs<any> | null> = [
      splitType || (atEnd && deflt ? { type: deflt } : null),
      ...Array.from({ length: $from.depth - splitDepth }, () => null)
    ]

    const splitPos = $from.pos
    let can = canSplit(tr.doc, splitPos, types.length, types)
    if (!can) {
      types[0] = deflt ? { type: deflt } : null
      can = canSplit(tr.doc, splitPos, types.length, types)
    }
    if (!can) return false
    tr.splitUnsafe(splitPos, types.length, types)
    if (!atEnd && atStart && $from.node(splitDepth).type !== deflt) {
      const mapping = tr.mapping.slice(mapFrom)
      const first = mapping.map($from.beforeUnsafe(splitDepth)),
        $first = tr.doc.resolveUnsafe(first)
      if (deflt && $from.node(splitDepth - 1).canReplaceWith($first.index(), $first.index() + 1, deflt)) {
        tr.setNodeMarkupUnsafe(mapping.map($from.beforeUnsafe(splitDepth)), deflt)
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
    const found = Arr.findFirst(
      Arr.makeBy($pos.depth + 1, (k) => $pos.depth - k),
      (d) => !$pos.node(d).isInline
    )
    if (Option.isNone(found)) return false
    const depth = found.value
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
    return done(dispatching, () => state.tr.wrapUnsafe(range, wrapping).scrollIntoView())
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
    const ranges = state.selection.ranges
    const applicable = ranges.some(({ $from, $to }) => {
      let applies = false
      state.doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
        if (applies) return false
        if (!node.isTextblock || node.hasMarkup(nodeType, attrs)) return true
        if (node.type === nodeType) {
          applies = true
        } else {
          const $pos = state.doc.resolveUnsafe(pos),
            index = $pos.index()
          applies = $pos.parent.canReplaceWith(index, index + 1, nodeType)
        }
        return true
      })
      return applies
    })
    if (!applicable) return false
    return done(dispatching, () => {
      const tr = state.tr
      ranges.forEach(({ $from, $to }) => tr.setBlockTypeUnsafe($from.pos, $to.pos, nodeType, attrs))
      return tr.scrollIntoView()
    })
  })

function markApplies(
  doc: Node<any>,
  ranges: ReadonlyArray<SelectionRange<any>>,
  type: MarkType<any, any>,
  enterAtoms: boolean
): boolean {
  return ranges.some(({ $from, $to }) => {
    let can = $from.depth === 0 ? doc.inlineContent && doc.type.allowsMarkType(type) : false
    doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
      if (can || (!enterAtoms && node.isAtom && node.isInline && pos >= $from.pos && pos + node.nodeSize <= $to.pos))
        return false
      can = node.inlineContent && node.type.allowsMarkType(type)
      return true
    })
    return can
  })
}

function removeInlineAtoms(ranges: ReadonlyArray<SelectionRange<any>>): ReadonlyArray<SelectionRange<any>> {
  return ranges.flatMap((range) => {
    const result: Array<SelectionRange<any>> = []
    let { $from } = range
    const { $to } = range
    $from.doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
      if (node.isAtom && node.content.size && node.isInline && pos >= $from.pos && pos + node.nodeSize <= $to.pos) {
        if (pos + 1 > $from.pos) result.push(new SelectionRange($from, $from.doc.resolveUnsafe(pos + 1)))
        $from = $from.doc.resolveUnsafe(pos + 1 + node.content.size)
        return false
      }
      return true
    })
    if ($from.pos < $to.pos) result.push(new SelectionRange($from, $to))
    return result
  })
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
 * @example
 * ```ts
 * import * as assert from "node:assert"
 * import * as Effect from "effect/Effect"
 * import { toggleMark } from "@thomasfosterau/effect-richtext/Commands"
 * import { EditorState, TextSelection } from "@thomasfosterau/effect-richtext/State"
 * import { doc, p, schema, strong } from "@thomasfosterau/effect-richtext/TestBuilder"
 *
 * const start = doc(p("Hello world"))
 * let state = EditorState.createUnsafe({ doc: start, selection: TextSelection.createUnsafe(start, 1, 6) })
 *
 * // A command gets the state and a `dispatch` callback, and succeeds with `true` when it applied.
 * const handled = Effect.runSync(
 *   toggleMark(schema.marks.strong)(state, (tr) =>
 *     Effect.sync(() => {
 *       state = state.applyUnsafe(tr)
 *     })
 *   )
 * )
 *
 * assert.strictEqual(handled, true)
 * assert.ok(state.doc.eq(doc(p(strong("Hello"), " world"))))
 * ```
 *
 * @since 0.1.0
 * @category commands
 */
export const toggleMark = <Sc extends AnySchema, M extends MarkNames<Sc>>(
  markType: MarkType<Sc, M>,
  attrs?: MarkAttrsInput<Sc, M>,
  options?: ToggleMarkOptions
): Command<Sc> => {
  const removeWhenPresent = (options && options.removeWhenPresent) !== false
  const enterAtoms = (options && options.enterInlineAtoms) !== false
  const dropSpace = !(options && options.includeWhitespace)
  return syncCommand<Sc>((state, dispatching) => {
    const sel = state.selection,
      empty = sel.empty,
      $cursor = Option.getOrNull(cursorOf(state))
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
          return true
        })
        return !missing
      })
    }
    ranges.forEach(({ $from, $to }) => {
      if (!add) {
        tr.removeMark($from.pos, $to.pos, markType)
      } else {
        let from = $from.pos,
          to = $to.pos
        const start = $from.nodeAfterOrNull,
          end = $to.nodeBeforeOrNull
        const spaceStart = dropSpace && start && start.isTextNode() ? leadingSpace(start.text) : 0
        const spaceEnd = dropSpace && end && end.isTextNode() ? trailingSpace(end.text) : 0
        if (from + spaceStart < to) {
          from += spaceStart
          to -= spaceEnd
        }
        tr.addMark(from, to, markType.createUnsafe(attrs))
      }
    })
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

      // The changed ranges, as flat from/to pairs in the final document.
      const ranges = tr.mapping.maps.reduce((mapped: Array<number>, map) => {
        const next = mapped.map((pos) => map.map(pos))
        map.forEach((_s, _e, from, to) => next.push(from, to))
        return next
      }, [])

      // Figure out which joinable points exist inside those ranges,
      // by checking all node boundaries in their parent nodes.
      const joinable: Array<number> = []
      Arr.chunksOf(ranges, 2).forEach(([from, to]) => {
        const $from = tr.doc.resolveUnsafe(from),
          depth = $from.sharedDepth(to),
          parent = $from.node(depth),
          start = $from.indexAfter(depth)
        let pos = $from.afterUnsafe(depth + 1)
        parent.content.content.slice(start).some((after, i) => {
          if (pos > to) return true
          const index = start + i
          if (index && joinable.indexOf(pos) === -1) {
            const before = parent.content.content[index - 1]
            if (before.type === after.type && isJoinable(before, after)) joinable.push(pos)
          }
          pos += after.nodeSize
          return false
        })
      })
      // Join the joinable points
      Arr.reverse(Arr.sort(joinable, Num.Order)).forEach((pos) => {
        if (canJoin(tr.doc, pos)) tr.joinUnsafe(pos)
      })
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
  const canJoinNodes = Predicate.isFunction(isJoinable)
    ? isJoinable
    : (node: Node<Sc>) => isJoinable.indexOf(node.type.name) > -1
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
    type E = CommandError<Commands[number]>
    type R = CommandRequirements<Commands[number]>
    const typed: ReadonlyArray<Command<AnySchema, E, R>> = commands
    const loop = (i: number): Effect.Effect<boolean, E, R> =>
      i === typed.length
        ? succeedFalse
        : Effect.flatMap(
            Effect.suspend(() => typed[i](state, dispatch, view)),
            (handled) => (handled ? succeedTrue : loop(i + 1))
          )
    return loop(0)
  }
