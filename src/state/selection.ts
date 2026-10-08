/**
 * Editor selections.
 *
 * @since 0.1.0
 */
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as S from "effect/Schema"
import * as SchemaGetter from "effect/SchemaGetter"
import * as SchemaIssue from "effect/SchemaIssue"
import { attempt } from "../internal/attempt.ts"
import {
  type AnySchema,
  Fragment,
  isModelError,
  JSONError,
  type ModelError,
  type Node,
  type PositionError,
  type ResolvedPos,
  Slice
} from "../model.ts"
import { type Mappable, ReplaceAroundStep, ReplaceStep } from "../transform.ts"
import { isStateFailure, SelectionError } from "./errors.ts"
import type { Transaction } from "./transaction.ts"

const isPositionOrSelectionError = (u: unknown): u is PositionError | SelectionError =>
  isModelError(u) || u instanceof SelectionError

/**
 * The JSON representation of a selection. It always includes the
 * selection class's JSON id (see `Selection.jsonID`) under `type`.
 *
 * @since 0.1.0
 * @category models
 */
export interface SelectionJSON {
  readonly type: string
  readonly [key: string]: unknown
}

/**
 * Something that can deserialize selections of a given type: usually
 * the selection class itself, via a static `fromJSONUnsafe` method that
 * throws a tagged error for invalid input.
 *
 * @since 0.1.0
 * @category models
 */
export interface SelectionDeserializer {
  readonly fromJSONUnsafe: (doc: Node<any>, json: any) => Selection<any>
}

const classesById: Record<string, SelectionDeserializer> = Object.create(null)

/**
 * Superclass for editor selections. Every selection type should extend
 * this. Should not be instantiated directly.
 *
 * @since 0.1.0
 * @category models
 */
export abstract class Selection<Sc extends AnySchema = AnySchema> {
  /** The ranges covered by the selection. */
  readonly ranges: ReadonlyArray<SelectionRange<Sc>>

  /**
   * Initialize a selection with the head and anchor and ranges. If no
   * ranges are given, constructs a single range across `$anchor` and
   * `$head`.
   */
  constructor(
    /**
     * The resolved anchor of the selection (the side that stays in
     * place when the selection is modified).
     */
    readonly $anchor: ResolvedPos<Sc>,
    /**
     * The resolved head of the selection (the side that moves when the
     * selection is modified).
     */
    readonly $head: ResolvedPos<Sc>,
    ranges?: ReadonlyArray<SelectionRange<Sc>>
  ) {
    this.ranges = ranges || [new SelectionRange($anchor.min($head), $anchor.max($head))]
  }

  /** The selection's anchor, as an unresolved position. */
  get anchor(): number {
    return this.$anchor.pos
  }

  /** The selection's head. */
  get head(): number {
    return this.$head.pos
  }

  /** The lower bound of the selection's main range. */
  get from(): number {
    return this.$from.pos
  }

  /** The upper bound of the selection's main range. */
  get to(): number {
    return this.$to.pos
  }

  /** The resolved lower bound of the selection's main range. */
  get $from(): ResolvedPos<Sc> {
    return this.ranges[0]!.$from
  }

  /** The resolved upper bound of the selection's main range. */
  get $to(): ResolvedPos<Sc> {
    return this.ranges[0]!.$to
  }

  /** Indicates whether the selection contains any content. */
  get empty(): boolean {
    const ranges = this.ranges
    for (let i = 0; i < ranges.length; i++) {
      if (ranges[i]!.$from.pos !== ranges[i]!.$to.pos) return false
    }
    return true
  }

  /**
   * Controls whether, when a selection of this type is active in the
   * browser, the selected range should be visible to the user.
   * Defaults to `true`.
   */
  get visible(): boolean {
    return true
  }

  /** Test whether the selection is the same as another selection. */
  abstract eq(selection: Selection<any>): boolean

  /**
   * Map this selection through a mappable thing. `doc` should be the
   * new document to which we are mapping.
   */
  abstract map(doc: Node<Sc>, mapping: Mappable): Selection<Sc>

  /** Get the content of this selection as a slice. */
  content(): Slice<Sc> {
    return this.$from.doc.sliceUnsafe(this.from, this.to, true)
  }

