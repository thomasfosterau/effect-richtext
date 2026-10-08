/**
 * Fitting slices into documents: `replaceStep` and the implementations
 * of `replaceRange`, `replaceRangeWith` and `deleteRange`.
 *
 * @since 0.1.0
 */
import * as Option from "effect/Option"
import {
  type AnySchema,
  type Attrs,
  type ContentMatch,
  Fragment,
  type Node,
  type NodeType,
  type ResolvedPos,
  Slice
} from "../model.ts"
import { ReplaceAroundStep, ReplaceStep } from "./replace_step.ts"
import type { Step } from "./step.ts"
import { insertPointOrNull } from "./structure.ts"
import type { Transform } from "./transform.ts"

/**
 * ‘Fit’ a slice into a given position in the document, producing a step
 * that inserts it. Will return `None` if there's no meaningful way to
 * insert the slice here, or inserting it would be a no-op (an empty
 * slice over an empty range). Throws a `PositionError` when `from` or
 * `to` are outside of the document.
 *
 * @since 0.1.0
 * @category queries
 */
export const replaceStep = <Sc extends AnySchema>(
  doc: Node<Sc>,
  from: number,
  to = from,
  slice: Slice<Sc> = Slice.empty
): Option.Option<Step<Sc>> => Option.fromNullishOr(replaceStepOrNull(doc, from, to, slice))

/** @internal */
export function replaceStepOrNull<Sc extends AnySchema>(
  doc: Node<Sc>,
  from: number,
  to = from,
  slice: Slice<Sc> = Slice.empty
): Step<Sc> | null {
  if (from === to && !slice.size) return null

  const $from = doc.resolveUnsafe(from), $to = doc.resolveUnsafe(to)
  // Optimization -- avoid work if it's obvious that it's not needed.
  if (fitsTrivially($from, $to, slice)) return new ReplaceStep(from, to, slice)
  return new Fitter($from, $to, slice).fit() as Step<Sc> | null
}

function fitsTrivially($from: ResolvedPos<any>, $to: ResolvedPos<any>, slice: Slice<any>): boolean {
  return !slice.openStart && !slice.openEnd && $from.start() === $to.start() &&
    $from.parent.canReplace($from.index(), $to.index(), slice.content)
}

interface Fittable {
  readonly sliceDepth: number
  readonly frontierDepth: number
  readonly parent: Node<any> | null
  readonly inject?: Fragment<any> | null
  readonly wrap?: ReadonlyArray<NodeType<any, any>>
}

// Algorithm for 'placing' the elements of a slice into a gap:
//
// We consider the content of each node that is open to the left to be
// independently placeable. I.e. in <p("foo"), p("bar")>, when the
// paragraph on the left is open, "foo" can be placed (somewhere on
// the left side of the replacement gap) independently from p("bar").
//
// This class tracks the state of the placement progress in the
// following properties:
//
//  - `frontier` holds a stack of `{type, match}` objects that
//    represent the open side of the replacement. It starts at
//    `$from`, then moves forward as content is placed, and is finally
//    reconciled with `$to`.
//
//  - `unplaced` is a slice that represents the content that hasn't
//    been placed yet.
//
//  - `placed` is a fragment of placed content. Its open-start value
//    is implicit in `$from`, and its open-end value in `frontier`.
class Fitter {
  frontier: Array<{ type: NodeType<any, any>; match: ContentMatch }> = []
  placed: Fragment<any> = Fragment.empty

  constructor(
    readonly $from: ResolvedPos<any>,
    readonly $to: ResolvedPos<any>,
    public unplaced: Slice<any>
  ) {
    for (let i = 0; i <= $from.depth; i++) {
      const node = $from.node(i)
      this.frontier.push({
        type: node.type,
        match: node.contentMatchAtUnsafe($from.indexAfter(i))
      })
    }

    for (let i = $from.depth; i > 0; i--) this.placed = Fragment.from($from.node(i).copy(this.placed))
  }

  get depth(): number {
    return this.frontier.length - 1
  }

