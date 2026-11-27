/**
 * Structural queries (`liftTarget`, `findWrapping`, `canSplit`, …) and
 * the structure-changing transform implementations.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import {
  type AnySchema,
  type Attrs,
  type ContentMatch,
  Fragment,
  type Mark,
  type Node,
  type NodeAttrsInput,
  type NodeNames,
  type NodeRange,
  type NodeType,
  Slice
} from "../Model.ts"
import { TransformError } from "./errors.ts"
import { clearIncompatible } from "./mark.ts"
import { ReplaceAroundStep, ReplaceStep } from "./replace_step.ts"
import type { Transform } from "./transform.ts"

/**
 * A node type paired with (optional) attributes, as used by `wrap`,
 * `split` and `findWrapping`. For typed schemas, the attributes are
 * typed according to the node type. A node type whose name isn't known
 * statically can be given without attributes (defaults are used).
 *
 * @since 0.1.0
 * @category models
 */
export type NodeTypeWithAttrs<Sc extends AnySchema = AnySchema> =
  | {
      readonly [N in NodeNames<Sc>]: {
        readonly type: NodeType<Sc, N>
        readonly attrs?: NodeAttrsInput<Sc, N>
      }
    }[NodeNames<Sc>]
  | { readonly type: NodeType<Sc>; readonly attrs?: never }

type AnyWrapper = { readonly type: NodeType<any, any>; readonly attrs?: Attrs }

function canCut(node: Node<any>, start: number, end: number): boolean {
  return (
    (start === 0 || node.canReplace(start, node.childCount)) && (end === node.childCount || node.canReplace(0, end))
  )
}

/**
 * Try to find a target depth to which the content in the given range
 * can be lifted. Will not go across isolating parent nodes.
 *
 * @since 0.1.0
 * @category queries
 */
export const liftTarget = <Sc extends AnySchema>(range: NodeRange<Sc>): Option.Option<number> => {
  const parent = range.parent
  const content = parent.content.cutByIndex(range.startIndex, range.endIndex)
  // Walk outwards; once content is left before (or after) the range at
  // some level, the outer levels keep a node on that side. -1 when no
  // level fits.
  const search = (depth: number, contentBefore: number, contentAfter: number): number => {
    const node = range.$from.node(depth)
    const index = range.$from.index(depth) + contentBefore,
      endIndex = range.$to.indexAfter(depth) - contentAfter
    if (depth < range.depth && node.canReplace(index, endIndex, content)) return depth
    if (depth === 0 || node.type.spec.isolating || !canCut(node, index, endIndex)) return -1
    return search(depth - 1, index ? 1 : contentBefore, endIndex < node.childCount ? 1 : contentAfter)
  }
  const target = search(range.depth, 0, 0)
  return target < 0 ? Option.none() : Option.some(target)
}

// The depths from `from` down to just above `to`, deepest first.
/** @internal */
export const depthsAbove = (from: number, to: number): ReadonlyArray<number> =>
  Array.from({ length: Math.max(0, from - to) }, (_, i) => from - i)

/** @internal */
export function lift(tr: Transform<any>, range: NodeRange<any>, target: number): void {
  const { $from, $to, depth } = range

  const gapStart = $from.beforeUnsafe(depth + 1),
    gapEnd = $to.afterUnsafe(depth + 1)
  let start = gapStart,
    end = gapEnd

  let before: Fragment<any> = Fragment.empty,
    openStart = 0,
    splitBefore = false
  depthsAbove(depth, target).forEach((d) => {
    if (splitBefore || $from.index(d) > 0) {
      splitBefore = true
      before = Fragment.from($from.node(d).copy(before))
      openStart++
    } else {
      start--
    }
  })
  let after: Fragment<any> = Fragment.empty,
    openEnd = 0,
    splitAfter = false
  depthsAbove(depth, target).forEach((d) => {
    if (splitAfter || $to.afterUnsafe(d + 1) < $to.end(d)) {
      splitAfter = true
      after = Fragment.from($to.node(d).copy(after))
      openEnd++
    } else {
      end++
    }
  })

  tr.stepUnsafe(
    new ReplaceAroundStep(
      start,
      end,
      gapStart,
      gapEnd,
      new Slice(before.append(after), openStart, openEnd),
      before.size - openStart,
      true
    )
  )
}

/**
 * Try to find a valid way to wrap the content in the given range in a
 * node of the given type. May introduce extra nodes around and inside
 * the wrapper node, if necessary. Returns `None` if no valid wrapping
 * could be found. When `innerRange` is given, that range's content is
 * used as the content to fit into the wrapping, instead of the content
 * of `range`.
 *
 * @since 0.1.0
 * @category queries
 */
