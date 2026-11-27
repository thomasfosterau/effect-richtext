/**
 * Fitting slices into documents: `replaceStep` and the implementations
 * of `replaceRange`, `replaceRangeWith` and `deleteRange`.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array"
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
} from "../Model.ts"
import { TransformError } from "./errors.ts"
import { ReplaceAroundStep, ReplaceStep } from "./replace_step.ts"
import type { Step } from "./step.ts"
import { depthsAbove, insertPoint } from "./structure.ts"
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
): Option.Option<Step<Sc>> => {
  if (from === to && !slice.size) return Option.none()

  const $from = doc.resolveUnsafe(from),
    $to = doc.resolveUnsafe(to)
  // Optimization -- avoid work if it's obvious that it's not needed.
  if (fitsTrivially($from, $to, slice)) return Option.some(new ReplaceStep(from, to, slice))
  return new Fitter($from, $to, slice).fit()
}

function fitsTrivially($from: ResolvedPos<any>, $to: ResolvedPos<any>, slice: Slice<any>): boolean {
  return (
    !slice.openStart &&
    !slice.openEnd &&
    $from.start() === $to.start() &&
    $from.parent.canReplace($from.index(), $to.index(), slice.content)
  )
}

interface Fittable {
  readonly sliceDepth: number
  readonly frontierDepth: number
  // The open node of the slice at `sliceDepth`; none at depth 0.
  readonly parent: Option.Option<Node<any>>
  readonly inject?: Fragment<any>
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
    this.frontier = Arr.range(0, $from.depth).map((i) => {
      const node = $from.node(i)
      return { type: node.type, match: node.contentMatchAtUnsafe($from.indexAfter(i)) }
    })
    this.placed = depthsAbove($from.depth, 0).reduce(
      (placed, d) => Fragment.from($from.node(d).copy(placed)),
      this.placed
    )
  }

  get depth(): number {
    return this.frontier.length - 1
  }

  fit(): Option.Option<Step<any>> {
    // As long as there's unplaced content, try to place some of it.
    // If that fails, either increase the open score of the unplaced
    // slice, or drop nodes from it, and then try again.
    // A plain loop: it runs once per placement, which a large paste can
    // make too many for recursion.
    // oxlint-disable-next-line effect/imperative-loops
    while (this.unplaced.size) {
      const fit = this.findFittable()
      if (Option.isSome(fit)) this.placeNodes(fit.value)
      else if (!this.openMore()) this.dropNode()
    }
    // When there's inline content directly after the frontier _and_
    // directly after `this.$to`, we must generate a `ReplaceAround`
    // step that pulls that content into the node after the frontier.
    // That means the fitting must be done to the end of the textblock
    // node after `this.$to`, not `this.$to` itself.
    const moveInline = this.mustMoveInline(),
      placedSize = this.placed.size - this.depth - this.$from.depth
    const $from = this.$from,
      closed = this.close(moveInline < 0 ? this.$to : $from.doc.resolveUnsafe(moveInline))
    if (Option.isNone(closed)) return Option.none()
    const $to = closed.value

    // If closing to `$to` succeeded, create a step
    const slice = dropOpenParents(this.placed, $from.depth, $to.depth)
    if (moveInline > -1) {
      return Option.some(new ReplaceAroundStep($from.pos, moveInline, this.$to.pos, this.$to.end(), slice, placedSize))
    }
    if (slice.size || $from.pos !== this.$to.pos) {
      // Don't generate no-op steps
      return Option.some(new ReplaceStep($from.pos, $to.pos, slice))
    }
    return Option.none()
  }

  // Find a position on the start spine of `this.unplaced` that has
  // content that can be moved somewhere on the frontier. Returns two
  // depths, one for the slice and one for the frontier.
  findFittable(): Option.Option<Fittable> {
    const startDepth = isolatedDepth(this.unplaced.content, 0, this.unplaced.openStart, this.unplaced.openEnd)
    // Only try wrapping nodes (pass 2) after finding a place without
    // wrapping failed.
    return Arr.findFirst([1, 2], (pass) =>
      Arr.findFirst(depthsAbove(pass === 1 ? startDepth : this.unplaced.openStart, -1), (sliceDepth) =>
        this.fittableAt(pass, sliceDepth)
      )
    )
  }

  // Find a frontier node that the content at `sliceDepth` fits in.
  fittableAt(pass: number, sliceDepth: number): Option.Option<Fittable> {
    const parent = sliceDepth ? Option.some(openNodeAt(this.unplaced.content, sliceDepth - 1)) : Option.none()
    const fragment = Option.isSome(parent) ? parent.value.content : this.unplaced.content
    const first = fragment.firstChild
    // Set once the parent node would fit: don't look further up.
    let stop = false
    return Arr.findFirst(depthsAbove(this.depth, -1), (frontierDepth): Option.Option<Fittable> => {
      if (stop) return Option.none()
      const { match, type } = this.frontier[frontierDepth]
      // In pass 1, if the next node matches, or there is no next
      // node but the parents look compatible, we've found a
      // place.
      if (pass === 1) {
        if (Option.isSome(first)) {
          if (Option.isSome(match.matchType(first.value.type))) {
            return Option.some({ sliceDepth, frontierDepth, parent })
          }
          const inject = match.fillBefore(Fragment.from(first.value), false)
          if (Option.isSome(inject)) return Option.some({ sliceDepth, frontierDepth, parent, inject: inject.value })
        } else if (Option.exists(parent, (node) => type.compatibleContent(node.type))) {
          return Option.some({ sliceDepth, frontierDepth, parent })
        }
      }
      // In pass 2, look for a set of wrapping nodes that make `first`
      // fit here.
      const wrap = pass === 2 && Option.isSome(first) ? match.findWrapping(first.value.type) : Option.none()
      if (Option.isSome(wrap)) return Option.some({ sliceDepth, frontierDepth, parent, wrap: wrap.value })
      stop = Option.exists(parent, (node) => Option.isSome(match.matchType(node.type)))
      return Option.none()
    })
  }

  openMore(): boolean {
    const { content, openStart } = this.unplaced
    let { openEnd } = this.unplaced
    if (maxOpen(content, -1) <= openStart) return false
    if (this.unplaced.size > 1 && maxOpen(content, 1) > openEnd) openEnd++
    this.unplaced = new Slice(content, openStart + 1, openEnd)
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
    this.closeFrontierTo(frontierDepth)
    if (wrap) wrap.forEach((type) => this.openFrontierNode(type))

    const slice = this.unplaced,
      fragment = Option.isSome(parent) ? parent.value.content : slice.content
    const openStart = slice.openStart - sliceDepth
    let taken = 0
    const add: Array<Node<any>> = []
    let { match } = this.frontier[frontierDepth]
    const { type } = this.frontier[frontierDepth]
    if (inject) {
      add.push(...inject.content)
      const afterInject = match.matchFragment(inject)
      if (Option.isNone(afterInject)) throw new TransformError({ message: "Injected content doesn't fit " + type.name })
      match = afterInject.value
    }
    // Computes the amount of (end) open nodes at the end of the
    // fragment. When 0, the parent is open, but no more. When
    // negative, nothing is open.
    let openEndCount = fragment.size + sliceDepth - (slice.content.size - slice.openEnd)
    // Scan over the fragment, fitting as many child nodes as
    // possible.
    fragment.content.some((next) => {
      const matches = match.matchType(next.type)
      if (Option.isNone(matches)) return true
      taken++
      if (taken > 1 || openStart === 0 || next.content.size) {
        // Drop empty open nodes
        match = matches.value
        add.push(
          closeNodeStart(
            next.mark(type.allowedMarks(next.marks)),
            taken === 1 ? openStart : 0,
            taken === fragment.childCount ? openEndCount : -1
          )
        )
      }
      return false
    })
    const toEnd = taken === fragment.childCount
    if (!toEnd) openEndCount = -1

    this.placed = addToFragment(this.placed, frontierDepth, Fragment.from(add))
    this.frontier[frontierDepth].match = match

    // If the parent types match, and the entire node was moved, and
    // it's not open, close this frontier node right away.
    if (
      toEnd &&
      openEndCount < 0 &&
      Option.exists(parent, (node) => node.type === this.frontier[this.depth].type) &&
      this.frontier.length > 1
    )
      this.closeFrontierNode()

    // Add new frontier nodes for any open nodes at the end.
    const openAtEnd = (siblings: ReadonlyArray<Node<any>>, i: number): void => {
      const cur = siblings.at(-1)
      if (!cur || i >= openEndCount) return
      this.frontier.push({ type: cur.type, match: cur.contentMatchAtUnsafe(cur.childCount) })
      openAtEnd(cur.content.content, i + 1)
    }
    openAtEnd(add, 0)

    // Update `this.unplaced`. Drop the entire node from which we
    // placed it we got to its end, otherwise just drop the placed
    // nodes.
    this.unplaced = !toEnd
      ? new Slice(dropFromFragment(slice.content, sliceDepth, taken), sliceDepth, slice.openEnd)
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
    const top = this.frontier[this.depth]
    if (
      !top.type.isTextblock ||
      Option.isNone(contentAfterFits(this.$to, this.$to.depth, top.type, top.match, false)) ||
      (this.$to.depth === this.depth &&
        Option.exists(this.findCloseLevel(this.$to), (level) => level.depth === this.depth))
    )
      return -1

    // Extend past the ends of the ancestors that end right after.
    const extend = (depth: number, after: number): number =>
      depth > 1 && after === this.$to.end(depth - 1) ? extend(depth - 1, after + 1) : after
    return extend(this.$to.depth, this.$to.afterUnsafe(this.$to.depth))
  }

  findCloseLevel($to: ResolvedPos<any>): Option.Option<{ depth: number; fit: Fragment<any>; move: ResolvedPos<any> }> {
    return Arr.findFirst(depthsAbove(Math.min(this.depth, $to.depth), -1), (i) => {
      const { match, type } = this.frontier[i]
      const dropInner = i < $to.depth && $to.end(i + 1) === $to.pos + ($to.depth - (i + 1))
      const fit = contentAfterFits($to, i, type, match, dropInner)
      // The frontier nodes outside must take the rest as is.
      const outerFit = depthsAbove(i - 1, -1).every((d) => {
        const { match: innerMatch, type: innerType } = this.frontier[d]
        const matches = contentAfterFits($to, d, innerType, innerMatch, true)
        return Option.exists(matches, (fill) => !fill.childCount)
      })
      return Option.isSome(fit) && outerFit
        ? Option.some({
            depth: i,
            fit: fit.value,
            move: dropInner ? $to.doc.resolveUnsafe($to.afterUnsafe(i + 1)) : $to
          })
        : Option.none()
    })
  }

  close($to: ResolvedPos<any>): Option.Option<ResolvedPos<any>> {
    const found = this.findCloseLevel($to)
    if (Option.isNone(found)) return Option.none()
    const close = found.value

    this.closeFrontierTo(close.depth)
    if (close.fit.childCount) this.placed = addToFragment(this.placed, close.depth, close.fit)
    const $move = close.move
    Array.from({ length: $move.depth - close.depth }, (_, k) => close.depth + 1 + k).forEach((d) => {
      const node = $move.node(d)
      const add = node.type.contentMatch.fillBefore(node.content, true, $move.index(d))
      if (Option.isNone(add)) throw new TransformError({ message: "Can't complete the content of " + node.type.name })
      this.openFrontierNode(node.type, node.attrs, add.value)
    })
    return Option.some($move)
  }

  closeFrontierTo(depth: number): void {
    if (this.depth <= depth) return
    this.closeFrontierNode()
    this.closeFrontierTo(depth)
  }

  openFrontierNode(type: NodeType<any, any>, attrs?: Attrs, content?: Fragment<any>): void {
    const top = this.frontier[this.depth]
    const match = top.match.matchType(type)
    if (Option.isNone(match)) throw new TransformError({ message: type.name + " doesn't fit in " + top.type.name })
    top.match = match.value
    this.placed = addToFragment(this.placed, this.depth, Fragment.from(type.createUnsafe(attrs, content)))
    this.frontier.push({ type, match: type.contentMatch })
  }

  closeFrontierNode(): void {
    const open = this.frontier.pop()
    if (!open) throw new TransformError({ message: "No open node to close" })
    const add = open.match.fillBefore(Fragment.empty, true)
    if (Option.isNone(add)) throw new TransformError({ message: "Can't complete the content of " + open.type.name })
    if (add.value.childCount) this.placed = addToFragment(this.placed, this.frontier.length, add.value)
  }
}

function dropFromFragment(fragment: Fragment<any>, depth: number, count: number): Fragment<any> {
  if (depth === 0) return fragment.cutByIndex(count, fragment.childCount)
  const first = fragment.content[0]
  return fragment.replaceChild(0, first.copy(dropFromFragment(first.content, depth - 1, count)))
}

function addToFragment(fragment: Fragment<any>, depth: number, content: Fragment<any>): Fragment<any> {
  if (depth === 0) return fragment.append(content)
  const last = fragment.content[fragment.childCount - 1]
  return fragment.replaceChild(fragment.childCount - 1, last.copy(addToFragment(last.content, depth - 1, content)))
}

// The content that completes `fragment`, which is known to fit `match`.
function closeFill(match: ContentMatch, fragment: Fragment<any>): Fragment<any> {
  const fill = Option.flatMap(match.matchFragment(fragment), (after) => after.fillBefore(Fragment.empty, true))
  if (Option.isNone(fill)) throw new TransformError({ message: "Can't complete the content" })
  return fill.value
}

function contentAt(fragment: Fragment<any>, depth: number): Fragment<any> {
  return depth > 0 ? contentAt(fragment.content[0].content, depth - 1) : fragment
}

// Normalize a slice by dropping open parent nodes that hold a single child.
function dropOpenParents(content: Fragment<any>, openStart: number, openEnd: number): Slice<any> {
  return openStart && openEnd && content.childCount === 1
    ? dropOpenParents(content.content[0].content, openStart - 1, openEnd - 1)
    : new Slice(content, openStart, openEnd)
}

// The depth on the start spine of a slice's content, below `limit`, of
// the first isolating node that isn't open at the end; `limit` when
// there is none.
function isolatedDepth(cur: Fragment<any>, d: number, limit: number, openEnd: number): number {
  if (d >= limit) return limit
  const node = cur.content[0]
  const end = cur.childCount > 1 ? 0 : openEnd
  return node.type.spec.isolating && end <= d ? d : isolatedDepth(node.content, d + 1, limit, end)
}

// The first node of `fragment` at `depth`, which the slice leaves open.
function openNodeAt(fragment: Fragment<any>, depth: number): Node<any> {
  const node = contentAt(fragment, depth).content[0]
  if (!node) throw new TransformError({ message: "Slice has no open node at depth " + (depth + 1) })
  return node
}

function closeNodeStart(node: Node<any>, openStart: number, openEnd: number): Node<any> {
  if (openStart <= 0) return node
  let frag = node.content
  if (openStart > 1) {
    frag = frag.replaceChild(0, closeNodeStart(frag.content[0], openStart - 1, frag.childCount === 1 ? openEnd - 1 : 0))
  }
  if (openStart > 0) {
    const before = node.type.contentMatch.fillBefore(frag)
    if (Option.isNone(before)) throw new TransformError({ message: "Can't open the start of " + node.type.name })
    frag = before.value.append(frag)
    if (openEnd <= 0) {
      frag = frag.append(closeFill(node.type.contentMatch, frag))
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
): Option.Option<Fragment<any>> {
  const node = $to.node(depth),
    index = open ? $to.indexAfter(depth) : $to.index(depth)
  if (index === node.childCount && !type.compatibleContent(node.type)) return Option.none()
  return Option.filter(match.fillBefore(node.content, true, index), () => !invalidMarks(type, node.content, index))
}

function invalidMarks(type: NodeType<any, any>, fragment: Fragment<any>, start: number): boolean {
  return fragment.content.some((node, i) => i >= start && !type.allowsMarks(node.marks))
}

function definesContent(type: NodeType<any, any>): boolean {
  return !!(type.spec.defining || type.spec.definingForContent)
}

// The depth to which `frag` can be opened on the given side: the number
// of non-atom nodes along its first (`-1`) or last (`1`) edge.
function maxOpen(frag: Fragment<any>, side: -1 | 1): number {
  const ch = side < 0 ? frag.content[0] : frag.content.at(-1)
  return !ch || ch.isAtom ? 0 : 1 + maxOpen(ch.content, side)
}

/** @internal */
export function replaceRange(tr: Transform<any>, from: number, to: number, slice: Slice<any>): void {
  if (!slice.size) {
    tr.deleteRangeUnsafe(from, to)
    return
  }

  const $from = tr.doc.resolveUnsafe(from),
    $to = tr.doc.resolveUnsafe(to)
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
  depthsAbove($from.depth, 0).some((d) => {
    const spec = $from.node(d).type.spec
    if (spec.defining || spec.definingAsContext || spec.isolating) return true
    if (targetDepths.indexOf(d) > -1) preferredTarget = d
    else if ($from.beforeUnsafe(d) === $from.pos - 1 - ($from.depth - d)) targetDepths.splice(1, 0, -d)
    return false
  })
  // Try to fit each possible depth of the slice into each possible
  // target depth, starting with the preferred depths.
  const preferredTargetIndex = targetDepths.indexOf(preferredTarget)

  // The nodes along the slice's start spine, outermost first.
  const leftNodes: Array<Node<any>> = []
  const innermost = Array.from({ length: slice.openStart }).reduce<Fragment<any>>((content) => {
    const node = content.content[0]
    leftNodes.push(node)
    return node.content
  }, slice.content)
  // Missing when the innermost open node is empty.
  leftNodes.push(innermost.content[0])

  // Back up preferredDepth to cover defining textblocks directly
  // above it, possibly skipping a non-defining textblock.
  let preferredDepth = slice.openStart
  depthsAbove(preferredDepth - 1, -1).some((d) => {
    const leftNode = leftNodes[d],
      def = definesContent(leftNode.type)
    if (def && !leftNode.sameMarkup($from.node(Math.abs(preferredTarget) - 1))) preferredDepth = d
    else if (def || !leftNode.type.isTextblock) return true
    return false
  })

  const placed = depthsAbove(slice.openStart, -1).some((j) => {
    const openDepth = (j + preferredDepth + 1) % (slice.openStart + 1)
    const insert = leftNodes[openDepth]
    if (!insert) return false
    // Try the possible expansion levels, starting with the preferred one.
    return targetDepths.some((_, i) => {
      const target = targetDepths[(i + preferredTargetIndex) % targetDepths.length]
      const expand = target >= 0,
        targetDepth = Math.abs(target)
      const parent = $from.node(targetDepth - 1),
        index = $from.index(targetDepth - 1)
      if (!parent.canReplaceWith(index, index, insert.type, insert.marks)) return false
      tr.replaceUnsafe(
        $from.beforeUnsafe(targetDepth),
        expand ? $to.afterUnsafe(targetDepth) : to,
        new Slice(closeFragment(slice.content, 0, slice.openStart, openDepth), openDepth, slice.openEnd)
      )
      return true
    })
  })
  if (placed) return

  const startSteps = tr.steps.length
  Arr.reverse(targetDepths).some((depth) => {
    tr.replaceUnsafe(from, to, slice)
    if (tr.steps.length > startSteps) return true
    if (depth >= 0) {
      from = $from.beforeUnsafe(depth)
      to = $to.afterUnsafe(depth)
    }
    return false
  })
}

