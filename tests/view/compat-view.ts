// Ported from prosemirror-view/test/view.ts (MIT, Marijn Haverbeke and others).
// Changes: imports only (ProseMirror packages -> @thomasfosterau/effect-richtext/compat/*), plus:
// - creates the `#workspace` element (and test CSS) that the ProseMirror test
//   page provides, using `workspace()` from ./helpers.ts.
// - `requireFocus` fails the test with `assert.fail` instead of throwing.
import { assert } from "@effect/vitest"
import type { Node as PMNode } from "@thomasfosterau/effect-richtext/compat/model"
import type { Plugin } from "@thomasfosterau/effect-richtext/compat/state"
import { EditorState, NodeSelection, Selection, TextSelection } from "@thomasfosterau/effect-richtext/compat/state"
import { schema } from "@thomasfosterau/effect-richtext/compat/test-builder"
import { type DirectEditorProps, EditorView } from "@thomasfosterau/effect-richtext/compat/view"
import { instanceOf } from "../utils/present.ts"
import { tagsOf } from "../utils/tags.ts"
import { workspace } from "./helpers.ts"

workspace()

function selFor(doc: PMNode) {
  const tag = tagsOf(doc),
    a = tag.a
  if (a != null) {
    const $a = doc.resolve(a)
    if ($a.parent.inlineContent) return new TextSelection($a, tag.b != null ? doc.resolve(tag.b) : undefined)
    else return new NodeSelection($a)
  }
  return Selection.atStart(doc)
}

let tempView: EditorView | null = null

export function tempEditor(inProps: Partial<DirectEditorProps> & { plugins?: readonly Plugin[]; doc?: PMNode } = {}) {
  const space = document.querySelector("#workspace")
  if (tempView) {
    tempView.destroy()
    tempView = null
  }

  const { plugins, ...rest } = inProps
  const props: DirectEditorProps = {
    ...rest,
    state: EditorState.create({
      doc: inProps.doc,
      schema,
      selection: inProps.doc && selFor(inProps.doc),
      plugins
    })
  }
  return (tempView = new EditorView(space, props))
}

export function findTextNode(node: Node, text: string): Text | undefined {
  if (node.nodeType == 3) {
    if (node.nodeValue == text) return instanceOf(Text, node)
  } else if (node.nodeType == 1) {
    return Array.from(node.childNodes).reduce<Text | undefined>(
      (found, ch) => found ?? findTextNode(ch, text),
      undefined
    )
  }
  return undefined
}

export function requireFocus(pm: EditorView) {
  if (!document.hasFocus()) {
    assert.fail("The document doesn't have focus, which is needed for this test")
  }
  pm.focus()
  return pm
}

export function flush(view: EditorView) {
  // `domObserver` is an internal API the facade's public type does not declare.
  view.domObserver.flush()
}
