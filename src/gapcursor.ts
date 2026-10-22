/**
 * Gap cursors: a selection type (and plugin) for focusing places that
 * don't allow regular selection, such as positions between two
 * adjacent block nodes that aren't textblocks. Ported from
 * `prosemirror-gapcursor`.
 *
 * Importing this module registers the `GapCursor` selection class for
 * JSON deserialization (under the ID `"gapcursor"`).
 *
 * @since 0.1.0
 */
// Ported from prosemirror-gapcursor (MIT, Marijn Haverbeke and others)
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import { keydownHandler } from "./keymap.ts"
import { type AnySchema, Fragment, JSONError, type Node, type NodeType, type ResolvedPos, Slice } from "./model.ts"
import {
  type Command,
  type EditorState,
  NodeSelection,
  Plugin,
  Selection,
  type SelectionBookmark,
  type SelectionJSON,
  TextSelection
} from "./state.ts"
import type { Mappable } from "./transform.ts"
import { Decoration, DecorationSet, type EditorView } from "./view.ts"

const child = (node: Node<any>, index: number): Node<any> => node.content.content[index]!

/**
 * Gap cursor selections are represented using this class. Its `$anchor`
 * and `$head` properties both point at the cursor position.
 *
 * Node specs may set `allowGapCursor` to explicitly allow or disallow
 * gap cursors inside nodes of that type, and `createGapCursor` to make
 * the positions around nodes of that type valid gap cursor positions.
 *
 * @since 0.1.0
 * @category models
 */
export class GapCursor<Sc extends AnySchema = AnySchema> extends Selection<Sc> {
  /** Create a gap cursor. */
  constructor($pos: ResolvedPos<Sc>) {
    super($pos, $pos)
  }

  override get visible(): boolean {
    return false
  }

  map(doc: Node<Sc>, mapping: Mappable): Selection<Sc> {
    const $pos = doc.resolveUnsafe(mapping.map(this.head))
    return GapCursor.valid($pos) ? new GapCursor($pos) : Selection.near($pos)
  }

  override content(): Slice<Sc> {
    return Slice.empty
  }

  eq(other: Selection<any>): boolean {
    return other instanceof GapCursor && other.head === this.head
  }

  toJSON(): SelectionJSON {
    return { type: "gapcursor", pos: this.head }
  }

  /** @internal */
  static override fromJSONUnsafe<Sc extends AnySchema>(doc: Node<Sc>, json: any): GapCursor<Sc> {
    if (!Predicate.isNumber(json.pos)) throw new JSONError({ message: "Invalid input for GapCursor.fromJSON" })
    return new GapCursor(doc.resolveUnsafe(json.pos))
  }

  override getBookmark(): SelectionBookmark<Sc> {
    return new GapBookmark(this.anchor)
  }

  /** Whether a gap cursor is valid at the given position. */
  static valid($pos: ResolvedPos<any>): boolean {
    const parent = $pos.parent
    if (parent.inlineContent || !closedBefore($pos) || !closedAfter($pos)) return false
    const override = parent.type.spec.allowGapCursor
    if (override != null) return !!override
    const deflt = parent.contentMatchAtUnsafe($pos.index()).defaultTypeOrNull
    return !!deflt && deflt.isTextblock
  }

  /**
   * Find a valid gap cursor position starting at `$pos` and searching in
   * direction `dir` (negative is backwards). When `mustMove` is true,
   * `$pos` itself is not considered.
   */
  static findGapCursorFrom<Sc extends AnySchema>(
    $pos: ResolvedPos<Sc>,
    dir: number,
    mustMove = false
  ): Option.Option<ResolvedPos<Sc>> {
    return Option.fromNullishOr(GapCursor.findGapCursorFromOrNull($pos, dir, mustMove))
  }

