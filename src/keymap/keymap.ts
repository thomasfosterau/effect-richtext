/**
 * Keymaps: plugins that bind key names to commands, ported from
 * `prosemirror-keymap`.
 *
 * Ported from prosemirror-keymap (MIT, Marijn Haverbeke and others).
 *
 * @since 0.1.0
 */
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import { base, keyName } from "w3c-keyname"
import type { AnySchema } from "../model.ts"
import { type Command, Plugin } from "../state.ts"
import type { EditorView } from "../view/view.ts"

const mac = typeof navigator !== "undefined" && /Mac|iP(hone|[oa]d)/.test(navigator.platform)
const windows = typeof navigator !== "undefined" && /Win/.test(navigator.platform)

/**
 * An invalid keymap: a key name with an unrecognized modifier, or two
 * bindings for the same key.
 *
 * @since 0.1.0
 * @category errors
 */
export class KeymapError extends Data.TaggedError("KeymapError")<{
  readonly message: string
}> {}

/**
 * A set of key bindings, mapping key names to commands.
 *
 * @since 0.1.0
 * @category models
 */
export interface Bindings {
  readonly [key: string]: Command<any, any, any>
}

/**
 * The union of the error types of the commands in a set of bindings.
 *
 * @since 0.1.0
 * @category type-level
 */
export type BindingsError<B extends Bindings> = {
  [K in keyof B]: B[K] extends (...args: any) => Effect.Effect<any, infer E, any> ? E : never
}[keyof B]

/**
 * The union of the requirements of the commands in a set of bindings.
 *
 * @since 0.1.0
 * @category type-level
 */
export type BindingsRequirements<B extends Bindings> = {
  [K in keyof B]: B[K] extends (...args: any) => Effect.Effect<any, any, infer R> ? R : never
}[keyof B]

/**
 * The editor view a keydown handler receives. Its `dispatch` is passed
 * to bound commands, and the view itself as their third argument.
 *
 * @since 0.1.0
 * @category models
 */
export type KeymapView<Sc extends AnySchema = AnySchema> = EditorView<Sc, any, any>

/**
 * A keydown handler, as created by `keydownHandler`.
 *
 * @since 0.1.0
 * @category models
 */
export type KeydownHandler<E = never, R = never> = (
  view: KeymapView<any>,
  event: KeyboardEvent
) => Effect.Effect<boolean, E, R>

/**
 * Normalize a key name (such as `"Mod-Shift-a"`) into the canonical
 * form used for lookups (`"Shift-Ctrl-a"` on non-Mac platforms).
 * Throws a `KeymapError` for unrecognized modifiers.
 *
 * @since 0.1.0
 * @category utils
 */
export function normalizeKeyName(name: string): string {
  const parts = name.split(/-(?!$)/)
  let result = parts[parts.length - 1]!
  if (result === "Space") result = " "
  let alt = false, ctrl = false, shift = false, meta = false
  for (let i = 0; i < parts.length - 1; i++) {
    const mod = parts[i]!
    if (/^(cmd|meta|m)$/i.test(mod)) meta = true
    else if (/^a(lt)?$/i.test(mod)) alt = true
    else if (/^(c|ctrl|control)$/i.test(mod)) ctrl = true
    else if (/^s(hift)?$/i.test(mod)) shift = true
    else if (/^mod$/i.test(mod)) {
      if (mac) meta = true
      else ctrl = true
    } else throw new KeymapError({ message: "Unrecognized modifier name: " + mod })
  }
  if (alt) result = "Alt-" + result
  if (ctrl) result = "Ctrl-" + result
  if (meta) result = "Meta-" + result
  if (shift) result = "Shift-" + result
  return result
}

function normalize(map: Bindings): Record<string, Command<any, any, any>> {
  const copy: Record<string, Command<any, any, any>> = Object.create(null)
  for (const prop in map) {
    const norm = normalizeKeyName(prop)
    if (Object.prototype.hasOwnProperty.call(copy, norm)) {
      throw new KeymapError({ message: "Multiple bindings for key " + norm + " in a single keymap" })
    }
    copy[norm] = map[prop]!
  }
  return copy
}

