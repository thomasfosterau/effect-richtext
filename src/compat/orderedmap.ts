/**
 * A port of the [`orderedmap`](https://github.com/marijnh/orderedmap)
 * package (MIT, Marijn Haverbeke), used by the ProseMirror-compatible
 * schema (`schema.spec.nodes` / `schema.spec.marks`). Code that imports
 * `orderedmap` directly can alias it to this module.
 *
 * @since 0.1.0
 */

// SAFETY: `content` alternates keys and values, so even indices hold keys.
const keyAt = (content: ReadonlyArray<unknown>, i: number): string => content[i] as string

/**
 * A persistent, ordered map from string keys to values.
 *
 * @since 0.1.0
 * @category models
 */
export class OrderedMap<T = any> {
  /** @internal */
  constructor(readonly content: Array<string | T>) {}

  /** @internal */
  find(key: string): number {
    // Steps over the alternating keys and values, so these stay plain loops.
    // oxlint-disable-next-line effect/imperative-loops
    for (let i = 0; i < this.content.length; i += 2) if (this.content[i] === key) return i
    return -1
  }

  private valueAt(i: number): T {
    // SAFETY: `content` alternates keys and values, so odd indices hold values.
    return this.content[i] as T
  }

  /** Retrieve the value stored under `key`, or `undefined`. */
  get(key: string): T | undefined {
    const found = this.find(key)
    return found === -1 ? undefined : this.valueAt(found + 1)
  }

  /**
   * Create a new map by replacing the value of `key` with a new value,
   * or adding a binding to the end of the map. If `newKey` is given,
   * the key of the binding will be replaced with that key.
   */
  update(key: string, value: T, newKey?: string): OrderedMap<T> {
    const self = newKey && newKey !== key ? this.remove(newKey) : this
    const found = self.find(key),
      content = self.content.slice()
    if (found === -1) {
      content.push(newKey || key, value)
    } else {
      content[found + 1] = value
      if (newKey) content[found] = newKey
    }
    return new OrderedMap(content)
  }

  /** Return a map with the given key removed, if it existed. */
  remove(key: string): OrderedMap<T> {
    const found = this.find(key)
    if (found === -1) return this
    const content = this.content.slice()
    content.splice(found, 2)
    return new OrderedMap(content)
  }

  /** Add a new key to the start of the map. */
  addToStart(key: string, value: T): OrderedMap<T> {
    const entry: Array<string | T> = [key, value]
    return new OrderedMap(entry.concat(this.remove(key).content))
  }

  /** Add a new key to the end of the map. */
  addToEnd(key: string, value: T): OrderedMap<T> {
    const content = this.remove(key).content.slice()
    content.push(key, value)
    return new OrderedMap(content)
  }

  /**
   * Add a key before the given key. If `place` is not found, the new key
   * is added to the end.
   */
  addBefore(place: string, key: string, value: T): OrderedMap<T> {
    const without = this.remove(key),
      content = without.content.slice()
    const found = without.find(place)
    content.splice(found === -1 ? content.length : found, 0, key, value)
    return new OrderedMap(content)
  }

  /** Call the given function for each key/value pair in the map, in order. */
  forEach(f: (key: string, value: T) => void): void {
    // oxlint-disable-next-line effect/imperative-loops
    for (let i = 0; i < this.content.length; i += 2) f(keyAt(this.content, i), this.valueAt(i + 1))
  }

  /**
   * Create a new map by prepending the keys in `map` that don't appear
   * in this map before the keys in this map.
   */
  prepend(map: MapLike<T>): OrderedMap<T> {
    const other = OrderedMap.from(map)
    if (!other.size) return this
    return new OrderedMap(other.content.concat(this.subtract(other).content))
  }

  /**
   * Create a new map by appending the keys in `map` that don't appear
   * in this map after the keys in this map.
   */
  append(map: MapLike<T>): OrderedMap<T> {
    const other = OrderedMap.from(map)
    if (!other.size) return this
    return new OrderedMap(this.subtract(other).content.concat(other.content))
  }

  /** Create a map containing all the keys in this map that don't appear in `map`. */
  subtract(map: MapLike<T>): OrderedMap<T> {
    // `content` alternates keys and values; remove each key.
    const other = OrderedMap.from(map)
    return other.content.reduce<OrderedMap<T>>(
      (result, _, i) => (i % 2 === 0 ? result.remove(keyAt(other.content, i)) : result),
      this
    )
  }

  /** Turn the ordered map into a plain object. */
  toObject(): Record<string, T> {
    const result: Record<string, T> = {}
    this.forEach((key, value) => {
      result[key] = value
    })
    return result
  }

  /** The amount of keys in this map. */
  get size(): number {
    return this.content.length >> 1
  }

  /**
   * Return a map with the given content. If null, create an empty map.
   * If given an ordered map, return that map itself. If given an
   * object, create a map from the object's properties.
   */
  static from<T>(map: MapLike<T>): OrderedMap<T> {
    if (map instanceof OrderedMap) return map
    const content: Array<string | T> = []
    if (map) {
      // ProseMirror's for-in copies inherited properties too, so this keeps it.
      // oxlint-disable-next-line effect/imperative-loops
      for (const prop in map) content.push(prop, map[prop])
    }
    return new OrderedMap(content)
  }
}

/**
 * Anything that can be converted to an `OrderedMap`.
 *
 * @since 0.1.0
 * @category models
 */
export type MapLike<T = any> = { readonly [key: string]: T } | OrderedMap<T> | null | undefined

/**
 * @since 0.1.0
 */
export default OrderedMap