export const findWrapping = <Sc extends AnySchema, N extends NodeNames<Sc>>(
  range: NodeRange<Sc>,
  nodeType: NodeType<Sc, N>,
  attrs?: NodeAttrsInput<Sc, N>,
  innerRange: NodeRange<Sc> = range
): Option.Option<ReadonlyArray<NodeTypeWithAttrs<Sc>>> =>
  Option.flatMap(findWrappingOutside(range, nodeType), (around) =>
    Option.map(findWrappingInside(innerRange, nodeType), (inner): ReadonlyArray<NodeTypeWithAttrs<Sc>> => {
      const wrapper: AnyWrapper = attrs === undefined ? { type: nodeType } : { type: nodeType, attrs }
      return [...around.map(withoutAttrs), wrapper, ...inner.map(withoutAttrs)]
    })
  )

const withoutAttrs = (type: NodeType<any, any>): AnyWrapper => ({ type })

function findWrappingOutside(
  range: NodeRange<any>,
  type: NodeType<any, any>
): Option.Option<ReadonlyArray<NodeType<any, any>>> {
  const { parent, startIndex, endIndex } = range
  return Option.filter(parent.contentMatchAtUnsafe(startIndex).findWrapping(type), (around) =>
    parent.canReplaceWith(startIndex, endIndex, around.length ? around[0] : type)
  )
}

function findWrappingInside(
  range: NodeRange<any>,
  type: NodeType<any, any>
): Option.Option<ReadonlyArray<NodeType<any, any>>> {
  const { endIndex, parent, startIndex } = range
  const inner = parent.content.content[startIndex]
  return Option.filter(type.contentMatch.findWrapping(inner.type), (inside) => {
    const lastType = inside.length ? inside[inside.length - 1] : type
    const innerMatch = lastType.contentMatch.matchFragment(parent.content, startIndex, endIndex)
    return Option.exists(innerMatch, (match) => match.validEnd)
  })
}

/** @internal */
export function wrap(tr: Transform<any>, range: NodeRange<any>, wrappers: ReadonlyArray<AnyWrapper>): void {
  const content = wrappers.reduceRight<Fragment<any>>((inner, wrapper) => {
    if (inner.size) {
      if (!Option.exists(wrapper.type.contentMatch.matchFragment(inner), (match) => match.validEnd)) {
        throw new TransformError({
          message: "Wrapper type given to Transform.wrap does not form valid content of its parent wrapper"
        })
      }
    }
    return Fragment.from(wrapper.type.createUnsafe(wrapper.attrs, inner))
  }, Fragment.empty)

  const start = range.start,
    end = range.end
  tr.stepUnsafe(new ReplaceAroundStep(start, end, start, end, new Slice(content, 0, 0), wrappers.length, true))
}

/** @internal */
export function setBlockType(
  tr: Transform<any>,
  from: number,
  to: number,
  type: NodeType<any, any>,
  attrs?: Attrs | ((oldNode: Node<any>) => Attrs)
): void {
  if (!type.isTextblock) throw new TransformError({ message: "Type given to setBlockType should be a textblock" })
  const mapFrom = tr.steps.length
  const linebreak = type.schema.linebreakReplacement
  tr.doc.nodesBetween(from, to, (node, pos) => {
    const attrsHere = Predicate.isFunction(attrs) ? attrs(node) : attrs
    if (
      node.isTextblock &&
      !node.hasMarkup(type, attrsHere) &&
      canChangeType(tr.doc, tr.mapping.slice(mapFrom).map(pos), type)
    ) {
      const newlines = newlinesFor(type, linebreak)
      // Ensure all markup that isn't allowed in the new node type is cleared
      if (newlines === "toText") replaceLinebreaks(tr, node, pos, mapFrom)
      clearIncompatible(tr, tr.mapping.slice(mapFrom).map(pos, 1), type, undefined, newlines === "keep")
      const mapping = tr.mapping.slice(mapFrom)
      const startM = mapping.map(pos, 1),
        endM = mapping.map(pos + node.nodeSize, 1)
      tr.stepUnsafe(
        new ReplaceAroundStep(
          startM,
          endM,
          startM + 1,
          endM - 1,
          new Slice(Fragment.from(type.createUnsafe(attrsHere, undefined, node.marks)), 0, 0),
          1,
          true
        )
      )
      if (newlines === "toLinebreaks") replaceNewlines(tr, node, pos, mapFrom)
      return false
    }
    return undefined
  })
}

