/**
 * Marks.
 *
 * @since 0.1.0
 */
import * as Equal from "effect/Equal"
import * as Hash from "effect/Hash"
import { encodeAttrs } from "./attrsCodec.ts"
import { compareDeep } from "./comparedeep.ts"
import type { AnySchema, MarkAttrs, MarkNames, MarkType } from "./schema.ts"

/**
 * A mark is a piece of information that can be attached to a node,
 * such as it being emphasized, in code font, or a link. It has a type
 * and optionally a set of attributes that provide further information
 * (such as the target of the link). Marks are created through a
 * schema, which controls which types exist and which attributes they
 * have.
 *
 * Marks implement `Equal`, comparing type and attributes.
 *
 * @since 0.1.0
 * @category models
 */
export class Mark<Sc extends AnySchema = AnySchema, out M extends MarkNames<Sc> = MarkNames<Sc>>
  implements Equal.Equal
{
  /** @internal */
  constructor(
    /** The type of this mark. */
    readonly type: MarkType<Sc, M>,
    /** The attributes associated with this mark. */
    readonly attrs: MarkAttrs<Sc, M>
  ) {}

  /** Narrow this mark to a specific mark type. */
  is<K extends MarkNames<Sc>>(name: K): this is Mark<Sc, K> {
    return (this.type.name as string) === name
  }

  /**
   * Given a set of marks, create a new set which contains this one as
   * well, in the right position. If this mark is already in the set,
   * the set itself is returned. If any marks that are set to be
   * exclusive with this mark are present, those are replaced by this
   * one.
   */
  addToSet<Mk extends Mark<any, any>>(set: ReadonlyArray<Mk>): ReadonlyArray<Mk | this> {
    let copy: Array<Mk | this> | undefined
    let placed = false
    for (let i = 0; i < set.length; i++) {
      const other = set[i]!
      if (this.eq(other)) return set
      if (this.type.excludes(other.type)) {
        if (!copy) copy = set.slice(0, i)
      } else if (other.type.excludes(this.type)) {
        return set
      } else {
        if (!placed && other.type.rank > this.type.rank) {
          if (!copy) copy = set.slice(0, i)
          copy.push(this)
          placed = true
        }
        if (copy) copy.push(other)
      }
    }
    if (!copy) copy = set.slice()
    if (!placed) copy.push(this)
    return copy
  }

  /**
   * Remove this mark from the given set, returning a new set. If this
   * mark is not in the set, the set itself is returned.
   */
  removeFromSet<Mk extends Mark<any, any>>(set: ReadonlyArray<Mk>): ReadonlyArray<Mk> {
    for (let i = 0; i < set.length; i++) {
      if (this.eq(set[i]!)) return set.slice(0, i).concat(set.slice(i + 1))
    }
    return set
  }

  /** Test whether this mark is in the given set of marks. */
  isInSet(set: ReadonlyArray<Mark<any, any>>): boolean {
    for (let i = 0; i < set.length; i++) if (this.eq(set[i]!)) return true
    return false
  }

  /** Test whether this mark has the same type and attributes as another mark. */
  eq(other: Mark<any, any>): boolean {
    return this === other || (this.type === other.type && compareDeep(this.attrs, other.attrs))
  }

  /** @internal */
  [Equal.symbol](that: Equal.Equal): boolean {
    return that instanceof Mark && this.eq(that)
  }

  /** @internal */
  [Hash.symbol](): number {
    return Hash.combine(Hash.string(this.type.name))(Hash.structure(this.attrs as object))
  }

  /** Convert this mark to a JSON-serializable representation. */
  toJSON(): MarkJSON {
    const obj: { type: string; attrs?: Record<string, unknown> } = { type: this.type.name }
    for (const _ in this.attrs) {
      obj.attrs = encodeAttrs(this.type.attrs, this.attrs)
      break
    }
    return obj
  }

  /** @internal */
  toString(): string {
    return this.type.name
  }

  /** Test whether two sets of marks are identical. */
  static sameSet(a: ReadonlyArray<Mark<any, any>>, b: ReadonlyArray<Mark<any, any>>): boolean {
    if (a === b) return true
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (!a[i]!.eq(b[i]!)) return false
    return true
  }

  /** Create a properly sorted mark set from nothing, a single mark, or an unsorted array of marks. */
  static setFrom<Mk extends Mark<any, any>>(marks?: Mk | ReadonlyArray<Mk> | null): ReadonlyArray<Mk> {
    if (!marks || Array.isArray(marks) && marks.length === 0) return Mark.none as ReadonlyArray<Mk>
    if (marks instanceof Mark) return [marks]
    const copy = (marks as ReadonlyArray<Mk>).slice()
    copy.sort((a, b) => a.type.rank - b.type.rank)
    return copy
  }

  /** The empty set of marks. */
  static readonly none: ReadonlyArray<Mark<any, any>> = []
}

/**
 * The JSON representation of a mark.
 *
 * @since 0.1.0
 * @category models
 */
export interface MarkJSON {
  readonly type: string
  readonly attrs?: { readonly [name: string]: unknown }
}