function modifiers(name: string, event: KeyboardEvent, shift = true): string {
  if (event.altKey) name = "Alt-" + name
  if (event.ctrlKey) name = "Ctrl-" + name
  if (event.metaKey) name = "Meta-" + name
  if (shift && event.shiftKey) name = "Shift-" + name
  return name
}

const succeedFalse: Effect.Effect<boolean> = Effect.succeed(false)
const succeedTrue: Effect.Effect<boolean> = Effect.succeed(true)

/**
 * Create a keymap plugin for the given set of bindings.
 *
 * Bindings should map key names to commands, which will be called with
 * `(state, dispatch, view)` arguments, and should succeed with `true`
 * when they've handled the key. Note that the view argument isn't part
 * of the command protocol, but can be used as an escape hatch if a
 * binding needs to directly interact with the UI.
 *
 * Key names may be strings like `"Shift-Ctrl-Enter"`—a key identifier
 * prefixed with zero or more modifiers. Key identifiers are based on
 * the strings that can appear in `KeyEvent.key`. Use lowercase letters
 * to refer to letter keys (or uppercase letters if you want shift to be
 * held). You may use `"Space"` as an alias for the `" "` name.
 *
 * Modifiers can be given in any order. `Shift-` (or `s-`), `Alt-` (or
 * `a-`), `Ctrl-` (or `c-` or `Control-`) and `Cmd-` (or `m-` or
 * `Meta-`) are recognized. For characters that are created by holding
 * shift, the `Shift-` prefix is implied, and should not be added
 * explicitly.
 *
 * You can use `Mod-` as a shorthand for `Cmd-` on Mac and `Ctrl-` on
 * other platforms.
 *
 * You can add multiple keymap plugins to an editor. The order in which
 * they appear determines their precedence (the ones early in the array
 * get to dispatch first).
 *
 * The plugin's error and requirement types are the unions of those of
 * the bound commands. Throws a `KeymapError` when a key name is invalid
 * or bound twice.
 *
 * @since 0.1.0
 * @category constructors
 */
export const keymap = <const B extends Bindings>(
  bindings: B
): Plugin<undefined, AnySchema, BindingsError<B>, BindingsRequirements<B>> =>
  new Plugin<undefined, AnySchema, BindingsError<B>, BindingsRequirements<B>>({
    props: { handleKeyDown: keydownHandler(bindings) }
  })

/**
 * Given a set of bindings (using the same format as `keymap`), return a
 * keydown handler that handles them. The handler succeeds with `true`
 * when one of the matching commands handled the key.
 *
 * Throws a `KeymapError` when a key name is invalid or bound twice.
 *
 * @since 0.1.0
 * @category constructors
 */
export const keydownHandler = <const B extends Bindings>(
  bindings: B
): KeydownHandler<BindingsError<B>, BindingsRequirements<B>> => {
  const map = normalize(bindings)
  return (view, event) =>
    Effect.suspend(() => {
      const name = keyName(event)
      const candidates: Array<Command<any, any, any>> = []
      const direct = map[modifiers(name, event)]
      if (direct) candidates.push(direct)
      // A character key
      if (name.length === 1 && name !== " ") {
        if (event.shiftKey) {
          // In case the name was already modified by shift, try looking
          // it up without its shift modifier
          const noShift = map[modifiers(name, event, false)]
          if (noShift) candidates.push(noShift)
        }
        let baseName: string | undefined
        if (
          (event.altKey || event.metaKey || event.ctrlKey) &&
          // Ctrl-Alt may be used for AltGr on Windows
          !(windows && event.ctrlKey && event.altKey) &&
          (baseName = base[event.keyCode]) && baseName !== name
        ) {
          // Try falling back to the keyCode when there's a modifier
          // active, and our table produces a different name from the
          // the keyCode. See #668, #1060, #1529.
          const fromCode = map[modifiers(baseName, event)]
          if (fromCode) candidates.push(fromCode)
        }
      }
      if (candidates.length === 0) return succeedFalse
      const loop = (i: number): Effect.Effect<boolean, any, any> =>
        i === candidates.length ?
          succeedFalse :
          Effect.flatMap(
            Effect.suspend(() => candidates[i]!(view.state, view.dispatch, view)),
            (handled) => handled ? succeedTrue : loop(i + 1)
          )
      return loop(0)
    })
}