// How a block changed to `type` converts between newlines and the
// schema's linebreak replacement: into linebreak nodes, into newline
// text, or neither.
function newlinesFor(
  type: NodeType<any, any>,
  linebreak: Option.Option<NodeType<any, any>>
): "toLinebreaks" | "toText" | "keep" {
  if (Option.isNone(linebreak)) return "keep"
  const pre = type.whitespace === "pre",
    supportLinebreak = Option.isSome(type.contentMatch.matchType(linebreak.value))
  return pre && !supportLinebreak ? "toText" : !pre && supportLinebreak ? "toLinebreaks" : "keep"
}

function replaceNewlines(tr: Transform<any>, node: Node<any>, pos: number, mapFrom: number): void {
  // Only called when the schema has a linebreak replacement (`"toLinebreaks"`).
  const replacement = node.type.schema.linebreakReplacement
  if (Option.isNone(replacement)) return
  const linebreak: NodeType<any, any> = replacement.value
  node.forEach((child, offset) => {
    if (child.isTextNode()) {
      Array.from(child.text.matchAll(/\r?\n|\r/g)).forEach((m) => {
        const start = tr.mapping.slice(mapFrom).map(pos + 1 + offset + m.index)
        tr.replaceWithUnsafe(start, start + 1, linebreak.createUnsafe())
      })
    }
  })
}

function replaceLinebreaks(tr: Transform<any>, node: Node<any>, pos: number, mapFrom: number): void {
  const linebreak = node.type.schema.linebreakReplacement
  node.forEach((child, offset) => {
    if (Option.contains(linebreak, child.type)) {
      const start = tr.mapping.slice(mapFrom).map(pos + 1 + offset)
      tr.replaceWithUnsafe(start, start + 1, node.type.schema.textUnsafe("\n"))
    }
  })
}

function canChangeType(doc: Node<any>, pos: number, type: NodeType<any, any>): boolean {
  const $pos = doc.resolveUnsafe(pos),
    index = $pos.index()
  return $pos.parent.canReplaceWith(index, index + 1, type)
}

/** @internal */
export function setNodeMarkup(
  tr: Transform<any>,
  pos: number,
  newType?: NodeType<any, any>,
  attrs?: Attrs,
  marks?: ReadonlyArray<Mark<any>>
): void {
  const nodeFound = tr.doc.nodeAt(pos)
  if (Option.isNone(nodeFound)) throw new TransformError({ message: "No node at given position" })
  const node = nodeFound.value
  const type = newType ?? node.type
  const newNode = type.createUnsafe(attrs, undefined, marks || node.marks)
  if (node.isLeaf) {
    tr.replaceWithUnsafe(pos, pos + node.nodeSize, newNode)
    return
  }

  if (!type.validContent(node.content)) {
    throw new TransformError({ message: "Invalid content for node type " + type.name })
  }

  tr.stepUnsafe(
    new ReplaceAroundStep(
      pos,
      pos + node.nodeSize,
      pos + 1,
      pos + node.nodeSize - 1,
      new Slice(Fragment.from(newNode), 0, 0),
      1,
      true
    )
  )
}

/**
 * Check whether splitting at the given position is allowed. Throws a
 * `PositionError` when `pos` is outside of the document.
 *
 * @since 0.1.0
 * @category queries
 */
export function canSplit<Sc extends AnySchema>(
  doc: Node<Sc>,
  pos: number,
  depth = 1,
  typesAfter: ReadonlyArray<Option.Option<NodeTypeWithAttrs<Sc>>> = []
): boolean {
  // The type after the split at index `i` of `typesAfter`, if given.
  const typeAt = (i: number) => Option.flatten(Arr.get(typesAfter, i))
  const $pos = doc.resolveUnsafe(pos),
    base = $pos.depth - depth
  const innerType = Option.getOrElse(typeAt(typesAfter.length - 1), () => $pos.parent)
  if (
    base < 0 ||
    $pos.parent.type.spec.isolating ||
    !$pos.parent.canReplace($pos.index(), $pos.parent.childCount) ||
    !innerType.type.validContent($pos.parent.content.cutByIndex($pos.index(), $pos.parent.childCount))
  )
    return false
  const splittable = depthsAbove($pos.depth - 1, base).every((d) => {
    const node = $pos.node(d),
      index = $pos.index(d),
      i = d - base - 1
    if (node.type.spec.isolating) return false
    const cut: Fragment<any> = node.content.cutByIndex(index, node.childCount)
    const overrideChild: Option.Option<AnyWrapper> = typeAt(i + 1)
    const rest = Option.isSome(overrideChild)
      ? cut.replaceChild(0, overrideChild.value.type.createUnsafe(overrideChild.value.attrs))
      : cut
    const after = Option.getOrElse(typeAt(i), () => node)
    return node.canReplace(index + 1, node.childCount) && after.type.validContent(rest)
  })
  if (!splittable) return false
  const index = $pos.indexAfter(base)
  const baseType = Option.match(typeAt(0), { onNone: () => $pos.node(base + 1).type, onSome: ({ type }) => type })
  return $pos.node(base).canReplaceWith(index, index, baseType)
}

