/**
 * Mark-related transform implementations.
 *
 * @internal
 */
import * as Option from "effect/Option"
import { type ContentMatch, Fragment, type Mark, MarkType, type NodeType, Slice, type TextNode } from "../model.ts"
import { AddMarkStep, RemoveMarkStep } from "./mark_step.ts"
import { ReplaceStep } from "./replace_step.ts"
import type { Step } from "./step.ts"
import type { Transform } from "./transform.ts"

/** @internal */
export function addMark(tr: Transform<any>, from: number, to: number, mark: Mark<any>): void {
  const removed: Array<Step<any>> = [], added: Array<Step<any>> = []
  let removing: RemoveMarkStep<any> | undefined, adding: AddMarkStep<any> | undefined
  tr.doc.nodesBetween(from, to, (node, pos, parent) => {
    if (!node.isInline) return
    const marks = node.marks
    if (!mark.isInSet(marks) && Option.isSome(parent) && parent.value.type.allowsMarkType(mark.type)) {
      const start = Math.max(pos, from), end = Math.min(pos + node.nodeSize, to)
      const newSet = mark.addToSet(marks)

      for (let i = 0; i < marks.length; i++) {
        if (!marks[i]!.isInSet(newSet)) {
          if (removing && removing.to === start && removing.mark.eq(marks[i]!)) {
            ;(removing as { to: number }).to = end
          } else {
            removed.push(removing = new RemoveMarkStep(start, end, marks[i]!))
          }
        }
      }

      if (adding && adding.to === start) {
        ;(adding as { to: number }).to = end
      } else {
        added.push(adding = new AddMarkStep(start, end, mark))
      }
    }
  })

  removed.forEach((s) => tr.stepUnsafe(s))
  added.forEach((s) => tr.stepUnsafe(s))
}

/** @internal */
export function removeMark(
  tr: Transform<any>,
  from: number,
  to: number,
  mark?: Mark<any> | MarkType<any> | null
): void {
  const matched: Array<{ style: Mark<any>; from: number; to: number; step: number }> = []
  let step = 0
  tr.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isInline) return
    step++
    let toRemove: ReadonlyArray<Mark<any>> | null = null
    if (mark instanceof MarkType) {
      let set = node.marks, found: Mark<any> | undefined
      const list: Array<Mark<any>> = []
      while ((found = mark.findInSet(set))) {
        list.push(found)
        set = found.removeFromSet(set)
      }
      if (list.length) toRemove = list
    } else if (mark) {
      if (mark.isInSet(node.marks)) toRemove = [mark]
    } else {
      toRemove = node.marks
    }
    if (toRemove && toRemove.length) {
      const end = Math.min(pos + node.nodeSize, to)
      for (let i = 0; i < toRemove.length; i++) {
        const style = toRemove[i]!
        let found: (typeof matched)[number] | undefined
        for (let j = 0; j < matched.length; j++) {
          const m = matched[j]!
          if (m.step === step - 1 && style.eq(m.style)) found = m
        }
        if (found) {
          found.to = end
          found.step = step
        } else {
          matched.push({ style, from: Math.max(pos, from), to: end, step })
        }
      }
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
  const node = tr.doc.nodeAtOrNull(pos)!
  const replSteps: Array<Step<any>> = []
  let cur = pos + 1
  for (let i = 0; i < node.childCount; i++) {
    const child = node.content.content[i]!, end = cur + child.nodeSize
    const allowed = match.matchTypeOrNull(child.type)
    if (!allowed) {
      replSteps.push(new ReplaceStep(cur, end, Slice.empty))
    } else {
      match = allowed
      for (let j = 0; j < child.marks.length; j++) {
        if (!parentType.allowsMarkType(child.marks[j]!.type)) {
          tr.stepUnsafe(new RemoveMarkStep(cur, end, child.marks[j]!))
        }
      }

      if (clearNewlines && child.isText && parentType.whitespace !== "pre") {
        let m: RegExpExecArray | null, slice: Slice<any> | undefined
        const newline = /\r?\n|\r/g
        while ((m = newline.exec((child as TextNode<any>).text))) {
          if (!slice) {
            slice = new Slice(
              Fragment.from(parentType.schema.textUnsafe(" ", parentType.allowedMarks(child.marks))),
              0,
              0
            )
          }
          replSteps.push(new ReplaceStep(cur + m.index, cur + m.index + m[0].length, slice))
        }
      }
    }
    cur = end
  }
  if (!match.validEnd) {
    const fill = match.fillBeforeOrNull(Fragment.empty, true)
    tr.replaceUnsafe(cur, cur, new Slice(fill!, 0, 0))
  }
  for (let i = replSteps.length - 1; i >= 0; i--) tr.stepUnsafe(replSteps[i]!)
}
