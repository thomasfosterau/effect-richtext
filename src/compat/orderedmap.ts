/**
 * A port of the [`orderedmap`](https://github.com/marijnh/orderedmap)
 * package (MIT, Marijn Haverbeke), used by the ProseMirror-compatible
 * schema (`schema.spec.nodes` / `schema.spec.marks`). Code that imports
 * `orderedmap` directly can alias it to this module.
 *
 * @since 0.1.0
 */

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
    for (let i = 0; i < this.content.length; i += 2) if (this.content[i] === key) return i
    return -1
  }

  /** Retrieve the value stored under `key`, or `undefined`. */
  get(key: string): T | undefined {
    const found = this.find(key)
    return found === -1 ? undefined : (this.content[found + 1] as T)
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
    return new OrderedMap([key, value as string | T].concat(this.remove(key).content))
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
    for (let i = 0; i < this.content.length; i += 2) f(this.content[i] as string, this.content[i + 1] as T)
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
    let result: OrderedMap<T> = this
    const other = OrderedMap.from(map)
    for (let i = 0; i < other.content.length; i += 2) result = result.remove(other.content[i] as string)
    return result
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
      for (const prop in map) content.push(prop, (map as Record<string, T>)[prop]!)
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