/** @internal */
export function split(
  tr: Transform<any>,
  pos: number,
  depth = 1,
  typesAfter: ReadonlyArray<Option.Option<AnyWrapper>> = []
): void {
  const $pos = tr.doc.resolveUnsafe(pos)
  let before: Fragment<any> = Fragment.empty,
    after: Fragment<any> = Fragment.empty
  const base = $pos.depth - depth
  depthsAbove($pos.depth, base).forEach((d) => {
    before = Fragment.from($pos.node(d).copy(before))
    const typeAfter = Option.flatten(Arr.get(typesAfter, d - base - 1))
    after = Fragment.from(
      Option.isSome(typeAfter)
        ? typeAfter.value.type.createUnsafe(typeAfter.value.attrs, after)
        : $pos.node(d).copy(after)
    )
  })
  tr.stepUnsafe(new ReplaceStep(pos, pos, new Slice(before.append(after), depth, depth), true))
}

/**
 * Test whether the blocks before and after a given position can be
 * joined. Throws a `PositionError` when `pos` is outside of the
 * document.
 *
 * @since 0.1.0
 * @category queries
 */
export function canJoin<Sc extends AnySchema>(doc: Node<Sc>, pos: number): boolean {
  const $pos = doc.resolveUnsafe(pos),
    index = $pos.index()
  return joinable($pos.nodeBefore, $pos.nodeAfter) && $pos.parent.canReplace(index, index + 1)
}

function canAppendWithSubstitutedLinebreaks(a: Node<any>, b: Node<any>): boolean {
  if (!b.content.size) a.type.compatibleContent(b.type)
  const linebreakReplacement = a.type.schema.linebreakReplacement
  const textType: NodeType<any, any> = a.type.schema.nodes.text
  const end = b.content.content.reduce<Option.Option<ContentMatch>>((match, child) => {
    const type = Option.contains(linebreakReplacement, child.type) ? textType : child.type
    if (Option.isNone(match) || !a.type.allowsMarks(child.marks)) return Option.none()
    return match.value.matchType(type)
  }, a.contentMatchAtUnsafe(a.childCount).some)
  return Option.exists(end, (match) => match.validEnd)
}

function joinable(a: Option.Option<Node<any>>, b: Option.Option<Node<any>>): boolean {
  return Option.isSome(a) && Option.isSome(b) && !a.value.isLeaf && canAppendWithSubstitutedLinebreaks(a.value, b.value)
}

/**
 * Find an ancestor of the given position that can be joined to the
 * block before (or after if `dir` is positive). Returns the joinable
 * point, if any.
 *
 * @since 0.1.0
 * @category queries
 */
export function joinPoint<Sc extends AnySchema>(doc: Node<Sc>, pos: number, dir = -1): Option.Option<number> {
  const $pos = doc.resolveUnsafe(pos)
  const search = (d: number, at: number): Option.Option<number> => {
    let before: Option.Option<Node<any>>, after: Option.Option<Node<any>>
    let index = $pos.index(d)
    if (d === $pos.depth) {
      before = $pos.nodeBefore
      after = $pos.nodeAfter
    } else if (dir > 0) {
      before = Option.some($pos.node(d + 1))
      index++
      after = Arr.get($pos.node(d).content.content, index)
    } else {
      before = Arr.get($pos.node(d).content.content, index - 1)
      after = Option.some($pos.node(d + 1))
    }
    if (
      Option.exists(before, (node) => !node.isTextblock) &&
      joinable(before, after) &&
      $pos.node(d).canReplace(index, index + 1)
    )
      return Option.some(at)
    if (d === 0) return Option.none()
    return search(d - 1, dir < 0 ? $pos.beforeUnsafe(d) : $pos.afterUnsafe(d))
  }
  return search($pos.depth, pos)
}

