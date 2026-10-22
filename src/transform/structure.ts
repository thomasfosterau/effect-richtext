/**
 * Structural queries (`liftTarget`, `findWrapping`, `canSplit`, …) and
 * the structure-changing transform implementations.
 *
 * @since 0.1.0
 */
import * as Option from "effect/Option"
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
  Slice,
  type TextNode
} from "../model.ts"
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
        readonly attrs?: NodeAttrsInput<Sc, N> | null | undefined
      }
    }[NodeNames<Sc>]
  | { readonly type: NodeType<Sc>; readonly attrs?: null | undefined }

type AnyWrapper = { readonly type: NodeType<any, any>; readonly attrs?: Attrs | null | undefined }

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
export const liftTarget = <Sc extends AnySchema>(range: NodeRange<Sc>): Option.Option<number> =>
  Option.fromNullishOr(liftTargetOrNull(range))

/** @internal */
export function liftTargetOrNull(range: NodeRange<any>): number | null {
  const parent = range.parent
  const content = parent.content.cutByIndex(range.startIndex, range.endIndex)
  for (let depth = range.depth, contentBefore = 0, contentAfter = 0; ; --depth) {
    const node = range.$from.node(depth)
    const index = range.$from.index(depth) + contentBefore,
      endIndex = range.$to.indexAfter(depth) - contentAfter
    if (depth < range.depth && node.canReplace(index, endIndex, content)) return depth
    if (depth === 0 || node.type.spec.isolating || !canCut(node, index, endIndex)) break
    if (index) contentBefore = 1
    if (endIndex < node.childCount) contentAfter = 1
  }
  return null
}

/** @internal */
export function lift(tr: Transform<any>, range: NodeRange<any>, target: number): void {
  const { $from, $to, depth } = range

  const gapStart = $from.beforeUnsafe(depth + 1),
    gapEnd = $to.afterUnsafe(depth + 1)
  let start = gapStart,
    end = gapEnd

  let before: Fragment<any> = Fragment.empty,
    openStart = 0
  for (let d = depth, splitting = false; d > target; d--) {
    if (splitting || $from.index(d) > 0) {
      splitting = true
      before = Fragment.from($from.node(d).copy(before))
      openStart++
    } else {
      start--
    }
  }
  let after: Fragment<any> = Fragment.empty,
    openEnd = 0
  for (let d = depth, splitting = false; d > target; d--) {
    if (splitting || $to.afterUnsafe(d + 1) < $to.end(d)) {
      splitting = true
      after = Fragment.from($to.node(d).copy(after))
      openEnd++
    } else {
      end++
    }
  }

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
  attrs: NodeAttrsInput<Sc, N> | null = null,
  innerRange: NodeRange<Sc> = range
): Option.Option<ReadonlyArray<NodeTypeWithAttrs<Sc>>> =>
  Option.fromNullishOr(findWrappingOrNull(range, nodeType, attrs, innerRange))

/** @internal */
export function findWrappingOrNull<Sc extends AnySchema>(
  range: NodeRange<Sc>,
  nodeType: NodeType<Sc, any>,
  attrs: Attrs | null = null,
  innerRange: NodeRange<Sc> = range
): ReadonlyArray<NodeTypeWithAttrs<Sc>> | null {
  const around = findWrappingOutside(range, nodeType)
  const inner = around && findWrappingInside(innerRange, nodeType)
  if (!inner) return null
  return (around!.map(withAttrs) as Array<AnyWrapper>)
    .concat({ type: nodeType, attrs })
    .concat(inner.map(withAttrs)) as any
}

const withAttrs = (type: NodeType<any, any>): AnyWrapper => ({ type, attrs: null })

function findWrappingOutside(range: NodeRange<any>, type: NodeType<any, any>) {
  const { parent, startIndex, endIndex } = range
  const around = parent.contentMatchAtUnsafe(startIndex).findWrappingOrNull(type)
  if (!around) return null
  const outer = around.length ? around[0]! : type
  return parent.canReplaceWith(startIndex, endIndex, outer) ? around : null
}

