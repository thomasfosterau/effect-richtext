/**
 * The adapter members that read the same on both libraries (the core keeps
 * ProseMirror's names where an operation cannot fail), typed by the
 * structure they use, so `core.ts` and `prosemirror.ts` spread one copy.
 *
 * @copyright Thomas Foster
 */
import * as Option from "effect/Option"
import type { NodeJSON } from "effect-richtext/model"

interface Sized {
  readonly content: { readonly size: number }
  readonly childCount: number
  readonly nodeSize: number
  toJSON(): NodeJSON
}

interface Transformlike<N, St, Mp> {
  readonly doc: N
  readonly docs: ReadonlyArray<N>
  readonly steps: ReadonlyArray<St>
  readonly mapping: Mp & { map(pos: number): number }
}

/**
 * The shared adapter members.
 *
 * @since 0.1.0
 * @category adapters
 */
export const shared = {
  toJSON: (node: Sized): NodeJSON => node.toJSON(),
  contentSize: (node: Sized): number => node.content.size,
  childCount: (node: Sized): number => node.childCount,
  nodeSize: (node: Sized): number => node.nodeSize,

  doc: <N>(state: { readonly doc: N }): N => state.doc,
  tr: <Tr>(state: { readonly tr: Tr }): Tr => state.tr,

  setTime: (tr: { setTime(time: number): void }, time: number): void => {
    tr.setTime(time)
  },
  setMeta: (tr: { setMeta(key: string, value: number): void }, key: string, value: number): void => {
    tr.setMeta(key, value)
  },
  docChanged: (tr: { readonly docChanged: boolean }): boolean => tr.docChanged,
  stepCount: (tr: { readonly steps: { readonly length: number } }): number => tr.steps.length,
  trDoc: <N>(tr: { readonly doc: N }): N => tr.doc,
  asTransform: <Tr>(tr: Tr): Tr => tr,
  transformDoc: <N>(tr: { readonly doc: N }): N => tr.doc,
  mapPos: <N, St, Mp>(tr: Transformlike<N, St, Mp>, pos: number): number => tr.mapping.map(pos),
  steps: <N, St, Mp>(tr: Transformlike<N, St, Mp>): ReadonlyArray<St> => tr.steps,
  docs: <N, St, Mp>(tr: Transformlike<N, St, Mp>): ReadonlyArray<N> => tr.docs,
  invert: <N, St>(step: { invert(doc: N): St }, doc: N): St => step.invert(doc),
  appendStepMap: <M>(
    mapping: { appendMap(map: M, mirrors?: number): void },
    step: { getMap(): M },
    mirror: Option.Option<number>
  ): void => mapping.appendMap(step.getMap(), Option.getOrUndefined(mirror)),
  addMark: <M>(tr: { addMark(from: number, to: number, mark: M): void }, from: number, to: number, mark: M): void => {
    tr.addMark(from, to, mark)
  },
  removeMark: <M>(
    tr: { removeMark(from: number, to: number, mark: M): void },
    from: number,
    to: number,
    mark: M
  ): void => {
    tr.removeMark(from, to, mark)
  },
  clearMarks: (tr: { removeMark(from: number, to: number): void }, from: number, to: number): void => {
    tr.removeMark(from, to)
  },
  mapDecorations: <S, Mp, N>(set: { map(mapping: Mp, doc: N): S }, tr: { readonly mapping: Mp; readonly doc: N }): S =>
    set.map(tr.mapping, tr.doc)
}