  /** @internal */
  static findGapCursorFromOrNull<Sc extends AnySchema>(
    $pos: ResolvedPos<Sc>,
    dir: number,
    mustMove = false
  ): ResolvedPos<Sc> | null {
    search: for (;;) {
      if (!mustMove && GapCursor.valid($pos)) return $pos
      let pos = $pos.pos,
        next: Node<any> | null = null
      // Scan up from this position
      for (let d = $pos.depth; ; d--) {
        const parent = $pos.node(d)
        if (dir > 0 ? $pos.indexAfter(d) < parent.childCount : $pos.index(d) > 0) {
          next = child(parent, dir > 0 ? $pos.indexAfter(d) : $pos.index(d) - 1)
          break
        } else if (d === 0) {
          return null
        }
        pos += dir
        const $cur = $pos.doc.resolveUnsafe(pos)
        if (GapCursor.valid($cur)) return $cur
      }

      // And then down into the next node
      for (;;) {
        const inside: Node<any> | undefined =
          dir > 0 ? next.content.content[0] : next.content.content[next.childCount - 1]
        if (!inside) {
          if (next.isAtom && !next.isText && !NodeSelection.isSelectable(next)) {
            $pos = $pos.doc.resolveUnsafe(pos + next.nodeSize * dir)
            mustMove = false
            continue search
          }
          break
        }
        next = inside
        pos += dir
        const $cur = $pos.doc.resolveUnsafe(pos)
        if (GapCursor.valid($cur)) return $cur
      }

      return null
    }
  }
}

Selection.jsonID("gapcursor", GapCursor)

class GapBookmark<Sc extends AnySchema> implements SelectionBookmark<Sc> {
  constructor(readonly pos: number) {}

  map(mapping: Mappable): GapBookmark<Sc> {
    return new GapBookmark(mapping.map(this.pos))
  }

  resolve(doc: Node<Sc>): Selection<Sc> {
    const $pos = doc.resolveUnsafe(this.pos)
    return GapCursor.valid($pos) ? new GapCursor($pos) : Selection.near($pos)
  }
}

function needsGap(type: NodeType<any, any>): boolean {
  return type.isAtom || !!type.spec.isolating || !!type.spec.createGapCursor
}

function closedBefore($pos: ResolvedPos<any>): boolean {
  for (let d = $pos.depth; d >= 0; d--) {
    const index = $pos.index(d),
      parent = $pos.node(d)
    // At the start of this parent, look at next one
    if (index === 0) {
      if (parent.type.spec.isolating) return true
      continue
    }
    // See if the node before (or its first ancestor) is closed
    for (let before = child(parent, index - 1); ; before = child(before, before.childCount - 1)) {
      if ((before.childCount === 0 && !before.inlineContent) || needsGap(before.type)) return true
      if (before.inlineContent) return false
    }
  }
  // Hit start of document
  return true
}

function closedAfter($pos: ResolvedPos<any>): boolean {
  for (let d = $pos.depth; d >= 0; d--) {
    const index = $pos.indexAfter(d),
      parent = $pos.node(d)
    if (index === parent.childCount) {
      if (parent.type.spec.isolating) return true
      continue
    }
    for (let after = child(parent, index); ; after = child(after, 0)) {
      if ((after.childCount === 0 && !after.inlineContent) || needsGap(after.type)) return true
      if (after.inlineContent) return false
    }
  }
  return true
}

/**
 * Create a gap cursor plugin. When enabled, this will capture clicks
 * near and arrow-key-motion past places that don't have a normally
 * selectable position nearby, and create a gap cursor selection for
 * them. The cursor is drawn as an element with class
 * `ProseMirror-gapcursor`. You can either include `gapCursorCSS` or add
 * your own styles to make it visible.
 *
 * @since 0.1.0
 * @category constructors
 */
export const gapCursor = (): Plugin<undefined> =>
  new Plugin<undefined>({
    props: {
      decorations: drawGapCursor,

      createSelectionBetween(_view, $anchor, $head) {
        return $anchor.pos === $head.pos && GapCursor.valid($head) ? new GapCursor($head) : null
      },

      handleClick,
      handleKeyDown,
      handleDOMEvents: { beforeinput }
    }
  })

