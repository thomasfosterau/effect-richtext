/**
 * Position maps: `StepMap`, `Mapping` and `MapResult`.
 *
 * @since 0.1.0
 */
import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import * as S from "effect/Schema"

const encodeRanges = S.encodeSync(S.fromJsonString(S.Array(S.Int)))

/**
 * There are several things that positions can be mapped through.
 * Such objects conform to this interface.
 *
 * @since 0.1.0
 * @category models
 */
export interface Mappable {
  /**
   * Map a position through this object. When given, `assoc` (should be
   * -1 or 1, defaults to 1) determines with which side the position is
   * associated, which determines in which direction to move when a
   * chunk of content is inserted at the mapped position.
   */
  readonly map: (pos: number, assoc?: number) => number

  /**
   * Map a position, and return an object containing additional
   * information about the mapping. The result's `deleted` field tells
   * you whether the position was deleted (completely enclosed in a
   * replaced range) during the mapping. When content on only one side
   * is deleted, the position itself is only considered deleted when
   * `assoc` points in the direction of the deleted content.
   */
  readonly mapResult: (pos: number, assoc?: number) => MapResult
}

// Recovery values encode a range index and an offset. They are
// represented as numbers, because tons of them will be created when
// mapping, for example, a large number of decorations. The number's
// lower 16 bits provide the index, the remaining bits the offset.
//
// Note: We intentionally don't use bit shift operators to en- and
// decode these, since those clip to 32 bits, which we might in rare
// cases want to overflow. A 64-bit float can represent 48-bit
// integers precisely.

const lower16 = 0xffff
const factor16 = Math.pow(2, 16)

const makeRecover = (index: number, offset: number) => index + offset * factor16
const recoverIndex = (value: number) => value & lower16
const recoverOffset = (value: number) => (value - (value & lower16)) / factor16

// Calls `f` with each (start, size, size) triple of a step map's flat
// `ranges` and its index, until `f` returns true. Returns whether it did.
const someRange = (
  ranges: ReadonlyArray<number>,
  f: (start: number, a: number, b: number, index: number) => boolean
): boolean => ranges.some((start, k) => k % 3 === 0 && f(start, ranges[k + 1], ranges[k + 2], k / 3))

const DEL_BEFORE = 1,
  DEL_AFTER = 2,
  DEL_ACROSS = 4,
  DEL_SIDE = 8

/**
 * An object representing a mapped position with extra information.
 *
 * @since 0.1.0
 * @category models
 */
export class MapResult {
  /** @internal */
  constructor(
    /** The mapped version of the position. */
    readonly pos: number,
    /** @internal */
    readonly delInfo: number,
    /** @internal */
    readonly recover: number | null
  ) {}

  /**
   * Tells you whether the position was deleted, that is, whether the
   * step removed the token on the side queried (via the `assoc`)
   * argument from the document.
   */
  get deleted(): boolean {
    return (this.delInfo & DEL_SIDE) > 0
  }

  /** Tells you whether the token before the mapped position was deleted. */
  get deletedBefore(): boolean {
    return (this.delInfo & (DEL_BEFORE | DEL_ACROSS)) > 0
  }

  /** True when the token after the mapped position was deleted. */
  get deletedAfter(): boolean {
    return (this.delInfo & (DEL_AFTER | DEL_ACROSS)) > 0
  }

  /**
   * Tells whether any of the steps mapped through deletes across the
   * position (including both the token before and after the position).
   */
  get deletedAcross(): boolean {
    return (this.delInfo & DEL_ACROSS) > 0
  }
}

/**
 * A map describing the deletions and insertions made by a step, which
 * can be used to find the correspondence between positions in the
 * pre-step version of a document and the same position in the
 * post-step version.
 *
 * @since 0.1.0
 * @category models
 */
export class StepMap implements Mappable {
  /**
   * Create a position map. The modifications to the document are
   * represented as an array of numbers, in which each group of three
   * represents a modified chunk as `[start, oldSize, newSize]`.
   */
  constructor(
    /** @internal */
    readonly ranges: ReadonlyArray<number>,
    /** @internal */
    readonly inverted = false
  ) {
    if (!ranges.length && StepMap.empty) return StepMap.empty
  }

  /** @internal */
  recover(value: number): number {
    let diff = 0
    const index = recoverIndex(value)
    if (!this.inverted) {
      someRange(this.ranges, (_, oldSize, newSize, i) => {
        if (i === index) return true
        diff += newSize - oldSize
        return false
      })
    }
    return this.ranges[index * 3] + diff + recoverOffset(value)
  }