function findWrappingInside(range: NodeRange<any>, type: NodeType<any, any>) {
  const { endIndex, parent, startIndex } = range
  const inner = parent.content.content[startIndex]!
  const inside = type.contentMatch.findWrappingOrNull(inner.type)
  if (!inside) return null
  const lastType = inside.length ? inside[inside.length - 1]! : type
  let innerMatch: ContentMatch | null = lastType.contentMatch
  for (let i = startIndex; innerMatch && i < endIndex; i++) {
    innerMatch = innerMatch.matchTypeOrNull(parent.content.content[i]!.type)
  }
  if (!innerMatch || !innerMatch.validEnd) return null
  return inside
}

/** @internal */
export function wrap(tr: Transform<any>, range: NodeRange<any>, wrappers: ReadonlyArray<AnyWrapper>): void {
  let content: Fragment<any> = Fragment.empty
  for (let i = wrappers.length - 1; i >= 0; i--) {
    if (content.size) {
      const match = wrappers[i]!.type.contentMatch.matchFragmentOrNull(content)
      if (!match || !match.validEnd) {
        throw new TransformError({
          message: "Wrapper type given to Transform.wrap does not form valid content of its parent wrapper"
        })
      }
    }
    content = Fragment.from(wrappers[i]!.type.createUnsafe(wrappers[i]!.attrs, content))
  }

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
  attrs: Attrs | null | undefined | ((oldNode: Node<any>) => Attrs)
): void {
  if (!type.isTextblock) throw new TransformError({ message: "Type given to setBlockType should be a textblock" })
  const mapFrom = tr.steps.length
  const linebreak = Option.getOrNull(type.schema.linebreakReplacement) as NodeType<any, any> | null
  tr.doc.nodesBetween(from, to, (node, pos) => {
    const attrsHere = typeof attrs === "function" ? attrs(node) : attrs
    if (
      node.isTextblock &&
      !node.hasMarkup(type, attrsHere) &&
      canChangeType(tr.doc, tr.mapping.slice(mapFrom).map(pos), type)
    ) {
      let convertNewlines: boolean | null = null
      if (linebreak) {
        const pre = type.whitespace === "pre",
          supportLinebreak = !!type.contentMatch.matchTypeOrNull(linebreak)
        if (pre && !supportLinebreak) convertNewlines = false
        else if (!pre && supportLinebreak) convertNewlines = true
      }
      // Ensure all markup that isn't allowed in the new node type is cleared
      if (convertNewlines === false) replaceLinebreaks(tr, node, pos, mapFrom)
      clearIncompatible(tr, tr.mapping.slice(mapFrom).map(pos, 1), type, undefined, convertNewlines === null)
      const mapping = tr.mapping.slice(mapFrom)
      const startM = mapping.map(pos, 1),
        endM = mapping.map(pos + node.nodeSize, 1)
      tr.stepUnsafe(
        new ReplaceAroundStep(
          startM,
          endM,
          startM + 1,
          endM - 1,
          new Slice(Fragment.from(type.createUnsafe(attrsHere, null, node.marks)), 0, 0),
          1,
          true
        )
      )
      if (convertNewlines === true) replaceNewlines(tr, node, pos, mapFrom)
      return false
    }
    return undefined
  })
}

function replaceNewlines(tr: Transform<any>, node: Node<any>, pos: number, mapFrom: number): void {
  const linebreak = Option.getOrThrow(node.type.schema.linebreakReplacement) as NodeType<any, any>
  node.forEach((child, offset) => {
    if (child.isText) {
      let m: RegExpExecArray | null
      const newline = /\r?\n|\r/g
      while ((m = newline.exec((child as TextNode<any>).text))) {
        const start = tr.mapping.slice(mapFrom).map(pos + 1 + offset + m.index)
        tr.replaceWithUnsafe(start, start + 1, linebreak.createUnsafe())
      }
    }
  })
}

