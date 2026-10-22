/**
 * Shared machinery of the ProseMirror compatibility layer: the link
 * between facade objects and the core objects they wrap, and the
 * conversion of core errors into ProseMirror's exceptions.
 *
 * Every facade stores its core object under the `CORE` symbol. Core
 * objects are wrapped on demand by `wrap`, which looks up a factory
 * registered for the core object's class (walking the prototype chain)
 * and caches the facade in a `WeakMap`, so that the same core object
 * always yields the same facade.
 *
 * @internal
 */
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"

/** @internal */
export const CORE: unique symbol = Symbol.for("effect-richtext/compat/core") as never

const facades = new WeakMap<object, object>()
const factories = new Map<object, (core: any) => object>()

/** Associate a facade with its core object. @internal */
export const link = <F extends object>(facade: F, core: object): F => {
  ;(facade as any)[CORE] = core
  facades.set(core, facade)
  return facade
}

/** Create a facade for `core` without running the facade's constructor. @internal */
export const adopt = <F extends object>(proto: object, core: object): F => link(Object.create(proto) as F, core)

/**
 * Register the facade factory for instances of a core class (and its
 * subclasses, unless they have their own factory). @internal
 */
export const registerWrapper = (coreClass: abstract new (...args: any) => any, f: (core: any) => object): void => {
  factories.set(coreClass.prototype, f)
}

/** The facade for a core value (or the value itself if it has none). @internal */
export const wrap = (x: any): any => {
  if (x === null || typeof x !== "object") return x
  const known = facades.get(x)
  if (known) return known
  if (CORE in x) return x
  for (let proto = Object.getPrototypeOf(x); proto; proto = Object.getPrototypeOf(proto)) {
    const f = factories.get(proto)
    if (f) {
      const facade = f(x)
      if (!facades.has(x)) link(facade, x)
      return facade
    }
  }
  return x
}

/** The core object behind a facade (or the value itself). @internal */
export const unwrap = (x: any): any => (x !== null && typeof x === "object" && CORE in x ? x[CORE] : x)

/**
 * Core objects created for user subclasses of facade classes are
 * instances of core subclasses whose methods call the facade's
 * overrides. They store the prototype holding the core's own
 * implementations under `BASE`. @internal
 */
export const BASE: unique symbol = Symbol.for("effect-richtext/compat/base") as never

/** Call a core method, bypassing the overrides that delegate to a facade. @internal */
export const callBase = (core: any, method: string, args: ArrayLike<unknown> = []): any => {
  const proto = core[BASE]
  return (proto ? proto[method] : core[method]).apply(core, args)
}

/** Read a core getter, bypassing the overrides that delegate to a facade. @internal */
export const getBase = (core: any, prop: string): any => {
  for (let proto = core[BASE]; proto; proto = Object.getPrototypeOf(proto)) {
    const desc = Object.getOwnPropertyDescriptor(proto, prop)
    if (desc) return desc.get ? desc.get.call(core) : desc.value
  }
  return core[prop]
}

/** Whether a value is a facade. @internal */
export const isFacade = (x: unknown): boolean => x !== null && typeof x === "object" && CORE in x

const arrayFacades = new WeakMap<ReadonlyArray<any>, ReadonlyArray<any>>()
const arrayCores = new WeakMap<ReadonlyArray<any>, ReadonlyArray<any>>()

/**
 * Wrap an array of core objects, caching the result so that the same
 * core array yields the same facade array. @internal
 */
export const wrapArray = (arr: ReadonlyArray<any>): ReadonlyArray<any> => {
  let found = arrayFacades.get(arr)
  if (!found) {
    found = arr.length === 0 ? emptyFacadeArray : arr.map(wrap)
    if (found !== emptyFacadeArray) arrayCores.set(found, arr)
    arrayFacades.set(arr, found)
  }
  return found
}

const emptyFacadeArray: ReadonlyArray<any> = []

/** Set the core array that the shared empty facade array unwraps to. @internal */
export const setEmptyCoreArray = (core: ReadonlyArray<any>): void => {
  arrayCores.set(emptyFacadeArray, core)
}

/** Unwrap an array of facades (reusing the original core array when possible). @internal */
export const unwrapArray = (arr: ReadonlyArray<any>): ReadonlyArray<any> => {
  const found = arrayCores.get(arr)
  if (found) return found
  for (let i = 0; i < arr.length; i++) {
    if (isFacade(arr[i])) return arr.map(unwrap)
  }
  return arr
}

/** @internal */
export const unwrapArrayOrNull = (arr: ReadonlyArray<any> | null | undefined): any =>
  arr == null ? arr : unwrapArray(arr)

// -----------------------------------------------------------------------------
// Errors
// -----------------------------------------------------------------------------

/**
 * Error type raised by `Node.replace` when given an invalid replacement.
 *
 * @since 0.1.0
 * @category errors
 */
export class ReplaceError extends Error {
  override get name(): string {
    return "ReplaceError"
  }
}

/**
 * An error thrown when a transform step fails or a structural
 * transform is invalid.
 *
 * @since 0.1.0
 * @category errors
 */
export class TransformError extends Error {
  override get name(): string {
    return "TransformError"
  }
}

const rangeError = (message: string): Error => new RangeError(message)

/** The exception ProseMirror throws for each core error tag. */
const proseMirrorErrors: ReadonlyMap<string, (message: string) => Error> = new Map([
  ["ReplaceError", (message: string): Error => new ReplaceError(message)],
  ["TransformError", (message: string): Error => new TransformError(message)],
  ["StepError", (message: string): Error => new TransformError(message)],
  [
    "SchemaDefinitionError",
    (message: string): Error =>
      message.indexOf("(in content expression") > -1 ? new SyntaxError(message) : new RangeError(message)
  ],
  ["PositionError", rangeError],
  ["ContentError", rangeError],
  ["AttributeError", rangeError],
  ["JSONError", rangeError],
  ["DOMSpecError", rangeError],
  ["SelectionError", rangeError],
  ["StateError", rangeError],
  ["KeymapError", rangeError],
  ["ViewError", rangeError]
])

/** Convert a core (tagged) error into the exception ProseMirror would throw. @internal */
export const convertError = (e: unknown): unknown => {
  if (e === null || typeof e !== "object" || !("_tag" in e)) return e
  const message = (e as { message?: string }).message ?? String(e)
  const convert = proseMirrorErrors.get((e as { _tag: string })._tag)
  return convert ? convert(message) : e
}

/** Run `f`, converting core errors into ProseMirror's exceptions. @internal */
export const guard = <A>(f: () => A): A => {
  try {
    return f()
  } catch (e) {
    throw convertError(e)
  }
}

/** Run an effect synchronously, throwing (converted) failures and defects. @internal */
export const runSync = <A, E>(effect: Effect.Effect<A, E>): A => {
  const exit = Effect.runSyncExit(effect)
  if (Exit.isSuccess(exit)) return exit.value
  throw convertError(Cause.squash(exit.cause))
}