  /**
   * Replace the selection with a slice or, if no slice is given, delete
   * the selection. Will append to the given transaction.
   */
  replace(tr: Transaction<Sc>, content: Slice<Sc> = Slice.empty): void {
    // Put the new selection at the position after the inserted
    // content. When that ended in an inline node, search backwards,
    // to get the position after that node. If not, search forward.
    let lastNode: Node<Sc> | undefined = content.content.content[content.content.childCount - 1]
    let lastParent: Node<Sc> | null = null
    for (let i = 0; i < content.openEnd; i++) {
      lastParent = lastNode!
      lastNode = lastNode!.content.content[lastNode!.childCount - 1]
    }

    const mapFrom = tr.steps.length, ranges = this.ranges
    for (let i = 0; i < ranges.length; i++) {
      const { $from, $to } = ranges[i]!, mapping = tr.mapping.slice(mapFrom)
      tr.replaceRangeUnsafe(mapping.map($from.pos), mapping.map($to.pos), i ? Slice.empty : content)
      if (i === 0) {
        selectionToInsertionEnd(
          tr,
          mapFrom,
          (lastNode ? lastNode.isInline : lastParent && lastParent.isTextblock) ? -1 : 1
        )
      }
    }
  }

  /** Replace the selection with the given node, appending the changes to the given transaction. */
  replaceWith(tr: Transaction<Sc>, node: Node<Sc>): void {
    const mapFrom = tr.steps.length, ranges = this.ranges
    for (let i = 0; i < ranges.length; i++) {
      const { $from, $to } = ranges[i]!, mapping = tr.mapping.slice(mapFrom)
      const from = mapping.map($from.pos), to = mapping.map($to.pos)
      if (i) {
        tr.deleteRangeUnsafe(from, to)
      } else {
        tr.replaceRangeWithUnsafe(from, to, node)
        selectionToInsertionEnd(tr, mapFrom, node.isInline ? -1 : 1)
      }
    }
  }

  /**
   * Convert the selection to a JSON representation. When implementing
   * this for a custom selection class, make sure to give the object a
   * `type` property whose value matches the ID under which you
   * registered your class.
   */
  abstract toJSON(): SelectionJSON

  /**
   * Find a valid cursor or leaf node selection starting at the given
   * position and searching back if `dir` is negative, and forward if
   * positive. When `textOnly` is true, only consider cursor selections.
   * Will return `None` when no valid selection position is found.
   */
  static findFrom<Sc extends AnySchema>(
    $pos: ResolvedPos<Sc>,
    dir: number,
    textOnly = false
  ): Option.Option<Selection<Sc>> {
    return Option.fromNullishOr(Selection.findFromOrNull($pos, dir, textOnly))
  }

  /** @internal */
  static findFromOrNull<Sc extends AnySchema>(
    $pos: ResolvedPos<Sc>,
    dir: number,
    textOnly = false
  ): Selection<Sc> | null {
    const inner = $pos.parent.inlineContent
      ? new TextSelection($pos)
      : findSelectionIn($pos.node(0), $pos.parent, $pos.pos, $pos.index(), dir, textOnly)
    if (inner) return inner

    for (let depth = $pos.depth - 1; depth >= 0; depth--) {
      const found = dir < 0
        ? findSelectionIn(
          $pos.node(0),
          $pos.node(depth),
          $pos.beforeUnsafe(depth + 1),
          $pos.index(depth),
          dir,
          textOnly
        )
        : findSelectionIn(
          $pos.node(0),
          $pos.node(depth),
          $pos.afterUnsafe(depth + 1),
          $pos.index(depth) + 1,
          dir,
          textOnly
        )
      if (found) return found
    }
    return null
  }

  /**
   * Find a valid cursor or leaf node selection near the given position.
   * Searches forward first by default, but if `bias` is negative, it
   * will search backwards first.
   */
  static near<Sc extends AnySchema>($pos: ResolvedPos<Sc>, bias = 1): Selection<Sc> {
    return this.findFromOrNull($pos, bias) || this.findFromOrNull($pos, -bias) || new AllSelection($pos.node(0))
  }

  /**
   * Find the cursor or leaf node selection closest to the start of the
   * given document. Will return an `AllSelection` if no valid position
   * exists.
   */
  static atStart<Sc extends AnySchema>(doc: Node<Sc>): Selection<Sc> {
    return findSelectionIn(doc, doc, 0, 0, 1) || new AllSelection(doc)
  }

