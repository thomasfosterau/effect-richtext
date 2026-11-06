/**
 * The `Lib` adapter over @thomasfosterau/effect-richtext's core, through the synchronous
 * `…Unsafe` twins an editor's hot path uses (DESIGN.md, "Fallible
 * operations").
 *
 * @copyright Thomas Foster
 */
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import {
  deleteSelection,
  joinBackward,
  joinForward,
  lift,
  selectParentNode,
  setBlockType,
  splitBlock,
  toggleMark,
  wrapIn
} from "@thomasfosterau/effect-richtext/commands"
import { history, redo, undo } from "@thomasfosterau/effect-richtext/history"
import type { Mark, Node } from "@thomasfosterau/effect-richtext/model"
import { liftListItem, sinkListItem } from "@thomasfosterau/effect-richtext/schema-list"
import {
  type Command,
  EditorState,
  Plugin,
  type PluginSpec,
  TextSelection,
  type Transaction
} from "@thomasfosterau/effect-richtext/state"
import { schema } from "@thomasfosterau/effect-richtext/test-builder"
import { Mapping, type Step, Transform } from "@thomasfosterau/effect-richtext/transform"
import { Decoration, DecorationSet } from "@thomasfosterau/effect-richtext/view"
import type { Lib, StatePluginSpec, Types } from "./lib.ts"
import { shared } from "./shared.ts"

type Sc = typeof schema

// Any synchronous plugin (the constraint `EditorState.createUnsafe` puts on
// its plugins), and the state it builds from them.
type CorePlugin = NonNullable<Parameters<typeof EditorState.createUnsafe>[0]["plugins"]>[number]
type CoreState = ReturnType<typeof EditorState.createUnsafe<Sc, ReadonlyArray<CorePlugin>>>

/**
 * The core's types, over the test-builder schema.
 *
 * @since 0.1.0
 * @category models
 */
export interface CoreTypes extends Types {
  readonly node: Node<Sc>
  readonly mark: Mark<Sc>
  readonly state: CoreState
  readonly transaction: Transaction<Sc>
  readonly transform: Transform<Sc>
  readonly step: Step<Sc>
  readonly mapping: Mapping
  readonly plugin: CorePlugin
  readonly command: Command<Sc>
  readonly decorations: DecorationSet
}

const statePlugin = <V>(spec: StatePluginSpec<CoreTypes, V>): Plugin<V, Sc> => {
  const base: PluginSpec<V, Sc> = {
    state: { init: (_config, instance) => spec.init(instance.doc), apply: (tr, value) => spec.apply(tr, value) }
  }
  const filtered = Option.match(spec.filter, {
    onNone: () => base,
    onSome: (filterTransaction): PluginSpec<V, Sc> => ({ ...base, filterTransaction })
  })
  const plugin: Plugin<V, Sc> = new Plugin(
    Option.match(spec.append, {
      onNone: () => filtered,
      onSome: (append): PluginSpec<V, Sc> => ({
        ...filtered,
        appendTransaction: (trs, _old, next) =>
          Option.getOrUndefined(
            Option.flatMap(plugin.getState(next), (value) =>
              Option.map(append(trs, value), ([key, meta]) => next.tr.setMeta(key, meta))
            )
          )
      })
    })
  )
  return plugin
}

/**
 * The core behind the workloads' `Lib` seam.
 *
 * @since 0.1.0
 * @category adapters
 */
export const core: Lib<CoreTypes> = {
  ...shared,
  fromJSON: (json) => schema.nodeFromJSONUnsafe(json),
  child: (node, index) => node.childUnsafe(index),
  inlineAt: (doc, pos) => doc.resolveUnsafe(pos).parent.inlineContent,
  forEachText: (doc, f) =>
    doc.descendants((node, pos) => {
      if (node.isText) f(node.textContent, pos)
    }),
  mark: (name) => schema.marks[name].createUnsafe(),

  create: (doc, plugins) => EditorState.createUnsafe({ doc, plugins }),
  createAt: (doc, plugins, cursor) =>
    EditorState.createUnsafe({ doc, plugins, selection: TextSelection.createUnsafe(doc, cursor) }),
  apply: (state, tr) => state.applyUnsafe(tr),
  select: (state, from, to) =>
    state.applyUnsafe(state.tr.setSelectionUnsafe(TextSelection.createUnsafe(state.doc, from, to))),
  run: (command, state) => {
    let out = state
    Effect.runSync(
      command(state, (tr) =>
        Effect.sync(() => {
          out = state.applyUnsafe(tr)
        })
      )
    )
    return out
  },
  roundTrip: (state, plugins) => EditorState.fromJSONUnsafe({ schema, plugins }, state.toJSON()),

  insertText: (tr, text) => {
    tr.insertTextUnsafe(text)
  },
  replaceText: (tr, text, from, to) => {
    tr.insertTextUnsafe(text, from, to)
  },
  transform: (doc) => new Transform(doc),
  step: (tr, step) => {
    tr.stepUnsafe(step)
  },
  maybeStep: (tr, step) => tr.maybeStep(step).failedOrNull === null,
  mapping: () => new Mapping(),
  mapStep: (step, mapping, from) => step.map(mapping.slice(from)),
  delete: (tr, from, to) => {
    tr.deleteUnsafe(from, to)
  },
  insert: (tr, pos, node) => {
    tr.insertUnsafe(pos, node)
  },
  statePlugin,
  history: () => history(),
  undo,
  redo,
  sinkListItem: sinkListItem(schema.nodes.list_item),
  liftListItem: liftListItem(schema.nodes.list_item),
  commands: [
    splitBlock,
    joinBackward,
    joinForward,
    deleteSelection,
    toggleMark(schema.marks.strong),
    wrapIn(schema.nodes.blockquote),
    lift,
    setBlockType(schema.nodes.heading, { level: 2 }),
    setBlockType(schema.nodes.paragraph),
    selectParentNode
  ],
  decorations: (doc, ranges, cls) =>
    DecorationSet.create(
      doc,
      ranges.map(([from, to]) => Decoration.inline(from, to, { class: cls }))
    )
}