/** @internal */
export function join(tr: Transform<any>, pos: number, depth: number): void {
  const $before = tr.doc.resolveUnsafe(pos - depth),
    beforeType = $before.node().type
  const newlines = beforeType.inlineContent ? newlinesFor(beforeType, tr.doc.type.schema.linebreakReplacement) : "keep"
  const mapFrom = tr.steps.length
  if (newlines === "toText") {
    const $after = tr.doc.resolveUnsafe(pos + depth)
    replaceLinebreaks(tr, $after.node(), $after.beforeUnsafe(), mapFrom)
  }
  if (beforeType.inlineContent) {
    clearIncompatible(
      tr,
      pos + depth - 1,
      beforeType,
      $before.node().contentMatchAtUnsafe($before.index()),
      newlines === "keep"
    )
  }
  const mapping = tr.mapping.slice(mapFrom),
    start = mapping.map(pos - depth)
  tr.stepUnsafe(new ReplaceStep(start, mapping.map(pos + depth, -1), Slice.empty, true))
  if (newlines === "toLinebreaks") {
    const $full = tr.doc.resolveUnsafe(start)
    replaceNewlines(tr, $full.node(), $full.beforeUnsafe(), tr.steps.length)
  }
}

/**
 * Try to find a point where a node of the given type can be inserted
 * near `pos`, by searching up the node hierarchy when `pos` itself
 * isn't a valid place but is at the start or end of a node. Returns
 * `None` if no position was found.
 *
 * @since 0.1.0
 * @category queries
 */
export const insertPoint = <Sc extends AnySchema>(
  doc: Node<Sc>,
  pos: number,
  nodeType: NodeType<Sc, any>
): Option.Option<number> => {
  const $pos = doc.resolveUnsafe(pos)
  if ($pos.parent.canReplaceWith($pos.index(), $pos.index(), nodeType)) return Option.some(pos)

  // Look in the ancestors that `pos` is at the start (or end) of,
  // innermost first, stopping at one that it isn't at the edge of.
  let fits = false
  if ($pos.parentOffset === 0) {
    const found = Arr.findFirst(depthsAbove($pos.depth - 1, -1), (d) => {
      const index = $pos.index(d)
      fits = $pos.node(d).canReplaceWith(index, index, nodeType)
      return fits || index > 0
    })
    if (Option.isSome(found)) return fits ? Option.some($pos.beforeUnsafe(found.value + 1)) : Option.none()
  }
  if ($pos.parentOffset === $pos.parent.content.size) {
    const found = Arr.findFirst(depthsAbove($pos.depth - 1, -1), (d) => {
      const index = $pos.indexAfter(d)
      fits = $pos.node(d).canReplaceWith(index, index, nodeType)
      return fits || index < $pos.node(d).childCount
    })
    if (Option.isSome(found)) return fits ? Option.some($pos.afterUnsafe(found.value + 1)) : Option.none()
  }
  return Option.none()
}

/**
 * Finds a position at or around the given position where the given
 * slice can be inserted. Will look at parent nodes' nearest boundary
 * and try there, even if the original position wasn't directly at the
 * start or end of that node. Returns `None` when no position was found.
 *
 * @since 0.1.0
 * @category queries
 */
export function dropPoint<Sc extends AnySchema>(doc: Node<Sc>, pos: number, slice: Slice<Sc>): Option.Option<number> {
  const $pos = doc.resolveUnsafe(pos)
  if (!slice.content.size) return Option.some(pos)
  // The content inside the slice's open start.
  const content = Array.from({ length: slice.openStart }).reduce<Fragment<any>>(
    (inner) => inner.content[0].content,
    slice.content
  )
  // First look for a place the content fits as is, then (for a closed
  // slice) for one where it fits once wrapped.
  const passes = slice.openStart === 0 && slice.size ? [1, 2] : [1]
  return Arr.findFirst(passes, (pass) =>
    Arr.findFirst(depthsAbove($pos.depth, -1), (d) => {
      const bias = d === $pos.depth ? 0 : $pos.pos <= ($pos.start(d + 1) + $pos.end(d + 1)) / 2 ? -1 : 1
      const insertPos = $pos.index(d) + (bias > 0 ? 1 : 0)
      const parent = $pos.node(d)
      const fits =
        pass === 1 ? parent.canReplace(insertPos, insertPos, content) : fitsWrapped(parent, insertPos, content)
      return fits
        ? Option.some(bias === 0 ? $pos.pos : bias < 0 ? $pos.beforeUnsafe(d + 1) : $pos.afterUnsafe(d + 1))
        : Option.none()
    })
  )
}

// Whether `content` can be inserted at `index` in `parent` inside some wrapping.
function fitsWrapped(parent: Node<any>, index: number, content: Fragment<any>): boolean {
  return Option.exists(parent.contentMatchAtUnsafe(index).findWrapping(content.content[0].type), (wrapping) =>
    parent.canReplaceWith(index, index, wrapping[0])
  )
}
