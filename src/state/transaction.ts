/**
 * Transactions and commands.
 *
 * @since 0.1.0
 */
import type * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { attempt } from "../internal/attempt.ts"
import { type AnySchema, Mark, type MarkType, type Node, type Slice } from "../model.ts"
import { isTransformOrModelError, type ReplaceFailure, type Step, Transform } from "../transform.ts"
import { SelectionError } from "./errors.ts"
import type { EditorViewLike, Plugin, PluginKey } from "./plugin.ts"
import { Selection } from "./selection.ts"
import type { EditorState } from "./state.ts"

const UPDATED_SEL = 1,
  UPDATED_MARKS = 2,
  UPDATED_SCROLL = 4

/**
 * A function that applies a transaction, as passed to commands.
 *
 * @since 0.1.0
 * @category models
 */
export type Dispatch<Sc extends AnySchema = AnySchema> = (tr: Transaction<Sc>) => Effect.Effect<void>

/**
 * Commands are functions that take a state and an optional transaction
 * dispatch function and...
 *
 *  - determine whether they apply to this state
 *  - if not, succeed with `false`
 *  - if `dispatch` was passed, perform their effect, possibly by passing
 *    a transaction to `dispatch`
 *  - succeed with `true`
 *
 * In some cases, the editor view is passed as a third argument.
 * Commands carry the errors (`E`) and requirements (`R`) of the effects
 * they run.
 *
 * @since 0.1.0
 * @category models
 */
export type Command<Sc extends AnySchema = AnySchema, E = never, R = never> = (
  state: EditorState<Sc, any, any>,
  dispatch?: Dispatch<Sc>,
  view?: EditorViewLike
) => Effect.Effect<boolean, E, R>

/**
 * Keys under which transaction metadata can be stored.
 *
 * @since 0.1.0
 * @category models
 */
export type MetaKey = string | Plugin<any, any, any, any> | PluginKey<any>

/**
 * An editor state transaction, which can be applied to a state to
 * create an updated state. Use `EditorState.tr` to create an instance.
 *
 * Transactions track changes to the document (they are a subclass of
 * `Transform`), but also other state changes, like selection updates and
 * adjustments of the set of stored marks. In addition, you can store
 * metadata properties in a transaction, which are extra pieces of
 * information that client code or plugins can use to describe what a
 * transaction represents, so that they can update their own state
 * accordingly.
 *
 * Like transforms, transactions are mutable builders.
 *
 * @since 0.1.0
 * @category models
 */
export class Transaction<Sc extends AnySchema = AnySchema> extends Transform<Sc> {
  /** The timestamp associated with this transaction, in the same format as `Date.now()`. */
  time: number

  private curSelection: Selection<Sc>
  // The step count for which the current selection is valid.
  private curSelectionFor = 0
  // Bitfield to track which aspects of the state were updated by
  // this transaction.
  private updated = 0
  // Object used to store metadata properties for the transaction.
  private readonly meta: Record<string, unknown> = Object.create(null)

  /** @internal */
  storedMarksOrNull: ReadonlyArray<Mark<Sc>> | null

  /** @internal */
  constructor(state: EditorState<Sc, any, any>) {
    super(state.doc)
    this.time = Date.now()
    this.curSelection = state.selection
    this.storedMarksOrNull = state.storedMarksOrNull
  }

  /** The stored marks set by this transaction, if any. */
  get storedMarks(): Option.Option<ReadonlyArray<Mark<Sc>>> {
    return Option.fromNullishOr(this.storedMarksOrNull)
  }

  /**
   * The transaction's current selection. This defaults to the editor
   * selection mapped through the steps in the transaction, but can be
   * overwritten with `setSelection`.
   */
  get selection(): Selection<Sc> {
    if (this.curSelectionFor < this.steps.length) {
      this.curSelection = this.curSelection.map(this.doc, this.mapping.slice(this.curSelectionFor))
      this.curSelectionFor = this.steps.length
    }
    return this.curSelection
  }

  /**
   * Update the transaction's current selection. Will determine the
   * selection that the editor gets when the transaction is applied.
   * Fails with a `SelectionError` when the selection doesn't point into
   * the transaction's current document.
   */
  setSelection(selection: Selection<Sc>): Effect.Effect<this, SelectionError> {
    return attempt(
      () => this.setSelectionUnsafe(selection),
      (u): u is SelectionError => u instanceof SelectionError
    )
  }

  /** Like `setSelection`, but throws a `SelectionError` on failure. */
  setSelectionUnsafe(selection: Selection<Sc>): this {
    if (selection.$from.doc !== this.doc) {
      throw new SelectionError({ message: "Selection passed to setSelection must point at the current document" })
    }
    this.curSelection = selection
    this.curSelectionFor = this.steps.length
    this.updated = (this.updated | UPDATED_SEL) & ~UPDATED_MARKS
    this.storedMarksOrNull = null
    return this
  }

  /** Whether the selection was explicitly updated by this transaction. */
  get selectionSet(): boolean {
    return (this.updated & UPDATED_SEL) > 0
  }

