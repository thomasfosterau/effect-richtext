/**
 * Marks.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array"
import * as Equal from "effect/Equal"
import * as Hash from "effect/Hash"
import * as Order from "effect/Order"
import type * as Types from "effect/Types"
import { writeAttrsJSON } from "./attrsCodec.ts"
import { compareDeep } from "./comparedeep.ts"
import type { AnySchema, MarkAttrs, MarkNames, MarkType } from "./schema.ts"

// Mark sets are kept sorted by their type's rank in the schema.
const byRank: Order.Order<Mark<any, any>> = (a, b) => Order.Number(a.type.rank, b.type.rank)

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
    const typeName: string = this.type.name
    return typeName === name
  }

  /**
   * Given a set of marks, create a new set which contains this one as
   * well, in the right position. If this mark is already in the set,
   * the set itself is returned. If any marks that are set to be
   * exclusive with this mark are present, those are replaced by this
   * one.
   */
  addToSet<Mk extends Mark<any, any>>(set: ReadonlyArray<Mk>): ReadonlyArray<Mk | this> {
    // Filled from the first mark that is dropped or placed before.
    let copy: Array<Mk | this> = [],
      copying = false
    let placed = false
    const startCopy = (i: number) => {
      if (!copying) {
        copy = set.slice(0, i)
        copying = true
      }
    }
    // Whether the set already holds this mark, or one that excludes it.
    const unchanged = set.some((other, i) => {
      if (this.eq(other)) return true
      if (this.type.excludes(other.type)) {
        startCopy(i)
      } else if (other.type.excludes(this.type)) {
        return true
      } else {
        if (!placed && other.type.rank > this.type.rank) {
          startCopy(i)
          copy.push(this)
          placed = true
        }
        if (copying) copy.push(other)
      }
      return false
    })
    if (unchanged) return set
    startCopy(set.length)
    if (!placed) copy.push(this)
    return copy
  }

  /**
   * Remove this mark from the given set, returning a new set. If this
   * mark is not in the set, the set itself is returned.
   */
  removeFromSet<Mk extends Mark<any, any>>(set: ReadonlyArray<Mk>): ReadonlyArray<Mk> {
    const i = set.findIndex((mark) => this.eq(mark))
    return i < 0 ? set : set.slice(0, i).concat(set.slice(i + 1))
  }

  /** Test whether this mark is in the given set of marks. */
  isInSet(set: ReadonlyArray<Mark<any, any>>): boolean {
    return set.some((mark) => this.eq(mark))
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
    return Hash.combine(Hash.string(this.type.name))(Hash.structure(this.attrs))
  }

  /** Convert this mark to a JSON-serializable representation. */
  toJSON(): MarkJSON {
    const obj: Types.Mutable<MarkJSON> = { type: this.type.name }
    writeAttrsJSON(obj, this.type, this.attrs)
    return obj
  }

  /** @internal */
  toString(): string {
    return this.type.name
  }

  /** Test whether two sets of marks are identical. */
  static sameSet(this: void, a: ReadonlyArray<Mark<any, any>>, b: ReadonlyArray<Mark<any, any>>): boolean {
    if (a === b) return true
    if (a.length !== b.length) return false
    return a.every((mark, i) => mark.eq(b[i]))
  }

  /** Create a properly sorted mark set from nothing, a single mark, or an unsorted array of marks. */
  static setFrom<Mk extends Mark<any, any>>(marks?: Mk | ReadonlyArray<Mk>): ReadonlyArray<Mk> {
    if (!marks || (Array.isArray(marks) && Arr.isReadonlyArrayEmpty(marks))) {
      // SAFETY: the empty set holds no mark of any other type.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      return Mark.none as ReadonlyArray<Mk>
    }
    if (marks instanceof Mark) return [marks]
    return Arr.sort(marks, byRank)
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
