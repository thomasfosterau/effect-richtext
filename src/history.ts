/**
 * An undo/redo history for the editor, ported from
 * `prosemirror-history`.
 *
 * ```ts skip-type-checking
 * const state = EditorState.createUnsafe({ schema, plugins: [history()] })
 * // ...
 * yield* undo(state, dispatch)
 * ```
 *
 * @since 0.1.0
 */
// Ported from prosemirror-history (MIT, Marijn Haverbeke and others)
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import RopeSequence from "rope-sequence"
import type { AnySchema } from "./model.ts"
import {
  type Dispatch,
  type EditorState,
  type EditorViewLike,
  Plugin,
  PluginKey,
  type SelectionBookmark,
  type Transaction
} from "./state.ts"
import { Mapping, type Step, type StepMap, type Transform } from "./transform.ts"

// ProseMirror's history isn't simply a way to roll back to a previous
// state, because ProseMirror supports applying changes without adding
// them to the history (for example during collaboration).
//
// To this end, each 'Branch' (one for the undo history and one for
// the redo history) keeps an array of 'Items', which can optionally
// hold a step (an actual undoable change), and always hold a position
// map (which is needed to move changes below them to apply to the
// current document).
//
// An item that has both a step and a selection bookmark is the start
// of an 'event' — a group of changes that will be undone or redone at
// once. (It stores only the bookmark, since that way we don't have to
// provide a document until the selection is actually applied, which
// is useful when compressing.)

// Used to schedule history compression
const max_empty_items = 500

const DEPTH_OVERFLOW = 20

interface PopResult {
  readonly remaining: Branch
  readonly transform: Transaction<any>
  readonly selection: SelectionBookmark<any>
}

/** @internal */
export class Branch {
  constructor(
    readonly items: RopeSequence<Item>,
    readonly eventCount: number
  ) {}

  // Pop the latest event off the branch's history and apply it
  // to a document transform.
  popEvent(state: EditorState<any, any, any>, preserveItems: boolean): PopResult | null {
    if (this.eventCount === 0) return null

    let end = this.items.length
    for (; ; end--) {
      const next = this.items.get(end - 1)
      if (next.selection) {
        --end
        break
      }
    }

    let remap: Mapping | undefined, mapFrom: number | undefined
    if (preserveItems) {
      remap = this.remapping(end, this.items.length)
      mapFrom = remap.maps.length
    }
    const transform = state.tr
    let selection: SelectionBookmark<any> | undefined, remaining: Branch | undefined
    const addAfter: Array<Item> = [],
      addBefore: Array<Item> = []

    this.items.forEach(
      (item, i) => {
        if (!item.step) {
          if (!remap) {
            remap = this.remapping(end, i + 1)
            mapFrom = remap.maps.length
          }
          mapFrom!--
          addBefore.push(item)
          return
        }

        if (remap) {
          addBefore.push(new Item(item.map))
          const step = Option.getOrNull(item.step.map(remap.slice(mapFrom)))
          let map: StepMap | undefined

          if (step && transform.maybeStep(step).docOrNull) {
            map = transform.mapping.maps[transform.mapping.maps.length - 1]
            addAfter.push(new Item(map!, undefined, undefined, addAfter.length + addBefore.length))
          }
          mapFrom!--
          if (map) remap.appendMap(map, mapFrom)
        } else {
          transform.maybeStep(item.step)
        }

        if (item.selection) {
          selection = remap ? item.selection.map(remap.slice(mapFrom)) : item.selection
          remaining = new Branch(
            this.items.slice(0, end).append(addBefore.reverse().concat(addAfter)),
            this.eventCount - 1
          )
          return false
        }
        return undefined
      },
      this.items.length,
      0
    )

    return { remaining: remaining!, transform, selection: selection! }
  }

