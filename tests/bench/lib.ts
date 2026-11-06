/**
 * The seam the workloads are written against: one adapter per library
 * (`core.ts` for @thomasfosterau/effect-richtext, `prosemirror.ts` for ProseMirror), each
 * typed against its own library, so a workload runs the same algorithm on
 * both and the results can be compared node for node.
 *
 * @copyright Thomas Foster
 */
import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import type { NodeJSON } from "@thomasfosterau/effect-richtext/model"

/**
 * The library's own types behind an adapter.
 *
 * @since 0.1.0
 * @category models
 */
export interface Types {
  readonly node: unknown
  readonly mark: unknown
  readonly state: unknown
  readonly transaction: unknown
  readonly transform: unknown
  readonly step: unknown
  readonly mapping: unknown
  readonly plugin: unknown
  readonly command: unknown
  readonly decorations: unknown
}

/**
 * A plugin's `filterTransaction` hook: returning false cancels the
 * transaction.
 *
 * @since 0.1.0
 * @category models
 */
export type Filter<T extends Types> = (tr: T["transaction"]) => boolean

/**
 * A plugin's `appendTransaction` hook: given the transactions just applied
 * and the plugin's value after them, the metadata of an empty transaction
 * to append, if any.
 *
 * @since 0.1.0
 * @category models
 */
export type Append<T extends Types, V> = (
  trs: ReadonlyArray<T["transaction"]>,
  value: V
) => Option.Option<readonly [key: string, value: number]>

/**
 * A plugin's state field, written once for both libraries. The hooks see
 * documents and transactions, not states: the core types a hook's state
 * as one with unknown plugins, which its synchronous `applyUnsafe` does
 * not accept.
 *
 * @since 0.1.0
 * @category models
 */
export interface StatePluginSpec<T extends Types, V> {
  readonly init: (doc: T["node"]) => V
  readonly apply: (tr: T["transaction"], value: V) => V
  readonly filter: Option.Option<Filter<T>>
  readonly append: Option.Option<Append<T, NoInfer<V>>>
}

/**
 * Everything a workload does to a library. Transform methods mutate the
 * transform they are given, as both libraries' transforms do.
 *
 * @since 0.1.0
 * @category models
 */
export interface Lib<T extends Types> {
  // Documents
  readonly fromJSON: (json: NodeJSON) => T["node"]
  readonly toJSON: (node: T["node"]) => NodeJSON
  readonly contentSize: (node: T["node"]) => number
  readonly childCount: (node: T["node"]) => number
  readonly child: (node: T["node"], index: number) => T["node"]
  readonly nodeSize: (node: T["node"]) => number
  /** Whether `pos` sits directly inside a node with inline content. */
  readonly inlineAt: (doc: T["node"], pos: number) => boolean
  /** Calls `f` with every text node's text and position, in document order. */
  readonly forEachText: (doc: T["node"], f: (text: string, pos: number) => void) => void
  readonly mark: (name: "em" | "strong") => T["mark"]

  // States
  readonly create: (doc: T["node"], plugins: ReadonlyArray<T["plugin"]>) => T["state"]
  /** A state for `doc` with the cursor at `cursor`. */
  readonly createAt: (doc: T["node"], plugins: ReadonlyArray<T["plugin"]>, cursor: number) => T["state"]
  readonly doc: (state: T["state"]) => T["node"]
  readonly tr: (state: T["state"]) => T["transaction"]
  readonly apply: (state: T["state"], tr: T["transaction"]) => T["state"]
  /** Applies a transaction that sets a text selection from `from` to `to`. */
  readonly select: (state: T["state"], from: number, to: number) => T["state"]
  /** Runs `command`, returning the state after its transaction (or `state`). */
  readonly run: (command: T["command"], state: T["state"]) => T["state"]
  /** Serializes the state to JSON and back, with `plugins` reading their fields. */
  readonly roundTrip: (state: T["state"], plugins: ReadonlyArray<T["plugin"]>) => T["state"]