  /** Find the cursor or leaf node selection closest to the end of the given document. */
  static atEnd<Sc extends AnySchema>(doc: Node<Sc>): Selection<Sc> {
    return findSelectionIn(doc, doc, doc.content.size, doc.childCount, -1) || new AllSelection(doc)
  }

  /**
   * Deserialize the JSON representation of a selection. Dispatches to
   * the selection class registered (with `jsonID`) for the JSON's
   * `type`.
   */
  static fromJSON<Sc extends AnySchema>(
    doc: Node<Sc>,
    json: unknown
  ): Effect.Effect<Selection<Sc>, ModelError | SelectionError> {
    return attempt(
      () => Selection.fromJSONUnsafe(doc, json),
      (u): u is ModelError | SelectionError => isModelError(u) || isStateFailure(u)
    )
  }

  /** Like `fromJSON`, but throws on invalid input. */
  static fromJSONUnsafe<Sc extends AnySchema>(doc: Node<Sc>, json: any): Selection<Sc> {
    if (!json || typeof json !== "object" || !json.type) {
      throw new JSONError({ message: "Invalid input for Selection.fromJSON" })
    }
    const cls = classesById[json.type]
    if (!cls) throw new JSONError({ message: `No selection type ${json.type} defined` })
    return cls.fromJSONUnsafe(doc, json)
  }

  /**
   * To be able to deserialize selections from JSON, custom selection
   * classes must register themselves with an ID string, so that they
   * can be disambiguated. Try to pick something that's unlikely to
   * clash with classes from other modules. Throws a `SelectionError`
   * when the ID is already in use.
   */
  static jsonID<C extends SelectionDeserializer>(id: string, selectionClass: C): C {
    if (id in classesById) throw new SelectionError({ message: "Duplicate use of selection JSON ID " + id })
    classesById[id] = selectionClass
    const proto = (selectionClass as unknown as { prototype?: object }).prototype
    if (proto) (proto as { jsonID?: string }).jsonID = id
    return selectionClass
  }

  /**
   * Get a bookmark for this selection, which is a value that can be
   * mapped without having access to a current document, and later
   * resolved to a real selection for a given document again. (This is
   * used mostly by the history to track and restore old selections.)
   * The default implementation of this method just converts the
   * selection to a text selection and returns the bookmark for that.
   */
  getBookmark(): SelectionBookmark<Sc> {
    return TextSelection.between(this.$anchor, this.$head).getBookmark()
  }
}

/**
 * A lightweight, document-independent representation of a selection.
 * You can define a custom bookmark type for a custom selection class to
 * make the history handle it well.
 *
 * @since 0.1.0
 * @category models
 */
export interface SelectionBookmark<Sc extends AnySchema = AnySchema> {
  /** Map the bookmark through a set of changes. */
  readonly map: (mapping: Mappable) => SelectionBookmark<Sc>

  /**
   * Resolve the bookmark to a real selection again. This may need to do
   * some error checking and may fall back to a default (usually
   * `TextSelection.between`) if mapping made the bookmark invalid.
   */
  readonly resolve: (doc: Node<Sc>) => Selection<Sc>
}

/**
 * Represents a selected range in a document.
 *
 * @since 0.1.0
 * @category models
 */
export class SelectionRange<Sc extends AnySchema = AnySchema> {
  /** Create a range. */
  constructor(
    /** The lower bound of the range. */
    readonly $from: ResolvedPos<Sc>,
    /** The upper bound of the range. */
    readonly $to: ResolvedPos<Sc>
  ) {}
}

let warnedAboutTextSelection = false
function checkTextSelection($pos: ResolvedPos<any>) {
  if (!warnedAboutTextSelection && !$pos.parent.inlineContent) {
    warnedAboutTextSelection = true
    // oxlint-disable-next-line no-console
    console["warn"](
      "TextSelection endpoint not pointing into a node with inline content (" + $pos.parent.type.name + ")"
    )
  }
}

/**
 * A text selection represents a classical editor selection, with a head
 * (the moving side) and anchor (immobile side), both of which point into
 * textblock nodes. It can be empty (a regular cursor position).
 *
 * @since 0.1.0
 * @category models
 */