  fit(): Step<any> | null {
    // As long as there's unplaced content, try to place some of it.
    // If that fails, either increase the open score of the unplaced
    // slice, or drop nodes from it, and then try again.
    while (this.unplaced.size) {
      const fit = this.findFittable()
      if (fit) this.placeNodes(fit)
      else if (!this.openMore()) this.dropNode()
    }
    // When there's inline content directly after the frontier _and_
    // directly after `this.$to`, we must generate a `ReplaceAround`
    // step that pulls that content into the node after the frontier.
    // That means the fitting must be done to the end of the textblock
    // node after `this.$to`, not `this.$to` itself.
    const moveInline = this.mustMoveInline(), placedSize = this.placed.size - this.depth - this.$from.depth
    const $from = this.$from, $to = this.close(moveInline < 0 ? this.$to : $from.doc.resolveUnsafe(moveInline))
    if (!$to) return null

    // If closing to `$to` succeeded, create a step
    let content = this.placed, openStart = $from.depth, openEnd = $to.depth
    while (openStart && openEnd && content.childCount === 1) { // Normalize by dropping open parent nodes
      content = content.content[0]!.content
      openStart--
      openEnd--
    }
    const slice = new Slice(content, openStart, openEnd)
    if (moveInline > -1) {
      return new ReplaceAroundStep($from.pos, moveInline, this.$to.pos, this.$to.end(), slice, placedSize)
    }
    if (slice.size || $from.pos !== this.$to.pos) { // Don't generate no-op steps
      return new ReplaceStep($from.pos, $to.pos, slice)
    }
    return null
  }

  // Find a position on the start spine of `this.unplaced` that has
  // content that can be moved somewhere on the frontier. Returns two
  // depths, one for the slice and one for the frontier.
  findFittable(): Fittable | undefined {
    let startDepth = this.unplaced.openStart
    for (let cur = this.unplaced.content, d = 0, openEnd = this.unplaced.openEnd; d < startDepth; d++) {
      const node = cur.content[0]!
      if (cur.childCount > 1) openEnd = 0
      if (node.type.spec.isolating && openEnd <= d) {
        startDepth = d
        break
      }
      cur = node.content
    }

    // Only try wrapping nodes (pass 2) after finding a place without
    // wrapping failed.
    for (let pass = 1; pass <= 2; pass++) {
      for (let sliceDepth = pass === 1 ? startDepth : this.unplaced.openStart; sliceDepth >= 0; sliceDepth--) {
        let fragment: Fragment<any>, parent: Node<any> | null = null
        if (sliceDepth) {
          parent = contentAt(this.unplaced.content, sliceDepth - 1).content[0]!
          fragment = parent.content
        } else {
          fragment = this.unplaced.content
        }
        const first = fragment.content[0]
        for (let frontierDepth = this.depth; frontierDepth >= 0; frontierDepth--) {
          const { match, type } = this.frontier[frontierDepth]!
          let wrap: ReadonlyArray<NodeType<any, any>> | null = null, inject: Fragment<any> | null = null
          // In pass 1, if the next node matches, or there is no next
          // node but the parents look compatible, we've found a
          // place.
          if (
            pass === 1 && (first
              ? match.matchTypeOrNull(first.type) || (inject = match.fillBeforeOrNull(Fragment.from(first), false))
              : parent && type.compatibleContent(parent.type))
          ) {
            return { sliceDepth, frontierDepth, parent, inject }
          } // In pass 2, look for a set of wrapping nodes that make
          // `first` fit here.
          else if (pass === 2 && first && (wrap = match.findWrappingOrNull(first.type))) {
            return { sliceDepth, frontierDepth, parent, wrap }
          }
          // Don't continue looking further up if the parent node
          // would fit here.
          if (parent && match.matchTypeOrNull(parent.type)) break
        }
      }
    }
    return undefined
  }

  openMore(): boolean {
    const { content, openEnd, openStart } = this.unplaced
    const inner = contentAt(content, openStart)
    if (!inner.childCount || inner.content[0]!.isLeaf) return false
    this.unplaced = new Slice(
      content,
      openStart + 1,
      Math.max(openEnd, inner.size + openStart >= content.size - openEnd ? openStart + 1 : 0)
    )
    return true
  }