  mapResult(pos: number, assoc = 1): MapResult {
    return this._map(pos, assoc, false)
  }

  map(pos: number, assoc = 1): number {
    return this._map(pos, assoc, true)
  }

  /** @internal */
  _map(pos: number, assoc: number, simple: true): number
  /** @internal */
  _map(pos: number, assoc: number, simple: false): MapResult
  _map(pos: number, assoc: number, simple: boolean): number | MapResult {
    let diff = 0
    const oldIndex = this.inverted ? 2 : 1,
      newIndex = this.inverted ? 1 : 2
    // A plain loop: every position mapping runs it for every step map,
    // and a callback made the find-and-replace benchmark four times slower.
    // oxlint-disable-next-line effect/imperative-loops
    for (let i = 0; i < this.ranges.length; i += 3) {
      const start = this.ranges[i] - (this.inverted ? diff : 0)
      if (start > pos) break
      const oldSize = this.ranges[i + oldIndex],
        newSize = this.ranges[i + newIndex],
        end = start + oldSize
      if (pos <= end) {
        const side = !oldSize ? assoc : pos === start ? -1 : pos === end ? 1 : assoc
        const result = start + diff + (side < 0 ? 0 : newSize)
        if (simple) return result
        const recover = pos === (assoc < 0 ? start : end) ? null : makeRecover(i / 3, pos - start)
        // Pure insertions delete nothing (transform 1.12.2).
        let del = 0
        if (oldSize) {
          del |= pos === start ? DEL_AFTER : pos === end ? DEL_BEFORE : DEL_ACROSS
          if (assoc < 0 ? pos !== start : pos !== end) del |= DEL_SIDE
        }
        return new MapResult(result, del, recover)
      }
      diff += newSize - oldSize
    }
    return simple ? pos + diff : new MapResult(pos + diff, 0, null)
  }

  /** @internal */
  touches(pos: number, recover: number): boolean {
    const inverted = this.inverted
    const index = recoverIndex(recover)
    let diff = 0,
      touched = false
    someRange(this.ranges, (rangeStart, a, b, i) => {
      const start = rangeStart - (inverted ? diff : 0)
      if (start > pos) return true
      const oldSize = inverted ? b : a
      if (pos <= start + oldSize && i === index) {
        touched = true
        return true
      }
      diff += (inverted ? a : b) - oldSize
      return false
    })
    return touched
  }

  /** Calls the given function on each of the changed ranges included in this map. */
  forEach(f: (oldStart: number, oldEnd: number, newStart: number, newEnd: number) => void): void {
    const inverted = this.inverted
    let diff = 0
    someRange(this.ranges, (start, a, b) => {
      const oldStart = start - (inverted ? diff : 0),
        newStart = start + (inverted ? 0 : diff)
      const oldSize = inverted ? b : a,
        newSize = inverted ? a : b
      f(oldStart, oldStart + oldSize, newStart, newStart + newSize)
      diff += newSize - oldSize
      return false
    })
  }

  /**
   * Create an inverted version of this map. The result can be used to
   * map positions in the post-step document to the pre-step document.
   */
  invert(): StepMap {
    return new StepMap(this.ranges, !this.inverted)
  }

  /** @internal */
  toString(): string {
    return (this.inverted ? "-" : "") + encodeRanges(this.ranges)
  }

  /**
   * Create a map that moves all positions by offset `n` (which may be
   * negative). This can be useful when applying steps meant for a
   * sub-document to a larger document, or vice-versa.
   */
  static offset(n: number): StepMap {
    return n === 0 ? StepMap.empty : new StepMap(n < 0 ? [0, -n, 0] : [0, 0, n])
  }

  /** A StepMap that contains no changed ranges. */
  static readonly empty: StepMap = new StepMap([])
}

/**
 * A mapping represents a pipeline of zero or more step maps. It has
 * special provisions for losslessly handling mapping positions through
 * a series of steps in which some steps are inverted versions of
 * earlier steps. (This comes up when ‘rebasing’ steps for collaboration
 * or history management.)
 *
 * Mappings are mutable: `appendMap` and friends modify the mapping in
 * place.
 *
 * @since 0.1.0
 * @category models
 */
export class Mapping implements Mappable {
  private _maps: Array<StepMap>
  // False if maps/mirror are shared arrays that we shouldn't mutate
  private ownData: boolean

