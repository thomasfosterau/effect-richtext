// Ported from the `apply` helper in prosemirror-commands/test/test-commands.ts
// (MIT, Marijn Haverbeke and others).
import { Effect } from "effect"
import type { Node } from "effect-richtext/model"
import { type Command, EditorState } from "effect-richtext/state"
import { eq, tagsOf } from "effect-richtext/test-builder"
import { selFor } from "../state/state.ts"
import ist from "../utils/ist.ts"

export function mkState(doc: Node<any>): EditorState<any> {
  return EditorState.createUnsafe({ doc, selection: selFor(doc) })
}

/** Run a command (which must not require services) against a state, applying dispatched transactions. */
export function run(state: EditorState<any>, command: Command<any, any, never>): EditorState<any> {
  Effect.runSync(
    command(state, (tr) =>
      Effect.sync(() => {
        state = state.applyUnsafe(tr)
      })
    )
  )
  return state
}

export function apply(doc: Node<any>, command: Command<any, any, never>, result: Node<any> | null): void {
  const state = run(mkState(doc), command)
  ist(state.doc, result || doc, eq)
  if (result && tagsOf(result).a != null) ist(state.selection, selFor(result), eq)
}