  dropNode(): void {
    const { content, openEnd, openStart } = this.unplaced
    const inner = contentAt(content, openStart)
    if (inner.childCount <= 1 && openStart > 0) {
      const openAtEnd = content.size - openStart <= openStart + inner.size
      this.unplaced = new Slice(
        dropFromFragment(content, openStart - 1, 1),
        openStart - 1,
        openAtEnd ? openStart - 1 : openEnd
      )
    } else {
      this.unplaced = new Slice(dropFromFragment(content, openStart, 1), openStart, openEnd)
    }
  }

  // Move content from the unplaced slice at `sliceDepth` to the
  // frontier node at `frontierDepth`. Close that frontier node when
  // applicable.
  placeNodes({ frontierDepth, inject, parent, sliceDepth, wrap }: Fittable): void {
    while (this.depth > frontierDepth) this.closeFrontierNode()
    if (wrap) { for (let i = 0; i < wrap.length; i++) this.openFrontierNode(wrap[i]!) }

    const slice = this.unplaced, fragment = parent ? parent.content : slice.content
    const openStart = slice.openStart - sliceDepth
    let taken = 0
    const add: Array<Node<any>> = []
    let { match } = this.frontier[frontierDepth]!
    const { type } = this.frontier[frontierDepth]!
    if (inject) {
      for (let i = 0; i < inject.childCount; i++) add.push(inject.content[i]!)
      match = match.matchFragmentOrNull(inject)!
    }
    // Computes the amount of (end) open nodes at the end of the
    // fragment. When 0, the parent is open, but no more. When
    // negative, nothing is open.
    let openEndCount = (fragment.size + sliceDepth) - (slice.content.size - slice.openEnd)
    // Scan over the fragment, fitting as many child nodes as
    // possible.
    while (taken < fragment.childCount) {
      const next = fragment.content[taken]!, matches = match.matchTypeOrNull(next.type)
      if (!matches) break
      taken++
      if (taken > 1 || openStart === 0 || next.content.size) { // Drop empty open nodes
        match = matches
        add.push(closeNodeStart(
          next.mark(type.allowedMarks(next.marks)),
          taken === 1 ? openStart : 0,
          taken === fragment.childCount ? openEndCount : -1
        ))
      }
    }
    const toEnd = taken === fragment.childCount
    if (!toEnd) openEndCount = -1

    this.placed = addToFragment(this.placed, frontierDepth, Fragment.from(add))
    this.frontier[frontierDepth]!.match = match

    // If the parent types match, and the entire node was moved, and
    // it's not open, close this frontier node right away.
    if (
      toEnd && openEndCount < 0 && parent && parent.type === this.frontier[this.depth]!.type &&
      this.frontier.length > 1
    ) this.closeFrontierNode()

    // Add new frontier nodes for any open nodes at the end.
    for (let i = 0, cur = fragment; i < openEndCount; i++) {
      const node = cur.content[cur.content.length - 1]!
      this.frontier.push({ type: node.type, match: node.contentMatchAtUnsafe(node.childCount) })
      cur = node.content
    }

    // Update `this.unplaced`. Drop the entire node from which we
    // placed it we got to its end, otherwise just drop the placed
    // nodes.
    this.unplaced = !toEnd
      ? new Slice(dropFromFragment(slice.content, sliceDepth, taken), slice.openStart, slice.openEnd)
      : sliceDepth === 0
      ? Slice.empty
      : new Slice(
        dropFromFragment(slice.content, sliceDepth - 1, 1),
        sliceDepth - 1,
        openEndCount < 0 ? slice.openEnd : sliceDepth - 1
      )
  }

  mustMoveInline(): number {
    if (!this.$to.parent.isTextblock) return -1
    const top = this.frontier[this.depth]!
    let level: ReturnType<Fitter["findCloseLevel"]>
    if (
      !top.type.isTextblock || !contentAfterFits(this.$to, this.$to.depth, top.type, top.match, false) ||
      (this.$to.depth === this.depth && (level = this.findCloseLevel(this.$to)) && level.depth === this.depth)
    ) return -1

    let { depth } = this.$to, after = this.$to.afterUnsafe(depth)
    while (depth > 1 && after === this.$to.end(--depth)) ++after
    return after
  }