export class TextSelection<Sc extends AnySchema = AnySchema> extends Selection<Sc> {
  /** Construct a text selection between the given points. */
  constructor($anchor: ResolvedPos<Sc>, $head: ResolvedPos<Sc> = $anchor) {
    checkTextSelection($anchor)
    checkTextSelection($head)
    super($anchor, $head)
  }

  /** Returns a resolved position if this is a cursor selection (an empty text selection). */
  get $cursor(): Option.Option<ResolvedPos<Sc>> {
    return Option.fromNullishOr(this.$cursorOrNull)
  }

  /** @internal */
  get $cursorOrNull(): ResolvedPos<Sc> | null {
    return this.$anchor.pos === this.$head.pos ? this.$head : null
  }

  map(doc: Node<Sc>, mapping: Mappable): Selection<Sc> {
    const $head = doc.resolveUnsafe(mapping.map(this.head))
    if (!$head.parent.inlineContent) return Selection.near($head)
    const $anchor = doc.resolveUnsafe(mapping.map(this.anchor))
    return new TextSelection($anchor.parent.inlineContent ? $anchor : $head, $head)
  }

  override replace(tr: Transaction<Sc>, content: Slice<Sc> = Slice.empty): void {
    super.replace(tr, content)
    if (content === Slice.empty) {
      const marks = this.$from.marksAcrossOrNull(this.$to)
      if (marks) tr.ensureMarks(marks)
    }
  }

  eq(other: Selection<any>): boolean {
    return other instanceof TextSelection && other.anchor === this.anchor && other.head === this.head
  }

  override getBookmark(): SelectionBookmark<Sc> {
    return new TextBookmark(this.anchor, this.head)
  }

  toJSON(): SelectionJSON {
    return { type: "text", anchor: this.anchor, head: this.head }
  }

  /** @internal */
  static override fromJSONUnsafe<Sc extends AnySchema>(doc: Node<Sc>, json: any): TextSelection<Sc> {
    if (typeof json.anchor !== "number" || typeof json.head !== "number") {
      throw new JSONError({ message: "Invalid input for TextSelection.fromJSON" })
    }
    return new TextSelection(doc.resolveUnsafe(json.anchor), doc.resolveUnsafe(json.head))
  }

  /** Create a text selection from non-resolved positions. */
  static create<Sc extends AnySchema>(
    doc: Node<Sc>,
    anchor: number,
    head = anchor
  ): Effect.Effect<TextSelection<Sc>, PositionError> {
    return attempt(() => TextSelection.createUnsafe(doc, anchor, head), isModelError as any)
  }

  /** Like `create`, but throws a `PositionError` for positions outside of the document. */
  static createUnsafe<Sc extends AnySchema>(doc: Node<Sc>, anchor: number, head = anchor): TextSelection<Sc> {
    const $anchor = doc.resolveUnsafe(anchor)
    return new TextSelection($anchor, head === anchor ? $anchor : doc.resolveUnsafe(head))
  }

  /**
   * Return a text selection that spans the given positions or, if they
   * aren't text positions, find a text selection near them. `bias`
   * determines whether the method searches forward (default) or
   * backwards (negative number) first. Will fall back to calling
   * `Selection.near` when the document doesn't contain a valid text
   * position.
   */
  static between<Sc extends AnySchema>(
    $anchor: ResolvedPos<Sc>,
    $head: ResolvedPos<Sc>,
    bias?: number
  ): Selection<Sc> {
    const dPos = $anchor.pos - $head.pos
    if (!bias || dPos) bias = dPos >= 0 ? 1 : -1
    if (!$head.parent.inlineContent) {
      const found = Selection.findFromOrNull($head, bias, true) || Selection.findFromOrNull($head, -bias, true)
      if (found) $head = found.$head
      else return Selection.near($head, bias)
    }
    if (!$anchor.parent.inlineContent) {
      if (dPos === 0) {
        $anchor = $head
      } else {
        $anchor = (Selection.findFromOrNull($anchor, -bias, true) || Selection.findFromOrNull($anchor, bias, true))!
          .$anchor
        if (($anchor.pos < $head.pos) !== (dPos < 0)) $anchor = $head
      }
    }
    return new TextSelection($anchor, $head)
  }
}

Selection.jsonID("text", TextSelection)

class TextBookmark<Sc extends AnySchema> implements SelectionBookmark<Sc> {
  constructor(readonly anchor: number, readonly head: number) {}