  // Transactions and transforms
  /** Types `text` over the selection. */
  readonly insertText: (tr: T["transaction"], text: string) => void
  readonly replaceText: (tr: T["transaction"], text: string, from: number, to: number) => void
  readonly setTime: (tr: T["transaction"], time: number) => void
  readonly setMeta: (tr: T["transaction"], key: string, value: number) => void
  readonly docChanged: (tr: T["transaction"]) => boolean
  readonly stepCount: (tr: T["transaction"]) => number
  readonly trDoc: (tr: T["transaction"]) => T["node"]
  readonly asTransform: (tr: T["transaction"]) => T["transform"]
  readonly transform: (doc: T["node"]) => T["transform"]
  readonly transformDoc: (tr: T["transform"]) => T["node"]
  readonly mapPos: (tr: T["transform"], pos: number) => number
  readonly steps: (tr: T["transform"]) => ReadonlyArray<T["step"]>
  readonly docs: (tr: T["transform"]) => ReadonlyArray<T["node"]>
  readonly invert: (step: T["step"], doc: T["node"]) => T["step"]
  readonly step: (tr: T["transform"], step: T["step"]) => void
  /** Applies `step` if it applies cleanly; reports whether it did. */
  readonly maybeStep: (tr: T["transform"], step: T["step"]) => boolean
  readonly mapping: () => T["mapping"]
  /** Appends `step`'s map, as the mirror of map `mirror` when given. */
  readonly appendStepMap: (mapping: T["mapping"], step: T["step"], mirror: Option.Option<number>) => void
  /** Maps `step` through `mapping` from map `from` on. */
  readonly mapStep: (step: T["step"], mapping: T["mapping"], from: number) => Option.Option<T["step"]>
  readonly delete: (tr: T["transform"], from: number, to: number) => void
  readonly insert: (tr: T["transform"], pos: number, node: T["node"]) => void
  readonly addMark: (tr: T["transform"], from: number, to: number, mark: T["mark"]) => void
  readonly removeMark: (tr: T["transform"], from: number, to: number, mark: T["mark"]) => void
  /** Removes every mark between `from` and `to`. */
  readonly clearMarks: (tr: T["transform"], from: number, to: number) => void

  // Plugins and commands
  readonly statePlugin: <V>(spec: StatePluginSpec<T, V>) => T["plugin"]
  readonly history: () => T["plugin"]
  readonly undo: T["command"]
  readonly redo: T["command"]
  readonly sinkListItem: T["command"]
  readonly liftListItem: T["command"]
  /** A fixed set of editing commands, in a fixed order. */
  readonly commands: ReadonlyArray<T["command"]>
  /** Inline decorations with class `cls` over each `[from, to]` range. */
  readonly decorations: (
    doc: T["node"],
    ranges: ReadonlyArray<readonly [number, number]>,
    cls: string
  ) => T["decorations"]
  readonly mapDecorations: (set: T["decorations"], tr: T["transaction"]) => T["decorations"]
}

/**
 * A deterministic pseudo-random number generator (mulberry32) in [0, 1).
 *
 * @since 0.1.0
 * @category constructors
 */
export const random = (seed: number): (() => number) => {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * A random integer in `[from, to)`.
 *
 * @since 0.1.0
 * @category constructors
 */
export const between = (r: () => number, from: number, to: number): number => from + Math.floor(r() * (to - from))

const WORDS = Arr.make(
  "lorem",
  "ipsum",
  "dolor",
  "sit",
  "amet",
  "consectetur",
  "adipiscing",
  "elit",
  "sed",
  "do",
  "eiusmod",
  "tempor",
  "incididunt",
  "ut",
  "labore"
)

const pick = <A>(r: () => number, items: Arr.NonEmptyReadonlyArray<A>): A =>
  Option.getOrElse(Arr.get(items, between(r, 0, items.length)), () => Arr.headNonEmpty(items))

const inline = (r: () => number): Array<NodeJSON> =>
  Arr.makeBy(between(r, 2, 8), () => {
    const text = Arr.makeBy(between(r, 2, 10), () => pick(r, WORDS)).join(" ") + " "
    const k = r()
    if (k < 0.15) return { type: "text", text, marks: [{ type: "em" }] }
    if (k < 0.3) return { type: "text", text, marks: [{ type: "strong" }] }
    if (k < 0.35) return { type: "text", text, marks: [{ type: "link", attrs: { href: "https://x.y" } }] }
    return { type: "text", text }
  })

const block = (r: () => number): NodeJSON => {
  const k = r()
  if (k < 0.65) return { type: "paragraph", content: inline(r) }
  if (k < 0.75) return { type: "heading", attrs: { level: between(r, 1, 4) }, content: inline(r) }
  if (k < 0.88) {
    return {
      type: "bullet_list",
      content: Arr.makeBy(3, () => ({ type: "list_item", content: [{ type: "paragraph", content: inline(r) }] }))
    }
  }
  return { type: "blockquote", content: Arr.makeBy(2, () => ({ type: "paragraph", content: inline(r) })) }
}

/**
 * A document of `blocks` top-level blocks of marked prose: paragraphs,
 * headings, three-item bullet lists and two-paragraph blockquotes.
 *
 * @since 0.1.0
 * @category constructors
 */
export const proseJSON = (blocks: number, seed = 42): NodeJSON => {
  const r = random(seed)
  return { type: "doc", content: Arr.makeBy(blocks, () => block(r)) }
}

const listItem = (depth: number, width: number, d: number): NodeJSON => ({
  type: "list_item",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "item at depth " + d }] },
    ...(d < depth
      ? [{ type: "bullet_list", content: Arr.makeBy(width, () => listItem(depth, width, d + 1)) }]
      : Arr.empty<NodeJSON>())
  ]
})

/**
 * A bullet list nested `depth` levels deep, `width` items per level below
 * the two at the top.
 *
 * @since 0.1.0
 * @category constructors
 */
export const deepListJSON = (depth: number, width: number): NodeJSON => ({
  type: "doc",
  content: [{ type: "bullet_list", content: [listItem(depth, width, 1), listItem(depth, width, 1)] }]
})