function closeFragment(
  fragment: Fragment<any>,
  depth: number,
  oldOpen: number,
  newOpen: number,
  parent?: Node<any>
): Fragment<any> {
  if (depth < oldOpen) {
    const first = fragment.content[0]
    fragment = fragment.replaceChild(0, first.copy(closeFragment(first.content, depth + 1, oldOpen, newOpen, first)))
  }
  if (depth > newOpen) {
    if (!parent) throw new TransformError({ message: "No parent node at depth " + depth })
    const match = parent.contentMatchAtUnsafe(0)
    const before = match.fillBefore(fragment)
    if (Option.isNone(before)) throw new TransformError({ message: "Can't open the start of " + parent.type.name })
    const start = before.value.append(fragment)
    fragment = start.append(closeFill(match, start))
  }
  return fragment
}

/** @internal */
export function replaceRangeWith(tr: Transform<any>, from: number, to: number, node: Node<any>): void {
  if (!node.isInline && from === to && tr.doc.resolveUnsafe(from).parent.content.size) {
    const point = insertPoint(tr.doc, from, node.type)
    if (Option.isSome(point)) from = to = point.value
  }
  tr.replaceRangeUnsafe(from, to, new Slice(Fragment.from(node), 0, 0))
}

/** @internal */
export function deleteRange(tr: Transform<any>, from: number, to: number): void {
  let $from = tr.doc.resolveUnsafe(from),
    $to = tr.doc.resolveUnsafe(to)

  // When the deleted range spans from the start of one textblock to
  // the start of another one, move out of the start of both blocks.
  if (
    $from.parent.isTextblock &&
    $to.parent.isTextblock &&
    $from.start() !== $to.start() &&
    $from.parentOffset === 0 &&
    $to.parentOffset === 0
  ) {
    const shared = $from.sharedDepth(to)
    const isolated =
      depthsAbove($from.depth, shared).some((d) => $from.node(d).type.spec.isolating) ||
      depthsAbove($to.depth, shared).some((d) => $to.node(d).type.spec.isolating)
    if (!isolated) {
      from = outOfStarts($from, from, $from.depth)
      to = outOfStarts($to, to, $to.depth)
      $from = tr.doc.resolveUnsafe(from)
      $to = tr.doc.resolveUnsafe(to)
    }
  }

  const covered = coveredDepths($from, $to)
  const deletedCovered = covered.some((depth, i) => {
    const last = i === covered.length - 1
    if ((last && depth === 0) || $from.node(depth).type.contentMatch.validEnd) {
      tr.deleteUnsafe($from.start(depth), $to.end(depth))
      return true
    }
    if (depth > 0 && (last || $from.node(depth - 1).canReplace($from.index(depth - 1), $to.indexAfter(depth - 1)))) {
      tr.deleteUnsafe($from.beforeUnsafe(depth), $to.afterUnsafe(depth))
      return true
    }
    return false
  })
  if (deletedCovered) return
  const deletedOpen = Array.from({ length: Math.min($from.depth, $to.depth) }, (_, k) => k + 1).some((d) => {
    if (
      from - $from.start(d) === $from.depth - d &&
      to > $from.end(d) &&
      $to.end(d) - to !== $to.depth - d &&
      $from.start(d - 1) === $to.start(d - 1) &&
      $from.node(d - 1).canReplace($from.index(d - 1), $to.index(d - 1))
    ) {
      tr.deleteUnsafe($from.beforeUnsafe(d), to)
      return true
    }
    return false
  })
  if (!deletedOpen) tr.deleteUnsafe(from, to)
}

// Returns an array of all depths for which $from - $to spans the
// whole content of the nodes at that depth.
function coveredDepths($from: ResolvedPos<any>, $to: ResolvedPos<any>): Array<number> {
  const result: Array<number> = []
  depthsAbove(Math.min($from.depth, $to.depth), -1).some((d) => {
    const start = $from.start(d)
    if (
      start < $from.pos - ($from.depth - d) ||
      $to.end(d) > $to.pos + ($to.depth - d) ||
      $from.node(d).type.spec.isolating ||
      $to.node(d).type.spec.isolating
    )
      return true
    if (
      start === $to.start(d) ||
      (d === $from.depth &&
        d === $to.depth &&
        $from.parent.inlineContent &&
        $to.parent.inlineContent &&
        d &&
        $to.start(d - 1) === start - 1)
    )
      result.push(d)
    return false
  })
  return result
}

// Move `pos` out of the ancestors (from `depth` up) that it is at the start of.
function outOfStarts($pos: ResolvedPos<any>, pos: number, depth: number): number {
  return depth > 0 && pos === $pos.start(depth) ? outOfStarts($pos, $pos.beforeUnsafe(depth), depth - 1) : pos
}