  /** Set the current stored marks. */
  setStoredMarks(marks: ReadonlyArray<Mark<Sc>> | null): this {
    this.storedMarksOrNull = marks
    this.updated |= UPDATED_MARKS
    return this
  }

  /**
   * Make sure the current stored marks or, if that is null, the marks at
   * the selection, match the given set of marks. Does nothing if this is
   * already the case.
   */
  ensureMarks(marks: ReadonlyArray<Mark<Sc>>): this {
    if (!Mark.sameSet(this.storedMarksOrNull || this.selection.$from.marks(), marks)) this.setStoredMarks(marks)
    return this
  }

  /** Add a mark to the set of stored marks. */
  addStoredMark(mark: Mark<Sc>): this {
    return this.ensureMarks(mark.addToSet(this.storedMarksOrNull || this.selection.$head.marks()))
  }

  /** Remove a mark or mark type from the set of stored marks. */
  removeStoredMark(mark: Mark<Sc> | MarkType<Sc>): this {
    const set = this.storedMarksOrNull || this.selection.$head.marks()
    return this.ensureMarks(mark instanceof Mark ? mark.removeFromSet(set) : mark.removeFromSet(set))
  }

  /** Whether the stored marks were explicitly set for this transaction. */
  get storedMarksSet(): boolean {
    return (this.updated & UPDATED_MARKS) > 0
  }

  /** @internal */
  override addStep(step: Step<Sc>, doc: Node<Sc>): void {
    super.addStep(step, doc)
    this.updated = this.updated & ~UPDATED_MARKS
    this.storedMarksOrNull = null
  }

  /** Update the timestamp for the transaction. */
  setTime(time: number): this {
    this.time = time
    return this
  }

  /** Replace the current selection with the given slice. */
  replaceSelection(slice: Slice<Sc>): this {
    this.selection.replace(this, slice)
    return this
  }

  /**
   * Replace the selection with the given node. When `inheritMarks` is
   * true and the content is inline, it inherits the marks from the place
   * where it is inserted.
   */
  replaceSelectionWith(node: Node<Sc>, inheritMarks = true): this {
    const selection = this.selection
    if (inheritMarks) {
      node = node.mark(
        this.storedMarksOrNull ||
          (selection.empty ? selection.$from.marks() : selection.$from.marksAcrossOrNull(selection.$to) || Mark.none)
      )
    }
    selection.replaceWith(this, node)
    return this
  }

  /** Delete the selection. */
  deleteSelection(): this {
    this.selection.replace(this)
    return this
  }

  /**
   * Replace the given range, or the selection if no range is given,
   * with a text node containing the given string.
   */
  insertText(text: string, from?: number, to?: number): Effect.Effect<this, ReplaceFailure> {
    return attempt(() => this.insertTextUnsafe(text, from, to), isTransformOrModelError as any)
  }

  /** Like `insertText`, but throws on failure (for example for positions outside of the document). */
  insertTextUnsafe(text: string, from?: number, to?: number): this {
    const schema = this.doc.type.schema
    if (from == null) {
      if (!text) return this.deleteSelection()
      return this.replaceSelectionWith(schema.textUnsafe(text) as unknown as Node<Sc>, true)
    } else {
      if (to == null) to = from
      if (!text) return this.deleteRangeUnsafe(from, to)
      let marks = this.storedMarksOrNull
      if (!marks) {
        const $from = this.doc.resolveUnsafe(from)
        marks = to === from ? $from.marks() : $from.marksAcrossOrNull(this.doc.resolveUnsafe(to))
      }
      this.replaceRangeWithUnsafe(from, to, schema.textUnsafe(text, marks) as unknown as Node<Sc>)
      if (!this.selection.empty && this.selection.to === from + text.length) {
        this.setSelectionUnsafe(Selection.near(this.selection.$to))
      }
      return this
    }
  }

  /** Store a metadata property in this transaction, keyed either by name or by plugin. */
  setMeta(key: MetaKey, value: unknown): this {
    this.meta[typeof key === "string" ? key : key.key] = value
    return this
  }

  /** Retrieve a metadata property for a given name or plugin, if it was set. */
  getMeta<A = unknown>(key: MetaKey): Option.Option<A> {
    const name = typeof key === "string" ? key : key.key
    return name in this.meta ? Option.some(this.meta[name] as A) : Option.none()
  }

  /**
   * Returns true if this transaction doesn't contain any metadata, and
   * can thus safely be extended.
   */
  get isGeneric(): boolean {
    for (const _ in this.meta) return false
    return true
  }

  /**
   * Indicate that the editor should scroll the selection into view when
   * updated to the state produced by this transaction.
   */
  scrollIntoView(): this {
    this.updated |= UPDATED_SCROLL
    return this
  }

  /** True when this transaction has had `scrollIntoView` called on it. */
  get scrolledIntoView(): boolean {
    return (this.updated & UPDATED_SCROLL) > 0
  }
}