function replaceLinebreaks(tr: Transform<any>, node: Node<any>, pos: number, mapFrom: number): void {
  const linebreak = Option.getOrNull(node.type.schema.linebreakReplacement)
  node.forEach((child, offset) => {
    if (child.type === linebreak) {
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
  type: NodeType<any, any> | undefined | null,
  attrs: Attrs | null | undefined,
  marks: ReadonlyArray<Mark<any>> | undefined
): void {
  const node = tr.doc.nodeAtOrNull(pos)
  if (!node) throw new TransformError({ message: "No node at given position" })
  if (!type) type = node.type
  const newNode = type.createUnsafe(attrs, null, marks || node.marks)
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
  typesAfter?: ReadonlyArray<NodeTypeWithAttrs<Sc> | null | undefined>
): boolean {
  const types = typesAfter as ReadonlyArray<AnyWrapper | null | undefined> | undefined
  const $pos = doc.resolveUnsafe(pos),
    base = $pos.depth - depth
  const innerType = (types && types[types.length - 1]) || $pos.parent
  if (
    base < 0 ||
    $pos.parent.type.spec.isolating ||
    !$pos.parent.canReplace($pos.index(), $pos.parent.childCount) ||
    !innerType.type.validContent($pos.parent.content.cutByIndex($pos.index(), $pos.parent.childCount))
  )
    return false
  for (let d = $pos.depth - 1, i = depth - 2; d > base; d--, i--) {
    const node = $pos.node(d),
      index = $pos.index(d)
    if (node.type.spec.isolating) return false
    let rest: Fragment<any> = node.content.cutByIndex(index, node.childCount)
    const overrideChild = types && types[i + 1]
    if (overrideChild) rest = rest.replaceChild(0, overrideChild.type.createUnsafe(overrideChild.attrs))
    const after = (types && types[i]) || node
    if (!node.canReplace(index + 1, node.childCount) || !after.type.validContent(rest)) return false
  }
  const index = $pos.indexAfter(base)
  const baseType = types && types[0]
  return $pos.node(base).canReplaceWith(index, index, baseType ? baseType.type : $pos.node(base + 1).type)
}

/** @internal */
export function split(
  tr: Transform<any>,
  pos: number,
  depth = 1,
  typesAfter?: ReadonlyArray<AnyWrapper | null | undefined>
): void {
  const $pos = tr.doc.resolveUnsafe(pos)
  let before: Fragment<any> = Fragment.empty,
    after: Fragment<any> = Fragment.empty
  for (let d = $pos.depth, e = $pos.depth - depth, i = depth - 1; d > e; d--, i--) {
    before = Fragment.from($pos.node(d).copy(before))
    const typeAfter = typesAfter && typesAfter[i]
    after = Fragment.from(typeAfter ? typeAfter.type.createUnsafe(typeAfter.attrs, after) : $pos.node(d).copy(after))
  }
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
  return joinable($pos.nodeBeforeOrNull, $pos.nodeAfterOrNull) && $pos.parent.canReplace(index, index + 1)
}

function canAppendWithSubstitutedLinebreaks(a: Node<any>, b: Node<any>): boolean {
  if (!b.content.size) a.type.compatibleContent(b.type)
  let match: ContentMatch | null = a.contentMatchAtUnsafe(a.childCount)
  const linebreakReplacement = Option.getOrNull(a.type.schema.linebreakReplacement)
  for (let i = 0; i < b.childCount; i++) {
    const child = b.content.content[i]!
    const type = child.type === linebreakReplacement ? a.type.schema.nodes.text! : child.type
    match = match.matchTypeOrNull(type)
    if (!match) return false
    if (!a.type.allowsMarks(child.marks)) return false
  }
  return match.validEnd
}

function joinable(a: Node<any> | null | undefined, b: Node<any> | null | undefined): boolean {
  return !!(a && b && !a.isLeaf && canAppendWithSubstitutedLinebreaks(a, b))
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
  for (let d = $pos.depth; ; d--) {
    let before: Node<any> | null | undefined, after: Node<any> | null | undefined
    let index = $pos.index(d)
    if (d === $pos.depth) {
      before = $pos.nodeBeforeOrNull
      after = $pos.nodeAfterOrNull
    } else if (dir > 0) {
      before = $pos.node(d + 1)
      index++
      after = $pos.node(d).content.content[index]
    } else {
      before = $pos.node(d).content.content[index - 1]
      after = $pos.node(d + 1)
    }
    if (before && !before.isTextblock && joinable(before, after) && $pos.node(d).canReplace(index, index + 1))
      return Option.some(pos)
    if (d === 0) break
    pos = dir < 0 ? $pos.beforeUnsafe(d) : $pos.afterUnsafe(d)
  }
  return Option.none()
}

/** @internal */
export function join(tr: Transform<any>, pos: number, depth: number): void {
  let convertNewlines: boolean | null = null
  const linebreakReplacement = Option.getOrNull(tr.doc.type.schema.linebreakReplacement) as NodeType<any, any> | null
  const $before = tr.doc.resolveUnsafe(pos - depth),
    beforeType = $before.node().type
  if (linebreakReplacement && beforeType.inlineContent) {
    const pre = beforeType.whitespace === "pre"
    const supportLinebreak = !!beforeType.contentMatch.matchTypeOrNull(linebreakReplacement)
    if (pre && !supportLinebreak) convertNewlines = false
    else if (!pre && supportLinebreak) convertNewlines = true
  }
  const mapFrom = tr.steps.length
  if (convertNewlines === false) {
    const $after = tr.doc.resolveUnsafe(pos + depth)
    replaceLinebreaks(tr, $after.node(), $after.beforeUnsafe(), mapFrom)
  }
  if (beforeType.inlineContent) {
    clearIncompatible(
      tr,
      pos + depth - 1,
      beforeType,
      $before.node().contentMatchAtUnsafe($before.index()),
      convertNewlines == null
    )
  }
  const mapping = tr.mapping.slice(mapFrom),
    start = mapping.map(pos - depth)
  tr.stepUnsafe(new ReplaceStep(start, mapping.map(pos + depth, -1), Slice.empty, true))
  if (convertNewlines === true) {
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
): Option.Option<number> => Option.fromNullishOr(insertPointOrNull(doc, pos, nodeType))

/** @internal */
export function insertPointOrNull(doc: Node<any>, pos: number, nodeType: NodeType<any, any>): number | null {
  const $pos = doc.resolveUnsafe(pos)
  if ($pos.parent.canReplaceWith($pos.index(), $pos.index(), nodeType)) return pos

  if ($pos.parentOffset === 0) {
    for (let d = $pos.depth - 1; d >= 0; d--) {
      const index = $pos.index(d)
      if ($pos.node(d).canReplaceWith(index, index, nodeType)) return $pos.beforeUnsafe(d + 1)
      if (index > 0) return null
    }
  }
  if ($pos.parentOffset === $pos.parent.content.size) {
    for (let d = $pos.depth - 1; d >= 0; d--) {
      const index = $pos.indexAfter(d)
      if ($pos.node(d).canReplaceWith(index, index, nodeType)) return $pos.afterUnsafe(d + 1)
      if (index < $pos.node(d).childCount) return null
    }
  }
  return null
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
  let content: Fragment<any> = slice.content
  for (let i = 0; i < slice.openStart; i++) content = content.content[0]!.content
  for (let pass = 1; pass <= (slice.openStart === 0 && slice.size ? 2 : 1); pass++) {
    for (let d = $pos.depth; d >= 0; d--) {
      const bias = d === $pos.depth ? 0 : $pos.pos <= ($pos.start(d + 1) + $pos.end(d + 1)) / 2 ? -1 : 1
      const insertPos = $pos.index(d) + (bias > 0 ? 1 : 0)
      const parent = $pos.node(d)
      let fits: boolean | null = false
      if (pass === 1) {
        fits = parent.canReplace(insertPos, insertPos, content)
      } else {
        const wrapping = parent.contentMatchAtUnsafe(insertPos).findWrappingOrNull(content.content[0]!.type)
        fits = wrapping && parent.canReplaceWith(insertPos, insertPos, wrapping[0]!)
      }
      if (fits) {
        return Option.some(bias === 0 ? $pos.pos : bias < 0 ? $pos.beforeUnsafe(d + 1) : $pos.afterUnsafe(d + 1))
      }
    }
  }
  return Option.none()
}