  findCloseLevel(
    $to: ResolvedPos<any>
  ): { depth: number; fit: Fragment<any>; move: ResolvedPos<any> } | undefined {
    scan: for (let i = Math.min(this.depth, $to.depth); i >= 0; i--) {
      const { match, type } = this.frontier[i]!
      const dropInner = i < $to.depth && $to.end(i + 1) === $to.pos + ($to.depth - (i + 1))
      const fit = contentAfterFits($to, i, type, match, dropInner)
      if (!fit) continue
      for (let d = i - 1; d >= 0; d--) {
        const { match, type } = this.frontier[d]!
        const matches = contentAfterFits($to, d, type, match, true)
        if (!matches || matches.childCount) continue scan
      }
      return { depth: i, fit, move: dropInner ? $to.doc.resolveUnsafe($to.afterUnsafe(i + 1)) : $to }
    }
    return undefined
  }

  close($to: ResolvedPos<any>): ResolvedPos<any> | null {
    const close = this.findCloseLevel($to)
    if (!close) return null

    while (this.depth > close.depth) this.closeFrontierNode()
    if (close.fit.childCount) this.placed = addToFragment(this.placed, close.depth, close.fit)
    $to = close.move
    for (let d = close.depth + 1; d <= $to.depth; d++) {
      const node = $to.node(d), add = node.type.contentMatch.fillBeforeOrNull(node.content, true, $to.index(d))!
      this.openFrontierNode(node.type, node.attrs, add)
    }
    return $to
  }

  openFrontierNode(type: NodeType<any, any>, attrs: Attrs | null = null, content?: Fragment<any>): void {
    const top = this.frontier[this.depth]!
    top.match = top.match.matchTypeOrNull(type)!
    this.placed = addToFragment(this.placed, this.depth, Fragment.from(type.createUnsafe(attrs, content)))
    this.frontier.push({ type, match: type.contentMatch })
  }

  closeFrontierNode(): void {
    const open = this.frontier.pop()!
    const add = open.match.fillBeforeOrNull(Fragment.empty, true)!
    if (add.childCount) this.placed = addToFragment(this.placed, this.frontier.length, add)
  }
}

function dropFromFragment(fragment: Fragment<any>, depth: number, count: number): Fragment<any> {
  if (depth === 0) return fragment.cutByIndex(count, fragment.childCount)
  const first = fragment.content[0]!
  return fragment.replaceChild(0, first.copy(dropFromFragment(first.content, depth - 1, count)))
}

function addToFragment(fragment: Fragment<any>, depth: number, content: Fragment<any>): Fragment<any> {
  if (depth === 0) return fragment.append(content)
  const last = fragment.content[fragment.childCount - 1]!
  return fragment.replaceChild(fragment.childCount - 1, last.copy(addToFragment(last.content, depth - 1, content)))
}

function contentAt(fragment: Fragment<any>, depth: number): Fragment<any> {
  for (let i = 0; i < depth; i++) fragment = fragment.content[0]!.content
  return fragment
}

function closeNodeStart(node: Node<any>, openStart: number, openEnd: number): Node<any> {
  if (openStart <= 0) return node
  let frag = node.content
  if (openStart > 1) {
    frag = frag.replaceChild(
      0,
      closeNodeStart(frag.content[0]!, openStart - 1, frag.childCount === 1 ? openEnd - 1 : 0)
    )
  }
  if (openStart > 0) {
    frag = node.type.contentMatch.fillBeforeOrNull(frag)!.append(frag)
    if (openEnd <= 0) {
      frag = frag.append(node.type.contentMatch.matchFragmentOrNull(frag)!.fillBeforeOrNull(Fragment.empty, true)!)
    }
  }
  return node.copy(frag)
}

function contentAfterFits(
  $to: ResolvedPos<any>,
  depth: number,
  type: NodeType<any, any>,
  match: ContentMatch,
  open: boolean
): Fragment<any> | null {
  const node = $to.node(depth), index = open ? $to.indexAfter(depth) : $to.index(depth)
  if (index === node.childCount && !type.compatibleContent(node.type)) return null
  const fit = match.fillBeforeOrNull(node.content, true, index)
  return fit && !invalidMarks(type, node.content, index) ? fit : null
}