function arrow(axis: "vert" | "horiz", dir: number): Command {
  const dirStr = axis === "vert" ? (dir > 0 ? "down" : "up") : dir > 0 ? "right" : "left"
  return (state, dispatch, view) =>
    Effect.suspend(() => {
      const sel = state.selection
      let $start = dir > 0 ? sel.$to : sel.$from,
        mustMove = sel.empty
      if (sel instanceof TextSelection) {
        if (!view || !view.endOfTextblock(dirStr) || $start.depth === 0) return Effect.succeed(false)
        mustMove = false
        $start = state.doc.resolveUnsafe(dir > 0 ? $start.afterUnsafe() : $start.beforeUnsafe())
      }
      const $found = GapCursor.findGapCursorFromOrNull($start, dir, mustMove)
      if (!$found) return Effect.succeed(false)
      if (!dispatch) return Effect.succeed(true)
      return Effect.as(dispatch(state.tr.setSelectionUnsafe(new GapCursor($found))), true)
    })
}

const handleKeyDown = keydownHandler({
  ArrowLeft: arrow("horiz", -1),
  ArrowRight: arrow("horiz", 1),
  ArrowUp: arrow("vert", -1),
  ArrowDown: arrow("vert", 1)
})

function handleClick(
  view: EditorView<any, any, any>,
  pos: number,
  event: MouseEvent
): boolean | Effect.Effect<boolean> {
  if (!view || !view.editable) return false
  const $pos = view.state.doc.resolveUnsafe(pos)
  if (!GapCursor.valid($pos)) return false
  const clickPos = Option.getOrNull(view.posAtCoords({ left: event.clientX, top: event.clientY }))
  if (clickPos && clickPos.inside > -1) {
    const node = view.state.doc.nodeAtOrNull(clickPos.inside)
    if (node && NodeSelection.isSelectable(node)) return false
  }
  return Effect.as(view.dispatch(view.state.tr.setSelectionUnsafe(new GapCursor($pos))), true)
}

// This is a hack that, when a composition starts while a gap cursor
// is active, quickly creates an inline context for the composition to
// happen in, to avoid it being aborted by the DOM selection being
// moved into a valid position.
function beforeinput(view: EditorView<any, any, any>, event: InputEvent): boolean | Effect.Effect<boolean> {
  if (event.inputType !== "insertCompositionText" || !(view.state.selection instanceof GapCursor)) return false

  const { $from } = view.state.selection
  const insert = $from.parent.contentMatchAtUnsafe($from.index()).findWrappingOrNull(view.state.schema.nodes.text)
  if (!insert) return false

  let frag: Fragment<any> = Fragment.empty
  for (let i = insert.length - 1; i >= 0; i--) frag = Fragment.from(insert[i]!.createAndFillOrNull(null, frag))
  const tr = view.state.tr.replaceUnsafe($from.pos, $from.pos, new Slice(frag, 0, 0))
  tr.setSelectionUnsafe(TextSelection.near(tr.doc.resolveUnsafe($from.pos + 1)))
  // Dispatch (synchronously, when possible), but let the event through.
  return Effect.as(view.dispatch(tr), false)
}

function drawGapCursor(state: EditorState<any>): DecorationSet | null {
  if (!(state.selection instanceof GapCursor)) return null
  const widget = Decoration.widget(
    state.selection.head,
    (view) => {
      const node = view.dom.ownerDocument.createElement("div")
      node.className = "ProseMirror-gapcursor"
      return node
    },
    { key: "gapcursor" }
  )
  return DecorationSet.create(state.doc, [widget])
}

/**
 * The gap cursor's stylesheet (from `prosemirror-gapcursor`'s
 * `style/gapcursor.css`). Add it to the page (for example with
 * `injectCSS` from `effect-richtext/view-css`) or provide your own
 * styles for `.ProseMirror-gapcursor`.
 *
 * @since 0.1.0
 * @category styles
 */
export const gapCursorCSS: string = `.ProseMirror-gapcursor {
  display: none;
  pointer-events: none;
  position: absolute;
}

.ProseMirror-gapcursor:after {
  content: "";
  display: block;
  position: absolute;
  top: -2px;
  width: 20px;
  border-top: 1px solid black;
  animation: ProseMirror-cursor-blink 1.1s steps(2, start) infinite;
}

@keyframes ProseMirror-cursor-blink {
  to {
    visibility: hidden;
  }
}

.ProseMirror-focused .ProseMirror-gapcursor {
  display: block;
}
`
