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
import { keydownHandler } from "./Keymap.ts"
import { type AnySchema, Fragment, JSONError, type Node, type NodeType, type ResolvedPos, Slice } from "./Model.ts"
import {
  type Command,
  type EditorState,
  NodeSelection,
  Plugin,
  Selection,
  type SelectionBookmark,
  type SelectionJSON,
  TextSelection
} from "./State.ts"
import type { Mappable } from "./Transform.ts"
import { Decoration, DecorationSet, type EditorView } from "./View.ts"

const child = (node: Node<any>, index: number): Node<any> => node.content.content[index]

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
    return Option.exists(parent.contentMatchAtUnsafe($pos.index()).defaultType, (deflt) => deflt.isTextblock)
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
    // Skips any number of unselectable atoms, restarting from each, so these stay plain loops.
    // oxlint-disable-next-line effect/imperative-loops
    search: for (;;) {
      if (!mustMove && GapCursor.valid($pos)) return Option.some($pos)
      let pos = $pos.pos,
        next: Node<any>
      // Scan up from this position
      // oxlint-disable-next-line effect/imperative-loops
      for (let d = $pos.depth; ; d--) {
        const parent = $pos.node(d)
        if (dir > 0 ? $pos.indexAfter(d) < parent.childCount : $pos.index(d) > 0) {
          next = child(parent, dir > 0 ? $pos.indexAfter(d) : $pos.index(d) - 1)
          break
        } else if (d === 0) {
          return Option.none()
        }
        pos += dir
        const $cur = $pos.doc.resolveUnsafe(pos)
        if (GapCursor.valid($cur)) return Option.some($cur)
      }

      // And then down into the next node
      // oxlint-disable-next-line effect/imperative-loops
      for (;;) {
        const inside = dir > 0 ? next.firstChild : next.lastChild
        if (Option.isNone(inside)) {
          if (next.isAtom && !next.isText && !NodeSelection.isSelectable(next)) {
            $pos = $pos.doc.resolveUnsafe(pos + next.nodeSize * dir)
            mustMove = false
            continue search
          }
          break
        }
        next = inside.value
        pos += dir
        const $cur = $pos.doc.resolveUnsafe(pos)
        if (GapCursor.valid($cur)) return Option.some($cur)
      }

      return Option.none()
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

function closedBefore($pos: ResolvedPos<any>, d = $pos.depth): boolean {
  // Hit start of document
  if (d < 0) return true
  const index = $pos.index(d),
    parent = $pos.node(d)
  // At the start of this parent, look at next one
  if (index === 0) return !!parent.type.spec.isolating || closedBefore($pos, d - 1)
  // See if the node before (or its first ancestor) is closed
  return closedAlong(child(parent, index - 1), (node) => child(node, node.childCount - 1))
}

function closedAfter($pos: ResolvedPos<any>, d = $pos.depth): boolean {
  if (d < 0) return true
  const index = $pos.indexAfter(d),
    parent = $pos.node(d)
  if (index === parent.childCount) return !!parent.type.spec.isolating || closedAfter($pos, d - 1)
  return closedAlong(child(parent, index), (node) => child(node, 0))
}

// Whether `node`, or the descendant reached by following `next` until one decides, is closed.
function closedAlong(node: Node<any>, next: (node: Node<any>) => Node<any>): boolean {
  if ((node.childCount === 0 && !node.inlineContent) || needsGap(node.type)) return true
  return !node.inlineContent && closedAlong(next(node), next)
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
        return $anchor.pos === $head.pos && GapCursor.valid($head)
          ? Option.some<Selection<any>>(new GapCursor($head))
          : Option.none()
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
      const $found = GapCursor.findGapCursorFrom($start, dir, mustMove)
      if (Option.isNone($found)) return Effect.succeed(false)
      if (!dispatch) return Effect.succeed(true)
      return Effect.as(dispatch(state.tr.setSelectionUnsafe(new GapCursor($found.value))), true)
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
  const clickPos = view.posAtCoords({ left: event.clientX, top: event.clientY })
  if (
    Option.exists(
      Option.flatMap(
        Option.filter(clickPos, (p) => p.inside > -1),
        (p) => view.state.doc.nodeAt(p.inside)
      ),
      (node) => NodeSelection.isSelectable(node)
    )
  ) {
    return false
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
  const insert = $from.parent.contentMatchAtUnsafe($from.index()).findWrapping(view.state.schema.nodes.text)
  if (Option.isNone(insert)) return false

  const frag = insert.value.reduceRight(
    (inner: Fragment<any>, type) => Fragment.from(Option.getOrUndefined(type.createAndFillOption(undefined, inner))),
    Fragment.empty
  )
  const tr = view.state.tr.replaceUnsafe($from.pos, $from.pos, new Slice(frag, 0, 0))
  tr.setSelectionUnsafe(TextSelection.near(tr.doc.resolveUnsafe($from.pos + 1)))
  // Dispatch (synchronously, when possible), but let the event through.
  return Effect.as(view.dispatch(tr), false)
}

function drawGapCursor(state: EditorState<any>): DecorationSet {
  if (!(state.selection instanceof GapCursor)) return DecorationSet.empty
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
 * `injectCSS` from `@thomasfosterau/effect-richtext/ViewCss`) or provide your own
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