function invalidMarks(type: NodeType<any, any>, fragment: Fragment<any>, start: number): boolean {
  for (let i = start; i < fragment.childCount; i++) {
    if (!type.allowsMarks(fragment.content[i]!.marks)) return true
  }
  return false
}

function definesContent(type: NodeType<any, any>): boolean | undefined {
  return type.spec.defining || type.spec.definingForContent
}

/** @internal */
export function replaceRange(tr: Transform<any>, from: number, to: number, slice: Slice<any>): void {
  if (!slice.size) {
    tr.deleteRangeUnsafe(from, to)
    return
  }

  const $from = tr.doc.resolveUnsafe(from), $to = tr.doc.resolveUnsafe(to)
  if (fitsTrivially($from, $to, slice)) {
    tr.stepUnsafe(new ReplaceStep(from, to, slice))
    return
  }

  const targetDepths = coveredDepths($from, $to)
  // Can't replace the whole document, so remove 0 if it's present
  if (targetDepths[targetDepths.length - 1] === 0) targetDepths.pop()
  // Negative numbers represent not expansion over the whole node at
  // that depth, but replacing from $from.before(-D) to $to.pos.
  let preferredTarget = -($from.depth + 1)
  targetDepths.unshift(preferredTarget)
  // This loop picks a preferred target depth, if one of the covering
  // depths is not outside of a defining node, and adds negative
  // depths for any depth that has $from at its start and does not
  // cross a defining node.
  for (let d = $from.depth, pos = $from.pos - 1; d > 0; d--, pos--) {
    const spec = $from.node(d).type.spec
    if (spec.defining || spec.definingAsContext || spec.isolating) break
    if (targetDepths.indexOf(d) > -1) preferredTarget = d
    else if ($from.beforeUnsafe(d) === pos) targetDepths.splice(1, 0, -d)
  }
  // Try to fit each possible depth of the slice into each possible
  // target depth, starting with the preferred depths.
  const preferredTargetIndex = targetDepths.indexOf(preferredTarget)

  const leftNodes: Array<Node<any>> = []
  let preferredDepth = slice.openStart
  for (let content = slice.content, i = 0;; i++) {
    const node = content.content[0]!
    leftNodes.push(node)
    if (i === slice.openStart) break
    content = node.content
  }

  // Back up preferredDepth to cover defining textblocks directly
  // above it, possibly skipping a non-defining textblock.
  for (let d = preferredDepth - 1; d >= 0; d--) {
    const leftNode = leftNodes[d]!, def = definesContent(leftNode.type)
    if (def && !leftNode.sameMarkup($from.node(Math.abs(preferredTarget) - 1))) preferredDepth = d
    else if (def || !leftNode.type.isTextblock) break
  }

  for (let j = slice.openStart; j >= 0; j--) {
    const openDepth = (j + preferredDepth + 1) % (slice.openStart + 1)
    const insert = leftNodes[openDepth]
    if (!insert) continue
    for (let i = 0; i < targetDepths.length; i++) {
      // Loop over possible expansion levels, starting with the
      // preferred one
      let targetDepth = targetDepths[(i + preferredTargetIndex) % targetDepths.length]!, expand = true
      if (targetDepth < 0) {
        expand = false
        targetDepth = -targetDepth
      }
      const parent = $from.node(targetDepth - 1), index = $from.index(targetDepth - 1)
      if (parent.canReplaceWith(index, index, insert.type, insert.marks)) {
        tr.replaceUnsafe(
          $from.beforeUnsafe(targetDepth),
          expand ? $to.afterUnsafe(targetDepth) : to,
          new Slice(closeFragment(slice.content, 0, slice.openStart, openDepth), openDepth, slice.openEnd)
        )
        return
      }
    }
  }

  const startSteps = tr.steps.length
  for (let i = targetDepths.length - 1; i >= 0; i--) {
    tr.replaceUnsafe(from, to, slice)
    if (tr.steps.length > startSteps) break
    const depth = targetDepths[i]!
    if (depth < 0) continue
    from = $from.beforeUnsafe(depth)
    to = $to.afterUnsafe(depth)
  }
}

