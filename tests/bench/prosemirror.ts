/**
 * The `Lib` adapter over ProseMirror itself, the reference the core is
 * measured and checked against.
 *
 * @copyright Thomas Foster
 */
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
} from "prosemirror-commands"
import { history, redo, undo } from "prosemirror-history"
import { type Mark, Node } from "prosemirror-model"
import { liftListItem, sinkListItem } from "prosemirror-schema-list"
import { type Command, EditorState, Plugin, type PluginSpec, TextSelection, type Transaction } from "prosemirror-state"
import { schema } from "prosemirror-test-builder"
import { Mapping, type Step, Transform } from "prosemirror-transform"
import { Decoration, DecorationSet } from "prosemirror-view"
import type { Lib, StatePluginSpec, Types } from "./lib.ts"
import { shared } from "./shared.ts"

/**
 * ProseMirror's types.
 *
 * @since 0.1.0
 * @category models
 */
export interface ProseMirrorTypes extends Types {
  readonly node: Node
  readonly mark: Mark
  readonly state: EditorState
  readonly transaction: Transaction
  readonly transform: Transform
  readonly step: Step
  readonly mapping: Mapping
  readonly plugin: Plugin
  readonly command: Command
  readonly decorations: DecorationSet
}

const statePlugin = <V>(spec: StatePluginSpec<ProseMirrorTypes, V>): Plugin<V> => {
  const base: PluginSpec<V> = {
    state: { init: (_config, instance) => spec.init(instance.doc), apply: (tr, value) => spec.apply(tr, value) }
  }
  const filtered = Option.match(spec.filter, {
    onNone: () => base,
    onSome: (filterTransaction): PluginSpec<V> => ({ ...base, filterTransaction })
  })
  const plugin: Plugin<V> = new Plugin(
    Option.match(spec.append, {
      onNone: () => filtered,
      onSome: (append): PluginSpec<V> => ({
        ...filtered,
        appendTransaction: (trs, _old, next) =>
          Option.getOrUndefined(
            Option.flatMap(Option.fromNullishOr(plugin.getState(next)), (value) =>
              Option.map(append(trs, value), ([key, meta]) => next.tr.setMeta(key, meta))
            )
          )
      })
    })
  )
  return plugin
}

/**
 * ProseMirror behind the workloads' `Lib` seam.
 *
 * @since 0.1.0
 * @category adapters
 */
export const prosemirror: Lib<ProseMirrorTypes> = {
  ...shared,
  fromJSON: (json) => Node.fromJSON(schema, json),
  child: (node, index) => node.child(index),
  inlineAt: (doc, pos) => doc.resolve(pos).parent.inlineContent,
  forEachText: (doc, f) =>
    doc.descendants((node, pos) => {
      if (node.isText) f(node.textContent, pos)
    }),
  mark: (name) => schema.marks[name].create(),

  create: (doc, plugins) => EditorState.create({ doc, plugins: [...plugins] }),
  createAt: (doc, plugins, cursor) =>
    EditorState.create({ doc, plugins: [...plugins], selection: TextSelection.create(doc, cursor) }),
  apply: (state, tr) => state.apply(tr),
  select: (state, from, to) => state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to))),
  run: (command, state) => {
    let out = state
    command(state, (tr) => {
      out = state.apply(tr)
    })
    return out
  },
  roundTrip: (state, plugins) => EditorState.fromJSON({ schema, plugins: [...plugins] }, state.toJSON()),

  insertText: (tr, text) => {
    tr.insertText(text)
  },
  replaceText: (tr, text, from, to) => {
    tr.insertText(text, from, to)
  },
  transform: (doc) => new Transform(doc),
  step: (tr, step) => {
    tr.step(step)
  },
  maybeStep: (tr, step) => tr.maybeStep(step).failed === null,
  mapping: () => new Mapping(),
  mapStep: (step, mapping, from) => Option.fromNullishOr(step.map(mapping.slice(from))),
  delete: (tr, from, to) => {
    tr.delete(from, to)
  },
  insert: (tr, pos, node) => {
    tr.insert(pos, node)
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