  // Create a new branch with the given transform added.
  addTransform(
    transform: Transform<any>,
    selection: SelectionBookmark<any> | undefined,
    histOptions: HistoryConfig,
    preserveItems: boolean
  ): Branch {
    const newItems: Array<Item> = []
    let eventCount = this.eventCount
    let oldItems = this.items,
      lastItem = !preserveItems && oldItems.length ? oldItems.get(oldItems.length - 1) : null

    for (let i = 0; i < transform.steps.length; i++) {
      const step = transform.steps[i]!.invert(transform.docs[i]!)
      let item = new Item(transform.mapping.maps[i]!, step, selection)
      const merged = lastItem && lastItem.merge(item)
      if (merged) {
        item = merged
        if (i) newItems.pop()
        else oldItems = oldItems.slice(0, oldItems.length - 1)
      }
      newItems.push(item)
      if (selection) {
        eventCount++
        selection = undefined
      }
      if (!preserveItems) lastItem = item
    }
    const overflow = eventCount - histOptions.depth
    if (overflow > DEPTH_OVERFLOW) {
      oldItems = cutOffEvents(oldItems, overflow)
      eventCount -= overflow
    }
    return new Branch(oldItems.append(newItems), eventCount)
  }

  remapping(from: number, to: number): Mapping {
    const maps = new Mapping()
    this.items.forEach(
      (item, i) => {
        const mirrorPos =
          item.mirrorOffset != null && i - item.mirrorOffset >= from ? maps.maps.length - item.mirrorOffset : undefined
        maps.appendMap(item.map, mirrorPos)
      },
      from,
      to
    )
    return maps
  }

  addMaps(array: ReadonlyArray<StepMap>): Branch {
    if (this.eventCount === 0) return this
    return new Branch(this.items.append(array.map((map) => new Item(map))), this.eventCount)
  }

  // When the collab module receives remote changes, the history has
  // to know about those, so that it can adjust the steps that were
  // rebased on top of the remote changes, and include the position
  // maps for the remote changes in its array of items.
  rebased(rebasedTransform: Transform<any>, rebasedCount: number): Branch {
    if (!this.eventCount) return this

    const rebasedItems: Array<Item> = [],
      start = Math.max(0, this.items.length - rebasedCount)

    const mapping = rebasedTransform.mapping
    let newUntil = rebasedTransform.steps.length
    let eventCount = this.eventCount
    this.items.forEach((item) => {
      if (item.selection) eventCount--
    }, start)

    let iRebased = rebasedCount
    this.items.forEach((item) => {
      const pos = mapping.getMirrorOrUndefined(--iRebased)
      if (pos == null) return
      newUntil = Math.min(newUntil, pos)
      const map = mapping.maps[pos]!
      if (item.step) {
        const step = rebasedTransform.steps[pos]!.invert(rebasedTransform.docs[pos]!)
        const selection = item.selection && item.selection.map(mapping.slice(iRebased + 1, pos))
        if (selection) eventCount++
        rebasedItems.push(new Item(map, step, selection))
      } else {
        rebasedItems.push(new Item(map))
      }
    }, start)

    const newMaps: Array<Item> = []
    for (let i = rebasedCount; i < newUntil; i++) newMaps.push(new Item(mapping.maps[i]!))
    const items = this.items.slice(0, start).append(newMaps).append(rebasedItems)
    let branch = new Branch(items, eventCount)

    if (branch.emptyItemCount() > max_empty_items) {
      branch = branch.compress(this.items.length - rebasedItems.length)
    }
    return branch
  }

  emptyItemCount(): number {
    let count = 0
    this.items.forEach((item) => {
      if (!item.step) count++
    })
    return count
  }

  // Compressing a branch means rewriting it to push the air (map-only
  // items) out. During collaboration, these naturally accumulate
  // because each remote change adds one. The `upto` argument is used
  // to ensure that only the items below a given level are compressed,
  // because `rebased` relies on a clean, untouched set of items in
  // order to associate old items with rebased steps.
  compress(upto = this.items.length): Branch {
    const remap = this.remapping(0, upto)
    let mapFrom = remap.maps.length
    const items: Array<Item> = []
    let events = 0
    this.items.forEach(
      (item, i) => {
        if (i >= upto) {
          items.push(item)
          if (item.selection) events++
        } else if (item.step) {
          const step = Option.getOrNull(item.step.map(remap.slice(mapFrom))),
            map = step && step.getMap()
          mapFrom--
          if (map) remap.appendMap(map, mapFrom)
          if (step) {
            const selection = item.selection && item.selection.map(remap.slice(mapFrom))
            if (selection) events++
            const newItem = new Item(map!.invert(), step, selection),
              last = items.length - 1
            const merged = items.length ? items[last]!.merge(newItem) : undefined
            if (merged) items[last] = merged
            else items.push(newItem)
          }
        } else if (item.map) {
          mapFrom--
        }
      },
      this.items.length,
      0
    )
    return new Branch(RopeSequence.from(items.reverse()), events)
  }