  map(mapping: Mappable): SelectionBookmark<Sc> {
    return new TextBookmark(mapping.map(this.anchor), mapping.map(this.head))
  }

  resolve(doc: Node<Sc>): Selection<Sc> {
    return TextSelection.between(doc.resolveUnsafe(this.anchor), doc.resolveUnsafe(this.head))
  }
}

/**
 * A node selection is a selection that points at a single node. All
 * nodes marked selectable can be the target of a node selection. In
 * such a selection, `from` and `to` point directly before and after the
 * selected node, `anchor` equals `from`, and `head` equals `to`.
 *
 * @since 0.1.0
 * @category models
 */
export class NodeSelection<Sc extends AnySchema = AnySchema> extends Selection<Sc> {
  /** The selected node. */
  readonly node: Node<Sc>

  /**
   * Create a node selection. Does not verify the validity of its
   * argument beyond requiring a node after `$pos` (throwing a
   * `SelectionError` otherwise).
   */
  constructor($pos: ResolvedPos<Sc>) {
    const node = $pos.nodeAfterOrNull
    if (!node) throw new SelectionError({ message: "No node after position " + $pos.pos + " for NodeSelection" })
    const $end = $pos.node(0).resolveUnsafe($pos.pos + node.nodeSize)
    super($pos, $end)
    this.node = node
  }

  override get visible(): boolean {
    return false
  }

  map(doc: Node<Sc>, mapping: Mappable): Selection<Sc> {
    const { deleted, pos } = mapping.mapResult(this.anchor)
    const $pos = doc.resolveUnsafe(pos)
    if (deleted) return Selection.near($pos)
    return new NodeSelection($pos)
  }

  override content(): Slice<Sc> {
    return new Slice(Fragment.from(this.node), 0, 0)
  }

  eq(other: Selection<any>): boolean {
    return other instanceof NodeSelection && other.anchor === this.anchor
  }

  toJSON(): SelectionJSON {
    return { type: "node", anchor: this.anchor }
  }

  override getBookmark(): SelectionBookmark<Sc> {
    return new NodeBookmark(this.anchor)
  }

  /** @internal */
  static override fromJSONUnsafe<Sc extends AnySchema>(doc: Node<Sc>, json: any): NodeSelection<Sc> {
    if (typeof json.anchor !== "number") throw new JSONError({ message: "Invalid input for NodeSelection.fromJSON" })
    return new NodeSelection(doc.resolveUnsafe(json.anchor))
  }

  /** Create a node selection from a non-resolved position. */
  static create<Sc extends AnySchema>(
    doc: Node<Sc>,
    from: number
  ): Effect.Effect<NodeSelection<Sc>, PositionError | SelectionError> {
    return attempt(() => NodeSelection.createUnsafe(doc, from), isPositionOrSelectionError)
  }

  /** Like `create`, but throws for invalid positions. */
  static createUnsafe<Sc extends AnySchema>(doc: Node<Sc>, from: number): NodeSelection<Sc> {
    return new NodeSelection(doc.resolveUnsafe(from))
  }

  /** Determines whether the given node may be selected as a node selection. */
  static isSelectable(node: Node<any>): boolean {
    return !node.isText && node.type.spec.selectable !== false
  }
}

Selection.jsonID("node", NodeSelection)

class NodeBookmark<Sc extends AnySchema> implements SelectionBookmark<Sc> {
  constructor(readonly anchor: number) {}

  map(mapping: Mappable): SelectionBookmark<Sc> {
    const { deleted, pos } = mapping.mapResult(this.anchor)
    return deleted ? new TextBookmark(pos, pos) : new NodeBookmark(pos)
  }

  resolve(doc: Node<Sc>): Selection<Sc> {
    const $pos = doc.resolveUnsafe(this.anchor), node = $pos.nodeAfterOrNull
    if (node && NodeSelection.isSelectable(node)) return new NodeSelection($pos)
    return Selection.near($pos)
  }
}

/**
 * A selection type that represents selecting the whole document (which
 * can not necessarily be expressed with a text selection, when there
 * are for example leaf block nodes at the start or end of the
 * document).
 *
 * @since 0.1.0
 * @category models
 */
export class AllSelection<Sc extends AnySchema = AnySchema> extends Selection<Sc> {
  /** Create an all-selection over the given document. */
  constructor(doc: Node<Sc>) {
    super(doc.resolveUnsafe(0), doc.resolveUnsafe(doc.content.size))
  }