  /** Create a new mapping with the given position maps. */
  constructor(
    maps?: ReadonlyArray<StepMap>,
    /** @internal */
    public mirror?: Array<number>,
    /**
     * The starting position in the `maps` array, used when `map` or
     * `mapResult` is called.
     */
    public from = 0,
    /** The end position in the `maps` array. */
    public to = maps ? maps.length : 0
  ) {
    // SAFETY: a mapping given its maps owns them only when `mirror` is also absent, and copies them before writing.
    this._maps = (maps as Array<StepMap>) || []
    this.ownData = !(maps || mirror)
  }

  /** The step maps in this mapping. */
  get maps(): ReadonlyArray<StepMap> {
    return this._maps
  }

  /** Create a mapping that maps only through a part of this one. */
  slice(from = 0, to = this.maps.length): Mapping {
    return new Mapping(this._maps, this.mirror, from, to)
  }

  /**
   * Add a step map to the end of this mapping. If `mirrors` is given,
   * it should be the index of the step map that is the mirror image of
   * this one.
   */
  appendMap(map: StepMap, mirrors?: number): void {
    if (!this.ownData) {
      this._maps = this._maps.slice()
      this.mirror = this.mirror && this.mirror.slice()
      this.ownData = true
    }
    this.to = this._maps.push(map)
    if (mirrors != null) this.setMirror(this._maps.length - 1, mirrors)
  }

  /** Add all the step maps in a given mapping to this one (preserving mirroring information). */
  appendMapping(mapping: Mapping): void {
    const startSize = this._maps.length
    mapping._maps.forEach((map, i) => {
      const mirr = mapping.getMirrorOrUndefined(i)
      this.appendMap(map, mirr != null && mirr < i ? startSize + mirr : undefined)
    })
  }

  /**
   * Finds the offset of the step map that mirrors the map at the given
   * offset, in this mapping (as per the second argument to
   * `appendMap`).
   */
  getMirror(n: number): Option.Option<number> {
    return Option.fromUndefinedOr(this.getMirrorOrUndefined(n))
  }

  /** @internal */
  getMirrorOrUndefined(n: number): number | undefined {
    const i = this.mirror ? this.mirror.indexOf(n) : -1
    return this.mirror && i >= 0 ? this.mirror[i + (i % 2 ? -1 : 1)] : undefined
  }

  /** Record that the maps at offsets `n` and `m` mirror each other. */
  setMirror(n: number, m: number): void {
    if (!this.mirror) this.mirror = []
    this.mirror.push(n, m)
  }

  /** Append the inverse of the given mapping to this one. */
  appendMappingInverted(mapping: Mapping): void {
    const totalSize = this._maps.length + mapping._maps.length
    const last = mapping._maps.length - 1
    Arr.reverse(mapping._maps).forEach((map, k) => {
      const i = last - k,
        mirr = mapping.getMirrorOrUndefined(i)
      this.appendMap(map.invert(), mirr != null && mirr > i ? totalSize - mirr - 1 : undefined)
    })
  }

  /** Create an inverted version of this mapping. */
  invert(): Mapping {
    const inverse = new Mapping()
    inverse.appendMappingInverted(this)
    return inverse
  }

  /** Map a position through this mapping. */
  map(pos: number, assoc = 1): number {
    if (this.mirror) return this._map(pos, assoc, true)
    // Plain loops here and in `_map`: a mapping is often a short slice of
    // a long one, and callbacks over the whole array made the
    // find-and-replace benchmark four times slower.
    // oxlint-disable-next-line effect/imperative-loops
    for (let i = this.from; i < this.to; i++) pos = this._maps[i].map(pos, assoc)
    return pos
  }

  /** Map a position through this mapping, returning a mapping result. */
  mapResult(pos: number, assoc = 1): MapResult {
    return this._map(pos, assoc, false)
  }

  /** @internal */
  _map(pos: number, assoc: number, simple: true): number
  /** @internal */
  _map(pos: number, assoc: number, simple: false): MapResult
  _map(pos: number, assoc: number, simple: boolean): number | MapResult {
    let delInfo = 0
    // oxlint-disable-next-line effect/imperative-loops
    for (let i = this.from; i < this.to; i++) {
      const map = this._maps[i],
        result = map.mapResult(pos, assoc)
      if (result.recover != null) {
        const corr = this.getMirrorOrUndefined(i)
        if (corr != null && corr > i && corr < this.to) {
          // A mirrored pair cancels out: skip to its other half.
          i = corr
          pos = this._maps[corr].recover(result.recover)
          continue
        }
      }
      delInfo |= result.delInfo
      pos = result.pos
    }
    return simple ? pos : new MapResult(pos, delInfo, null)
  }
}