  static empty = new Branch(RopeSequence.empty, 0)
}

function cutOffEvents(items: RopeSequence<Item>, n: number): RopeSequence<Item> {
  let cutPoint: number | undefined
  items.forEach((item, i) => {
    if (item.selection && n-- === 0) {
      cutPoint = i
      return false
    }
    return undefined
  })
  return items.slice(cutPoint!)
}

/** @internal */
export class Item {
  constructor(
    // The (forward) step map for this item.
    readonly map: StepMap,
    // The inverted step
    readonly step?: Step<any>,
    // If this is non-null, this item is the start of a group, and
    // this selection is the starting selection for the group (the one
    // that was active before the first step was applied)
    readonly selection?: SelectionBookmark<any>,
    // If this item is the inverse of a previous mapping on the stack,
    // this points at the inverse's offset
    readonly mirrorOffset?: number
  ) {}

  merge(other: Item): Item | undefined {
    if (this.step && other.step && !other.selection) {
      const step = Option.getOrNull(other.step.merge(this.step))
      if (step) return new Item(step.getMap().invert(), step, this.selection)
    }
    return undefined
  }
}

/**
 * The value of the state field that tracks undo/redo history for that
 * state. Will be stored in the plugin state when the history plugin is
 * active. Its contents are opaque.
 *
 * @since 0.1.0
 * @category models
 */
export class HistoryState {
  /** @internal */
  constructor(
    /** @internal */
    readonly done: Branch,
    /** @internal */
    readonly undone: Branch,
    /** @internal */
    readonly prevRanges: ReadonlyArray<number> | null,
    /** @internal */
    readonly prevTime: number,
    /** @internal */
    readonly prevComposition: number
  ) {}
}

interface HistoryMeta {
  readonly redo: boolean
  readonly historyState: HistoryState
}

const meta = <A>(tr: Transaction<any>, key: Parameters<Transaction<any>["getMeta"]>[0]): A | undefined =>
  Option.getOrUndefined(tr.getMeta<A>(key))

// Record a transformation in undo history.
function applyTransaction(
  history: HistoryState,
  state: EditorState<any, any, any>,
  tr: Transaction<any>,
  options: HistoryConfig
): HistoryState {
  const historyTr = meta<HistoryMeta>(tr, historyKey)
  if (historyTr) return historyTr.historyState

  if (meta(tr, closeHistoryKey)) history = new HistoryState(history.done, history.undone, null, 0, -1)

  const appended = meta<Transaction<any>>(tr, "appendedTransaction")
  let rebased: number | undefined

  if (tr.steps.length === 0) {
    return history
  } else if (appended && meta(appended, historyKey)) {
    if (meta<HistoryMeta>(appended, historyKey)!.redo) {
      return new HistoryState(
        history.done.addTransform(tr, undefined, options, mustPreserveItems(state)),
        history.undone,
        rangesFor(tr.mapping.maps),
        history.prevTime,
        history.prevComposition
      )
    } else {
      return new HistoryState(
        history.done,
        history.undone.addTransform(tr, undefined, options, mustPreserveItems(state)),
        null,
        history.prevTime,
        history.prevComposition
      )
    }
  } else if (meta(tr, "addToHistory") !== false && !(appended && meta(appended, "addToHistory") === false)) {
    // Group transforms that occur in quick succession into one event.
    const composition = meta<number>(tr, "composition")
    const newGroup =
      history.prevTime === 0 ||
      (!appended &&
        history.prevComposition !== composition &&
        (history.prevTime < (tr.time || 0) - options.newGroupDelay || !isAdjacentTo(tr, history.prevRanges)))
    const prevRanges = appended ? mapRanges(history.prevRanges, tr.mapping) : rangesFor(tr.mapping.maps)
    return new HistoryState(
      history.done.addTransform(
        tr,
        newGroup ? state.selection.getBookmark() : undefined,
        options,
        mustPreserveItems(state)
      ),
      Branch.empty,
      prevRanges,
      tr.time,
      composition == null ? history.prevComposition : composition
    )
  } else if ((rebased = meta<number>(tr, "rebased"))) {
    // Used by the collab module to tell the history that some of its
    // content has been rebased.
    return new HistoryState(
      history.done.rebased(tr, rebased),
      history.undone.rebased(tr, rebased),
      mapRanges(history.prevRanges, tr.mapping),
      history.prevTime,
      history.prevComposition
    )
  } else {
    return new HistoryState(
      history.done.addMaps(tr.mapping.maps),
      history.undone.addMaps(tr.mapping.maps),
      mapRanges(history.prevRanges, tr.mapping),
      history.prevTime,
      history.prevComposition
    )
  }
}

