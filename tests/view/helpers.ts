// Ported from prosemirror-view/test/view.ts (MIT, Marijn Haverbeke and others)
import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import { assert } from "@effect/vitest"
import type { Node as PMNode } from "@thomasfosterau/effect-richtext/Model"
import {
  EditorState,
  NodeSelection,
  type Plugin,
  Selection,
  TextSelection
} from "@thomasfosterau/effect-richtext/State"
import { schema, tagsOf } from "@thomasfosterau/effect-richtext/TestBuilder"
import { type DirectEditorProps, EditorView } from "@thomasfosterau/effect-richtext/View"
import { injectViewCSSUnsafe } from "@thomasfosterau/effect-richtext/ViewCss"
import { instanceOf } from "../utils/present.ts"

/** The `#workspace` element the ProseMirror test page provides. */
export const workspace = (): HTMLElement => {
  let space = document.querySelector<HTMLElement>("#workspace")
  if (!space) {
    // The ProseMirror test pages load prosemirror-view/style/prosemirror.css.
    injectViewCSSUnsafe(document)
    space = document.createElement("div")
    space.id = "workspace"
    document.body.appendChild(space)
  }
  // The tests run in an iframe, which has to be focused explicitly.
  if (!document.hasFocus()) window.focus()
  return space
}

export function selFor(doc: PMNode<any>): Selection<any> {
  const tag = tagsOf(doc),
    a = tag.a
  if (a != null) {
    const $a = doc.resolveUnsafe(a)
    if ($a.parent.inlineContent) return new TextSelection($a, tag.b != null ? doc.resolveUnsafe(tag.b) : undefined)
    else return new NodeSelection($a)
  }
  return Selection.atStart(doc)
}

let tempView: EditorView<any> | null = null

export type TempEditorProps = Partial<Omit<DirectEditorProps<any>, "plugins">> & {
  readonly plugins?: ReadonlyArray<Plugin<any, any, any>>
  readonly doc?: PMNode<any>
}

export function tempEditor(inProps: TempEditorProps = {}): EditorView<any> {
  const space = workspace()
  if (tempView) {
    tempView.destroy()
    tempView = null
  }

  const { plugins, ...rest } = inProps
  const state = EditorState.createUnsafe({
    doc: inProps.doc,
    schema,
    selection: inProps.doc && selFor(inProps.doc),
    plugins
  })
  // SAFETY: the fixtures' plugins declare no failures the view could surface, so
  // the state's error channel is narrowed to the view's default (`never`).
  const props: DirectEditorProps<any> = { ...rest, state: state as EditorState<any> }
  return (tempView = EditorView.makeUnsafe(space, props))
}

export function findTextNode(node: Node, text: string): Text | undefined {
  if (node.nodeType == 3) {
    if (node.nodeValue == text) return instanceOf(Text, node)
  } else if (node.nodeType == 1) {
    const found = Arr.findFirst(Array.from(node.childNodes), (ch) => Option.fromUndefinedOr(findTextNode(ch, text)))
    return Option.getOrUndefined(found)
  }
  return undefined
}

export function requireFocus<V extends EditorView<any, any, any>>(pm: V): V {
  // The tests run in an iframe, which has to be focused explicitly.
  if (!document.hasFocus()) window.focus()
  if (!document.hasFocus()) {
    assert.fail("The document doesn't have focus, which is needed for this test")
  }
  pm.focus()
  return pm
}

export function flush(view: EditorView<any, any, any>): void {
  view.domObserver.flush()
}
