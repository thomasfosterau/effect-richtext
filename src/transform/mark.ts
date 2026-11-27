/**
 * Mark-related transform implementations.
 *
 * @internal
 */
import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import { type ContentMatch, Fragment, type Mark, MarkType, type NodeType, Slice } from "../Model.ts"
import { TransformError } from "./errors.ts"
import { pushMarkStep } from "./mark_set_step.ts"
import { AddMarkStep, RemoveMarkStep } from "./mark_step.ts"
import { ReplaceStep } from "./replace_step.ts"
import type { Step } from "./step.ts"
import type { Transform } from "./transform.ts"

/** @internal */
export function addMark(tr: Transform<any>, from: number, to: number, mark: Mark<any>): void {
  // Excluded marks are dropped by the step itself; its inverse restores them (transform 1.12.3).
  const added: Array<AddMarkStep<any> | RemoveMarkStep<any>> = []
  tr.doc.nodesBetween(from, to, (node, pos, parent) => {
    if (!node.isInline) return
    const marks = node.marks
    if (!mark.isInSet(marks) && Option.isSome(parent) && parent.value.type.allowsMarkType(mark.type)) {
      const start = Math.max(pos, from),
        end = Math.min(pos + node.nodeSize, to)
      pushMarkStep(AddMarkStep, start, end, mark, added)
    }
  })
  added.forEach((s) => tr.stepUnsafe(s))
}

/** @internal */
export function removeMark(tr: Transform<any>, from: number, to: number, mark?: Mark<any> | MarkType<any>): void {
  const matched: Array<{ style: Mark<any>; from: number; to: number; step: number }> = []
  let step = 0
  tr.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isInline || !node.isAtom) return
    step++
    const toRemove: ReadonlyArray<Mark<any>> =
      mark instanceof MarkType
        ? node.marks.filter((m) => m.type === mark)
        : mark
          ? mark.isInSet(node.marks)
            ? [mark]
            : []
          : node.marks
    if (toRemove.length) {
      const end = Math.min(pos + node.nodeSize, to)
      toRemove.forEach((style) => {
        // Extend the range of the same mark on the previous inline node.
        const found = matched.find((m) => m.step === step - 1 && style.eq(m.style))
        if (found) {
          found.to = end
          found.step = step
        } else {
          matched.push({ style, from: Math.max(pos, from), to: end, step })
        }
      })
    }
  })
  matched.forEach((m) => tr.stepUnsafe(new RemoveMarkStep(m.from, m.to, m.style)))
}

/** @internal */
export function clearIncompatible(
  tr: Transform<any>,
  pos: number,
  parentType: NodeType<any, any>,
  match: ContentMatch = parentType.contentMatch,
  clearNewlines = true
): void {
  const nodeFound = tr.doc.nodeAt(pos)
  if (Option.isNone(nodeFound)) throw new TransformError({ message: "No node at position " + pos })
  const node = nodeFound.value
  const replSteps: Array<Step<any>> = []
  let cur = pos + 1
  node.content.content.forEach((child) => {
    const end = cur + child.nodeSize
    const allowed = match.matchType(child.type)
    if (Option.isNone(allowed)) {
      replSteps.push(new ReplaceStep(cur, end, Slice.empty))
    } else {
      match = allowed.value
      child.marks.forEach((mark) => {
        if (!parentType.allowsMarkType(mark.type)) tr.stepUnsafe(new RemoveMarkStep(cur, end, mark))
      })

      if (clearNewlines && child.isTextNode() && parentType.whitespace !== "pre" && /[\r\n]/.test(child.text)) {
        const newlines = Array.from(child.text.matchAll(/\r?\n|\r/g))
        if (Arr.isArrayNonEmpty(newlines)) {
          const slice = new Slice(
            Fragment.from(parentType.schema.textUnsafe(" ", parentType.allowedMarks(child.marks))),
            0,
            0
          )
          newlines.forEach((m) => {
            replSteps.push(new ReplaceStep(cur + m.index, cur + m.index + m[0].length, slice))
          })
        }
      }
    }
    cur = end
  })
  if (!match.validEnd) {
    const fill = match.fillBefore(Fragment.empty, true)
    if (Option.isNone(fill)) throw new TransformError({ message: "Can't complete the content of " + node.type.name })
    tr.replaceUnsafe(cur, cur, new Slice(fill.value, 0, 0))
  }
  Arr.reverse(replSteps).forEach((step) => tr.stepUnsafe(step))
}