function isAdjacentTo(transform: Transform<any>, prevRanges: ReadonlyArray<number> | null): boolean {
  if (!prevRanges) return false
  if (!transform.docChanged) return true
  let adjacent = false
  transform.mapping.maps[0]!.forEach((start, end) => {
    for (let i = 0; i < prevRanges.length; i += 2) {
      if (start <= prevRanges[i + 1]! && end >= prevRanges[i]!) adjacent = true
    }
  })
  return adjacent
}

function rangesFor(maps: ReadonlyArray<StepMap>): Array<number> {
  const result: Array<number> = []
  for (let i = maps.length - 1; i >= 0 && result.length === 0; i--) {
    maps[i]!.forEach((_from, _to, from, to) => result.push(from, to))
  }
  return result
}

function mapRanges(ranges: ReadonlyArray<number> | null, mapping: Mapping): Array<number> | null {
  if (!ranges) return null
  const result: Array<number> = []
  for (let i = 0; i < ranges.length; i += 2) {
    const from = mapping.map(ranges[i]!, 1),
      to = mapping.map(ranges[i + 1]!, -1)
    if (from <= to) result.push(from, to)
  }
  return result
}

// Apply the latest event from one branch to the document and shift the event
// onto the other branch.
function histTransaction<Sc extends AnySchema>(
  history: HistoryState,
  state: EditorState<Sc, any, any>,
  redo: boolean
): Transaction<Sc> | null {
  const preserveItems = mustPreserveItems(state)
  const histOptions = (Option.getOrThrow(historyKey.get(state)).spec as any).config as HistoryConfig
  const pop = (redo ? history.undone : history.done).popEvent(state, preserveItems)
  if (!pop) return null

  const selection = pop.selection.resolve(pop.transform.doc)
  const added = (redo ? history.done : history.undone).addTransform(
    pop.transform,
    state.selection.getBookmark(),
    histOptions,
    preserveItems
  )

  const newHist = new HistoryState(redo ? added : pop.remaining, redo ? pop.remaining : added, null, 0, -1)
  return pop.transform.setSelectionUnsafe(selection).setMeta(historyKey, { redo, historyState: newHist })
}

let cachedPreserveItems = false,
  cachedPreserveItemsPlugins: ReadonlyArray<Plugin<any, any, any, any>> | null = null
// Check whether any plugin in the given state has a
// `historyPreserveItems` property in its spec, in which case we must
// preserve steps exactly as they came in, so that they can be
// rebased.
function mustPreserveItems(state: EditorState<any, any, any>): boolean {
  const plugins = state.plugins
  if (cachedPreserveItemsPlugins !== plugins) {
    cachedPreserveItems = false
    cachedPreserveItemsPlugins = plugins
    for (let i = 0; i < plugins.length; i++) {
      if (plugins[i]!.spec.historyPreserveItems) {
        cachedPreserveItems = true
        break
      }
    }
  }
  return cachedPreserveItems
}

/**
 * Set a flag on the given transaction that will prevent further steps
 * from being appended to an existing history event (so that they
 * require a separate undo command to undo).
 *
 * @since 0.1.0
 * @category transactions
 */
export const closeHistory = <Sc extends AnySchema>(tr: Transaction<Sc>): Transaction<Sc> =>
  tr.setMeta(closeHistoryKey, true)

const historyKey = new PluginKey<HistoryState>("history")

interface HistoryConfig {
  readonly depth: number
  readonly newGroupDelay: number
}
const closeHistoryKey = new PluginKey("closeHistory")

