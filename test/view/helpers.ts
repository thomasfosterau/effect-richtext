// Ported from prosemirror-view/test/view.ts (MIT, Marijn Haverbeke and others)
import type { Node as PMNode } from "effect-richtext/model"
import { EditorState, NodeSelection, type Plugin, Selection, TextSelection } from "effect-richtext/state"
import { schema } from "effect-richtext/test-builder"
import { type DirectEditorProps, EditorView } from "effect-richtext/view"
import { injectViewCSSUnsafe } from "effect-richtext/view-css"

/** The `#workspace` element the ProseMirror test page provides. */
export const workspace = (): HTMLElement => {
  let space = document.querySelector("#workspace") as HTMLElement | null
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
  const tag = (doc as any).tag, a = tag.a
  if (a != null) {
    const $a = doc.resolveUnsafe(a)
    if ($a.parent.inlineContent) return new TextSelection($a, tag.b != null ? doc.resolveUnsafe(tag.b) : undefined)
    else return new NodeSelection($a)
  }
  return Selection.atStart(doc)
}

let tempView: EditorView<any> | null = null

export type TempEditorProps =
  & Partial<Omit<DirectEditorProps<any>, "plugins">>
  & { readonly plugins?: ReadonlyArray<Plugin<any, any, any, never>>; readonly doc?: PMNode<any> }

export function tempEditor(inProps: TempEditorProps = {}): EditorView<any> {
  const space = workspace()
  if (tempView) {
    tempView.destroy()
    tempView = null
  }

  const props: any = {}
  for (const n in inProps) if (n != "plugins") props[n] = (inProps as any)[n]
  props.state = EditorState.createUnsafe({
    doc: inProps.doc,
    schema,
    selection: inProps.doc && selFor(inProps.doc),
    plugins: inProps && inProps.plugins
  })
  return tempView = EditorView.makeUnsafe(space, props as DirectEditorProps<any>)
}

export function findTextNode(node: Node, text: string): Text | undefined {
  if (node.nodeType == 3) {
    if (node.nodeValue == text) return node as Text
  } else if (node.nodeType == 1) {
    for (let ch = node.firstChild; ch; ch = ch.nextSibling) {
      const found = findTextNode(ch, text)
      if (found) return found
    }
  }
  return undefined
}

export function requireFocus<V extends EditorView<any, any, any>>(pm: V): V {
  // The tests run in an iframe, which has to be focused explicitly.
  if (!document.hasFocus()) window.focus()
  if (!document.hasFocus()) {
    throw new Error("The document doesn't have focus, which is needed for this test")
  }
  pm.focus()
  return pm
}

export function flush(view: EditorView<any, any, any>): void {
  ;(view as any).domObserver.flush()
}
