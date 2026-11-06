/**
 * Complex editing workloads, written once against the `Lib` seam: each
 * builds its document from JSON, runs a deterministic sequence of edits
 * and returns the final document, so the same workload on two libraries
 * must return equal documents (workloads.test.ts) and can be
 * timed against each other (`run.ts`).
 *
 * @copyright Thomas Foster
 */
import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import type { NodeJSON } from "@thomasfosterau/effect-richtext/model"
import { type Append, between, deepListJSON, type Filter, type Lib, proseJSON, random, type Types } from "./lib.ts"

/**
 * One workload: runs against a library adapter and returns the final
 * document.
 *
 * @since 0.1.0
 * @category models
 */
export type Workload = <T extends Types>(A: Lib<T>) => T["node"]

const repeat = <S>(n: number, init: S, f: (s: S, i: number) => S): S =>
  Arr.reduce(
    Arr.makeBy(n, (i) => i),
    init,
    f
  )

// The start of every occurrence of `word` in the document's text.
const findAll = <T extends Types>(A: Lib<T>, doc: T["node"], word: string): Array<number> => {
  const out: Array<number> = []
  A.forEachText(doc, (text, pos) => {
    const parts = text.split(word)
    parts.slice(0, -1).reduce((at, part) => {
      out.push(at + part.length)
      return at + part.length + word.length
    }, pos)
  })
  return out
}

const sampleInline = <T extends Types>(A: Lib<T>, doc: T["node"], r: () => number): number => {
  const pos = between(r, 1, A.contentSize(doc))
  return A.inlineAt(doc, pos) ? pos : sampleInline(A, doc, r)
}

// `n` random positions inside textblocks.
const textPositions = <T extends Types>(A: Lib<T>, doc: T["node"], n: number, seed: number): Array<number> => {
  const r = random(seed)
  return Arr.makeBy(n, () => sampleInline(A, doc, r))
}

const firstTextPosition = <T extends Types>(A: Lib<T>, doc: T["node"], seed: number): number =>
  sampleInline(A, doc, random(seed))

const range = (from: number, to: number): readonly [number, number] => [from, to]

const tick = (k: number): readonly [string, number] => ["tick", k]

const typeText = <T extends Types>(A: Lib<T>, state: T["state"], text: string): T["state"] => {
  const tr = A.tr(state)
  A.insertText(tr, text)
  return A.apply(state, tr)
}

const medium = (): NodeJSON => proseJSON(400)
const big = (): NodeJSON => proseJSON(2000)

// prosemirror-collab's `rebaseSteps`: undo the local steps, apply the
// remote ones, then map each local step over them and reapply it.
const collab: Workload = (A) => {
  const base = A.fromJSON(medium())
  const edit = (seed: number) => {
    const tr = A.tr(A.create(base, []))
    const t = A.asTransform(tr)
    textPositions(A, base, 40, seed).forEach((p) => A.replaceText(tr, "x", A.mapPos(t, p), A.mapPos(t, p)))
    return t
  }
  const local = edit(11)
  const remote = edit(12)
  const localSteps = A.steps(local)
  const t = A.transform(A.transformDoc(local))
  const mapping = A.mapping()
  const apply = (step: ReturnType<typeof A.invert>) => {
    A.step(t, step)
    A.appendStepMap(mapping, step, Option.none())
  }
  Arr.reverse(Arr.zipWith(localSteps, A.docs(local), A.invert)).forEach(apply)
  A.steps(remote).forEach(apply)
  localSteps.reduce((mapFrom, step) => {
    const mirror = mapFrom - 1
    Option.map(A.mapStep(step, mapping, mapFrom), (mapped) => {
      if (A.maybeStep(t, mapped)) A.appendStepMap(mapping, mapped, Option.some(mirror))
    })
    return mirror
  }, localSteps.length)
  return A.transformDoc(t)
}

const history: Workload = (A) => {
  const doc = A.fromJSON(medium())
  const start = A.createAt(doc, [A.history()], firstTextPosition(A, doc, 3))
  const typed = repeat(1500, start, (state, i) => {
    const tr = A.tr(state)
    A.insertText(tr, i % 7 === 0 ? " " : "a")
    A.setTime(tr, Math.floor(i / 20) * 1000)
    return A.apply(state, tr)
  })
  const undone = repeat(40, typed, (state) => A.run(A.undo, state))
  return A.doc(repeat(40, undone, (state) => A.run(A.redo, state)))
}

const findReplace: Workload = (A) => {
  const doc = A.fromJSON(big())
  const tr = A.tr(A.create(doc, []))
  const t = A.asTransform(tr)
  findAll(A, doc, "dolor").forEach((p) => A.replaceText(tr, "DOLOR SIT", A.mapPos(t, p), A.mapPos(t, p + 5)))
  return A.transformDoc(t)
}

const liveSearch: Workload = <T extends Types>(A: Lib<T>) => {
  const doc = A.fromJSON(medium())
  const matches = (d: typeof doc) =>
    A.decorations(
      d,
      findAll(A, d, "lorem").map((p) => range(p, p + 5)),
      "m"
    )
  const search = A.statePlugin({
    init: matches,
    apply: (tr, set) => (A.docChanged(tr) ? matches(A.trDoc(tr)) : set),
    filter: Option.none<Filter<T>>(),
    append: Option.none<Append<T, T["decorations"]>>()
  })
  const start = A.createAt(doc, [search], firstTextPosition(A, doc, 4))
  return A.doc(repeat(100, start, (state, i) => typeText(A, state, i % 5 === 0 ? "lorem " : "l")))
}