/**
 * Options for the history plugin.
 *
 * @since 0.1.0
 * @category models
 */
export interface HistoryOptions {
  /**
   * The amount of history events that are collected before the oldest
   * events are discarded. Defaults to 100.
   */
  readonly depth?: number | undefined

  /**
   * The delay between changes after which a new group should be
   * started. Defaults to 500 (milliseconds). Note that when changes
   * aren't adjacent, a new group is always started.
   */
  readonly newGroupDelay?: number | undefined
}

/**
 * A command provided by this module. It works with any schema and
 * needs no services.
 *
 * @since 0.1.0
 * @category models
 */
export type HistoryCommand = <Sc extends AnySchema>(
  state: EditorState<Sc, any, any>,
  dispatch?: Dispatch<Sc>,
  view?: EditorViewLike
) => Effect.Effect<boolean>

/**
 * Returns a plugin that enables the undo history for an editor. The
 * plugin will track undo and redo stacks, which can be used with the
 * `undo` and `redo` commands.
 *
 * You can set an `"addToHistory"` metadata property of `false` on a
 * transaction to prevent it from being rolled back by undo.
 *
 * @since 0.1.0
 * @category constructors
 */
export const history = (config: HistoryOptions = {}): Plugin<HistoryState> => {
  const options: HistoryConfig = {
    depth: config.depth || 100,
    newGroupDelay: config.newGroupDelay || 500
  }

  return new Plugin<HistoryState>({
    key: historyKey,

    state: {
      init() {
        return new HistoryState(Branch.empty, Branch.empty, null, 0, -1)
      },
      apply(tr, hist, state) {
        return applyTransaction(hist, state, tr, options)
      }
    },

    config: options,

    props: {
      handleDOMEvents: {
        beforeinput(view, e) {
          const inputType = (e as InputEvent).inputType
          const command = inputType === "historyUndo" ? undo : inputType === "historyRedo" ? redo : null
          if (!command || !view.editable) return false
          e.preventDefault()
          return command(view.state, view.dispatch)
        }
      }
    }
  })
}

const buildCommand =
  (redo: boolean, scroll: boolean): HistoryCommand =>
  (state, dispatch) =>
    Effect.suspend(() => {
      const hist = Option.getOrUndefined(historyKey.getState(state))
      if (!hist || (redo ? hist.undone : hist.done).eventCount === 0) return Effect.succeed(false)
      if (dispatch) {
        const tr = histTransaction(hist, state, redo)
        if (tr) return Effect.as(dispatch(scroll ? tr.scrollIntoView() : tr), true)
      }
      return Effect.succeed(true)
    })

/**
 * A command that undoes the last change, if any.
 *
 * @since 0.1.0
 * @category commands
 */
export const undo: HistoryCommand = buildCommand(false, true)

/**
 * A command that redoes the last undone change, if any.
 *
 * @since 0.1.0
 * @category commands
 */
export const redo: HistoryCommand = buildCommand(true, true)

/**
 * A command that undoes the last change. Doesn't scroll the selection
 * into view.
 *
 * @since 0.1.0
 * @category commands
 */
export const undoNoScroll: HistoryCommand = buildCommand(false, false)

/**
 * A command that redoes the last undone change. Doesn't scroll the
 * selection into view.
 *
 * @since 0.1.0
 * @category commands
 */
export const redoNoScroll: HistoryCommand = buildCommand(true, false)

/**
 * The amount of undoable events available in a given state.
 *
 * @since 0.1.0
 * @category getters
 */
export const undoDepth = (state: EditorState<any, any, any>): number => {
  const hist = Option.getOrUndefined(historyKey.getState(state))
  return hist ? hist.done.eventCount : 0
}

/**
 * The amount of redoable events available in a given editor state.
 *
 * @since 0.1.0
 * @category getters
 */
export const redoDepth = (state: EditorState<any, any, any>): number => {
  const hist = Option.getOrUndefined(historyKey.getState(state))
  return hist ? hist.undone.eventCount : 0
}

/**
 * Returns true if the given transaction was generated by the history
 * plugin.
 *
 * @since 0.1.0
 * @category guards
 */
export const isHistoryTransaction = (tr: Transaction<any>): boolean => Option.isSome(tr.getMeta(historyKey))
