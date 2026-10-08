/**
 * Translation of ProseMirror-style editor props (functions receiving
 * and returning facades) into core editor props (functions receiving
 * and returning core objects), and back.
 *
 * Arguments are converted with `wrap` and results with `unwrap`, which
 * covers every prop except the few that take callbacks or return
 * objects with methods (`handleTextInput`, `nodeViews`, `markViews`,
 * `handleDOMEvents`), which are handled explicitly. Translations are
 * cached per function/object, so that re-translating the same props
 * yields identical core props (the view compares e.g. node view
 * constructors by identity).
 *
 * @internal
 */
import * as Effect from "effect/Effect"
import { runSync, unwrap, unwrapArray, wrap, wrapArray } from "./core.ts"

/** A translation cache. @internal */
export type PropsCache = WeakMap<object, any>

const wrapArgs = (args: ArrayLike<unknown>): Array<unknown> => {
  const result = new Array(args.length)
  for (let i = 0; i < args.length; i++) result[i] = wrap(args[i])
  return result
}

const unwrapResult = (result: unknown): unknown => Array.isArray(result) ? unwrapArray(result) : unwrap(result)

const cached = <A extends object, B>(cache: PropsCache | undefined, key: A, make: () => B): B => {
  if (!cache) return make()
  let found = cache.get(key)
  if (found === undefined) cache.set(key, found = make())
  return found
}

/** Wrap a ProseMirror-style function so that it can be called with core values. @internal */
export const toCoreFunction = (f: (...args: Array<any>) => any, self: unknown): (...args: Array<any>) => any =>
  function(this: unknown, ...args: Array<any>) {
    return unwrapResult(f.apply(self, wrapArgs(args)))
  }

/** Wrap a core function so that it can be called with facades. @internal */
export const fromCoreFunction = (f: (...args: Array<any>) => any, self: unknown): (...args: Array<any>) => any =>
  function(this: unknown, ...args: Array<any>) {
    let result = f.apply(self, args.map((a) => Array.isArray(a) ? unwrapArray(a) : unwrap(a)))
    if (Effect.isEffect(result)) result = runSync(result as Effect.Effect<unknown, unknown>)
    return Array.isArray(result) ? wrapArray(result) : wrap(result)
  }

/** Adapt a ProseMirror-style node or mark view object for the core view. @internal */
export const viewObjectToCore = (view: any): any =>
  view && new Proxy(view, {
    get(target, prop) {
      const value = target[prop]
      if (prop === "update" && typeof value === "function") {
        return (node: unknown, decorations: ReadonlyArray<unknown>, inner: unknown) =>
          target.update(wrap(node), wrapArray(decorations), wrap(inner))
      }
      return typeof value === "function" ? value.bind(target) : value
    }
  })

const translateViews = (views: Record<string, any>, cache: PropsCache | undefined): any => {
  const result: Record<string, any> = {}
  for (const name in views) {
    const ctor = views[name]
    result[name] = ctor &&
      cached(cache, ctor, () => (...args: Array<any>) => viewObjectToCore(ctor(...wrapArgs(args))))
  }
  return result
}

/**
 * Translate a set of ProseMirror-style props into core props. Function
 * props are called with `self` as `this`. @internal
 */
export const propsToCore = (
  props: Record<string, any>,
  self: unknown,
  cache?: PropsCache,
  target: Record<string, any> = {}
): any => {
  for (const name in props) {
    const value = props[name]
    if (name === "handleDOMEvents" && value) {
      target[name] = cached(cache, value, () => propsToCore(value, self, cache))
    } else if ((name === "nodeViews" || name === "markViews") && value) {
      target[name] = cached(cache, value, () => translateViews(value, cache))
    } else if (name === "handleTextInput" && typeof value === "function") {
      target[name] = cached(
        cache,
        value,
        () => (view: unknown, from: number, to: number, text: string, deflt: () => unknown) =>
          value.call(self, wrap(view), from, to, text, () => wrap(deflt()))
      )
    } else if (name === "plugins" && Array.isArray(value)) {
      target[name] = unwrapArray(value)
    } else if (typeof value === "function") {
      target[name] = cached(cache, value, () => toCoreFunction(value, self))
    } else {
      target[name] = unwrap(value)
    }
  }
  return target
}

/** Translate core props into ProseMirror-style props. @internal */
export const propsFromCore = (props: Record<string, any>, self: unknown): any => {
  const target: Record<string, any> = {}
  for (const name in props) {
    const value = props[name]
    if (name === "handleDOMEvents" && value) target[name] = propsFromCore(value, self)
    else if (name === "nodeViews" || name === "markViews") target[name] = value
    else if (name === "plugins" && Array.isArray(value)) target[name] = wrapArray(value)
    else if (typeof value === "function") target[name] = fromCoreFunction(value, self)
    else target[name] = wrap(value)
  }
  return target
}