function closeFragment(
  fragment: Fragment<any>,
  depth: number,
  oldOpen: number,
  newOpen: number,
  parent?: Node<any>
): Fragment<any> {
  if (depth < oldOpen) {
    const first = fragment.content[0]!
    fragment = fragment.replaceChild(0, first.copy(closeFragment(first.content, depth + 1, oldOpen, newOpen, first)))
  }
  if (depth > newOpen) {
    const match = parent!.contentMatchAtUnsafe(0)
    const start = match.fillBeforeOrNull(fragment)!.append(fragment)
    fragment = start.append(match.matchFragmentOrNull(start)!.fillBeforeOrNull(Fragment.empty, true)!)
  }
  return fragment
}

/** @internal */
export function replaceRangeWith(tr: Transform<any>, from: number, to: number, node: Node<any>): void {
  if (!node.isInline && from === to && tr.doc.resolveUnsafe(from).parent.content.size) {
    const point = insertPointOrNull(tr.doc, from, node.type)
    if (point != null) from = to = point
  }
  tr.replaceRangeUnsafe(from, to, new Slice(Fragment.from(node), 0, 0))
}

/** @internal */
export function deleteRange(tr: Transform<any>, from: number, to: number): void {
  let $from = tr.doc.resolveUnsafe(from), $to = tr.doc.resolveUnsafe(to)

  // When the deleted range spans from the start of one textblock to
  // the start of another one, move out of the start of both blocks.
  if (
    $from.parent.isTextblock && $to.parent.isTextblock && $from.start() !== $to.start() &&
    $from.parentOffset === 0 && $to.parentOffset === 0
  ) {
    const shared = $from.sharedDepth(to)
    let isolated = false
    for (let d = $from.depth; d > shared; d--) if ($from.node(d).type.spec.isolating) isolated = true
    for (let d = $to.depth; d > shared; d--) if ($to.node(d).type.spec.isolating) isolated = true
    if (!isolated) {
      for (let d = $from.depth; d > 0 && from === $from.start(d); d--) from = $from.beforeUnsafe(d)
      for (let d = $to.depth; d > 0 && to === $to.start(d); d--) to = $to.beforeUnsafe(d)
      $from = tr.doc.resolveUnsafe(from)
      $to = tr.doc.resolveUnsafe(to)
    }
  }

  const covered = coveredDepths($from, $to)
  for (let i = 0; i < covered.length; i++) {
    const depth = covered[i]!, last = i === covered.length - 1
    if ((last && depth === 0) || $from.node(depth).type.contentMatch.validEnd) {
      tr.deleteUnsafe($from.start(depth), $to.end(depth))
      return
    }
    if (
      depth > 0 && (last || $from.node(depth - 1).canReplace($from.index(depth - 1), $to.indexAfter(depth - 1)))
    ) {
      tr.deleteUnsafe($from.beforeUnsafe(depth), $to.afterUnsafe(depth))
      return
    }
  }
  for (let d = 1; d <= $from.depth && d <= $to.depth; d++) {
    if (
      from - $from.start(d) === $from.depth - d && to > $from.end(d) && $to.end(d) - to !== $to.depth - d &&
      $from.start(d - 1) === $to.start(d - 1) && $from.node(d - 1).canReplace($from.index(d - 1), $to.index(d - 1))
    ) {
      tr.deleteUnsafe($from.beforeUnsafe(d), to)
      return
    }
  }
  tr.deleteUnsafe(from, to)
}

// Returns an array of all depths for which $from - $to spans the
// whole content of the nodes at that depth.
function coveredDepths($from: ResolvedPos<any>, $to: ResolvedPos<any>): Array<number> {
  const result: Array<number> = [], minDepth = Math.min($from.depth, $to.depth)
  for (let d = minDepth; d >= 0; d--) {
    const start = $from.start(d)
    if (
      start < $from.pos - ($from.depth - d) ||
      $to.end(d) > $to.pos + ($to.depth - d) ||
      $from.node(d).type.spec.isolating ||
      $to.node(d).type.spec.isolating
    ) break
    if (
      start === $to.start(d) ||
      (d === $from.depth && d === $to.depth && $from.parent.inlineContent && $to.parent.inlineContent &&
        d && $to.start(d - 1) === start - 1)
    ) result.push(d)
  }
  return result
}