  override replace(tr: Transaction<Sc>, content: Slice<Sc> = Slice.empty): void {
    if (content === Slice.empty) {
      tr.deleteUnsafe(0, tr.doc.content.size)
      const sel = Selection.atStart(tr.doc)
      if (!sel.eq(tr.selection)) tr.setSelectionUnsafe(sel)
    } else {
      super.replace(tr, content)
    }
  }

  toJSON(): SelectionJSON {
    return { type: "all" }
  }

  /** @internal */
  static override fromJSONUnsafe<Sc extends AnySchema>(doc: Node<Sc>): AllSelection<Sc> {
    return new AllSelection(doc)
  }

  map(doc: Node<Sc>): Selection<Sc> {
    return new AllSelection(doc)
  }

  eq(other: Selection<any>): boolean {
    return other instanceof AllSelection
  }

  override getBookmark(): SelectionBookmark<Sc> {
    return AllBookmark as SelectionBookmark<Sc>
  }
}

Selection.jsonID("all", AllSelection)

const AllBookmark: SelectionBookmark<any> = {
  map() {
    return this
  },
  resolve(doc: Node<any>) {
    return new AllSelection(doc)
  }
}

// FIXME we'll need some awareness of text direction when scanning for selections

// Try to find a selection inside the given node. `pos` points at the
// position where the search starts. When `text` is true, only return
// text selections.
function findSelectionIn<Sc extends AnySchema>(
  doc: Node<Sc>,
  node: Node<Sc>,
  pos: number,
  index: number,
  dir: number,
  text = false
): Selection<Sc> | null {
  if (node.inlineContent) return TextSelection.createUnsafe(doc, pos)
  for (let i = index - (dir > 0 ? 0 : 1); dir > 0 ? i < node.childCount : i >= 0; i += dir) {
    const child = node.content.content[i]!
    if (!child.isAtom) {
      const inner = findSelectionIn(doc, child, pos + dir, dir < 0 ? child.childCount : 0, dir, text)
      if (inner) return inner
    } else if (!text && NodeSelection.isSelectable(child)) {
      return NodeSelection.createUnsafe(doc, pos - (dir < 0 ? child.nodeSize : 0))
    }
    pos += child.nodeSize * dir
  }
  return null
}

function selectionToInsertionEnd(tr: Transaction<any>, startLen: number, bias: number) {
  const last = tr.steps.length - 1
  if (last < startLen) return
  const step = tr.steps[last]
  if (!(step instanceof ReplaceStep || step instanceof ReplaceAroundStep)) return
  const map = tr.mapping.maps[last]!
  let end: number | undefined
  map.forEach((_from, _to, _newFrom, newTo) => {
    if (end == null) end = newTo
  })
  tr.setSelectionUnsafe(Selection.near(tr.doc.resolveUnsafe(end!), bias))
}

const SelectionJSONSchema = S.declare(
  (u: unknown): u is SelectionJSON =>
    typeof u === "object" && u !== null && typeof (u as { type?: unknown }).type === "string",
  { title: "SelectionJSON" }
)

/**
 * An Effect `Schema` that decodes the JSON representation of a
 * selection (using the `Selection.jsonID` registry) into a selection in
 * the given document, and encodes selections back to JSON.
 *
 * @since 0.1.0
 * @category schemas
 */
export const SelectionFromJSON = <Sc extends AnySchema>(doc: Node<Sc>): S.Codec<Selection<Sc>, SelectionJSON> => {
  const target = S.declare(
    (u: unknown): u is Selection<Sc> => u instanceof Selection && u.$anchor.doc === doc,
    { title: "Selection" }
  )
  return SelectionJSONSchema.pipe(
    S.decodeTo(target, {
      decode: SchemaGetter.transformEffect((json: SelectionJSON) =>
        Effect.suspend(() => {
          try {
            return Effect.succeed(Selection.fromJSONUnsafe(doc, json))
          } catch (e) {
            return Effect.fail(
              new SchemaIssue.InvalidValue({ message: e instanceof Error ? e.message : String(e) }, json)
            )
          }
        })
      ),
      encode: SchemaGetter.transform((selection: Selection<Sc>) => selection.toJSON())
    })
  ) as any
}
