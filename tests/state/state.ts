// Ported from prosemirror-state/test/state.ts (MIT, Marijn Haverbeke and others)
// Wrapper object to make writing state tests easier.
import { Effect } from "effect"
import type { AnySchema, Node } from "effect-richtext/model"
import {
  type Command,
  EditorState,
  NodeSelection,
  Selection,
  TextSelection,
  type Transaction
} from "effect-richtext/state"

export function selFor(doc: Node<any>): Selection<any> {
  const tag = (doc as any).tag
  const a = tag.a
  if (a != null) {
    const $a = doc.resolveUnsafe(a)
    if ($a.parent.inlineContent) {
      return new TextSelection($a, tag.b != null ? doc.resolveUnsafe(tag.b) : undefined)
    } else return new NodeSelection($a)
  }
  return Selection.atStart(doc)
}

export class TestState {
  state: EditorState<any>
  constructor(config: { selection?: Selection<any>; doc?: Node<any>; schema?: AnySchema }) {
    if (!config.selection && config.doc) config = { ...config, selection: selFor(config.doc) }
    this.state = EditorState.createUnsafe(config)
  }

  apply(tr: Transaction<any>) {
    this.state = this.state.applyUnsafe(tr)
  }

  command(cmd: Command<any>) {
    return Effect.runSync(cmd(this.state, (tr) => Effect.sync(() => this.apply(tr))))
  }

  type(text: string) {
    this.apply(this.tr.insertTextUnsafe(text))
  }

  deleteSelection() {
    this.apply(this.state.tr.deleteSelection())
  }

  textSel(anchor: number, head?: number) {
    const sel = TextSelection.createUnsafe(this.state.doc, anchor, head)
    this.state = this.state.applyUnsafe(this.state.tr.setSelectionUnsafe(sel))
  }

  nodeSel(pos: number) {
    const sel = NodeSelection.createUnsafe(this.state.doc, pos)
    this.state = this.state.applyUnsafe(this.state.tr.setSelectionUnsafe(sel))
  }

  get doc() {
    return this.state.doc
  }
  get selection() {
    return this.state.selection
  }
  get tr() {
    return this.state.tr
  }
}