const mappedDecorations: Workload = <T extends Types>(A: Lib<T>) => {
  const doc = A.fromJSON(big())
  const highlight = A.statePlugin({
    init: (d) =>
      A.decorations(
        d,
        findAll(A, d, "sit").map((p) => range(p, p + 3)),
        "h"
      ),
    apply: (tr, set) => A.mapDecorations(set, tr),
    filter: Option.none<Filter<T>>(),
    append: Option.none<Append<T, T["decorations"]>>()
  })
  const start = A.createAt(doc, [highlight], firstTextPosition(A, doc, 6))
  return A.doc(repeat(300, start, (state) => typeText(A, state, "s")))
}

// Every fifth plugin appends a transaction whenever its step count hits a
// multiple of 50.
const pluginHeavy: Workload = <T extends Types>(A: Lib<T>) => {
  const doc = A.fromJSON(medium())
  const appendTick = (k: number) => (trs: ReadonlyArray<T["transaction"]>, n: number) =>
    trs.some((tr) => A.docChanged(tr)) && n % 50 === 0 ? Option.some(tick(k)) : Option.none()
  const plugins = Arr.makeBy(25, (k) =>
    A.statePlugin({
      init: () => 0,
      apply: (tr, n) => (A.docChanged(tr) ? n + A.stepCount(tr) : n),
      filter: Option.some(() => true),
      append: k % 5 === 0 ? Option.some(appendTick(k)) : Option.none<Append<T, number>>()
    })
  )
  const start = A.createAt(doc, plugins, firstTextPosition(A, doc, 7))
  return A.doc(repeat(300, start, (state) => typeText(A, state, "p")))
}

const deepLists: Workload = (A) => {
  const doc = A.fromJSON(deepListJSON(7, 3))
  const targets = textPositions(A, doc, 200, 8)
  const end = targets.reduce(
    (state, target, i) => {
      const pos = Math.min(target, A.contentSize(A.doc(state)) - 2)
      return A.run(i % 2 === 0 ? A.sinkListItem : A.liftListItem, A.select(state, pos, pos))
    },
    A.create(doc, [])
  )
  return A.doc(end)
}

const markChurn: Workload = (A) => {
  const doc = A.fromJSON(big())
  const t = A.transform(doc)
  const em = A.mark("em")
  findAll(A, doc, "amet")
    .slice(0, 1500)
    .forEach((p, i) => (i % 2 === 0 ? A.addMark(t, p, p + 4, em) : A.removeMark(t, p, p + 4, em)))
  A.clearMarks(t, 0, A.contentSize(A.transformDoc(t)))
  return A.transformDoc(t)
}

const snapshot: Workload = (A) => {
  const doc = A.fromJSON(big())
  const start = A.create(doc, [A.history()])
  const tr = A.tr(start)
  A.replaceText(tr, "x", 5, 5)
  return A.doc(A.roundTrip(A.apply(start, tr), [A.history()]))
}

const commandStream: Workload = (A) => {
  const r = random(13)
  const end = repeat(600, A.create(A.fromJSON(medium()), []), (state) => {
    const doc = A.doc(state)
    const size = A.contentSize(doc)
    const from = between(r, 1, size)
    const to = r() < 0.7 ? from : between(r, 1, size)
    if (!A.inlineAt(doc, from) || !A.inlineAt(doc, to)) return state
    const selected = A.select(state, from, to)
    return Option.match(Arr.get(A.commands, between(r, 0, A.commands.length)), {
      onNone: () => selected,
      onSome: (command) => A.run(command, selected)
    })
  })
  return A.doc(end)
}

const blockMoves: Workload = (A) => {
  const r = random(21)
  return repeat(300, A.fromJSON(big()), (doc) => {
    const index = between(r, 0, A.childCount(doc) - 2)
    const pos = repeat(index, 0, (at, j) => at + A.nodeSize(A.child(doc, j)))
    const node = A.child(doc, index)
    const next = A.child(doc, index + 1)
    const t = A.transform(doc)
    A.delete(t, pos, pos + A.nodeSize(node))
    A.insert(t, pos + A.nodeSize(next), node)
    return A.transformDoc(t)
  })
}

/**
 * The workloads, by name.
 *
 * @since 0.1.0
 * @category workloads
 */
export const workloads: ReadonlyArray<readonly [name: string, run: Workload]> = [
  ["collab: rebase 40 local steps over 40 remote steps (400 blocks)", collab],
  ["history: 1500 keystrokes in 75 groups, undo 40, redo 40 (400 blocks)", history],
  ["find & replace: every 'dolor' in one transaction (2000 blocks)", findReplace],
  ["live search: rebuild ~2k match decorations per keystroke, 100 keys (400 blocks)", liveSearch],
  ["mapped decorations: ~5k inline decorations through 300 keystrokes (2000 blocks)", mappedDecorations],
  ["plugin-heavy state: 25 plugins with appendTransaction, 300 keystrokes (400 blocks)", pluginHeavy],
  ["deep lists: 200 sink/lift list item commands at depth 7", deepLists],
  ["mark churn: toggle em on 1500 words in one transform, then strip all marks (2000 blocks)", markChurn],
  ["state snapshot: toJSON and fromJSON with history (2000 blocks)", snapshot],
  ["command stream: 600 commands on random selections (400 blocks)", commandStream],
  ["block moves: 300 cut-and-paste block moves (2000 blocks)", blockMoves]
]
