// Compile-time assertions for the keymap plugin's requirement tracking.
// `vp run check` type-checks this file (tsconfig.test.json); it is never
// executed. Every `@ts-expect-error` directive is an assertion that the
// statement below it must NOT compile.
import * as Context from "effect/Context"
import { keymap } from "@thomasfosterau/effect-richtext/Keymap"
import type { AnySchema } from "@thomasfosterau/effect-richtext/Model"
import { type Command, EditorState } from "@thomasfosterau/effect-richtext/State"
import { schema } from "@thomasfosterau/effect-richtext/TestBuilder"

class Clipboard extends Context.Service<Clipboard, { readonly copied: Array<string> }>()("typetest/Clipboard") {}

declare const copy: Command<AnySchema, never, Clipboard>

const plugin = keymap({ "Mod-c": copy })

// @ts-expect-error -- a plugin requiring services can't be used with createUnsafe
export const _unsafe = () => EditorState.createUnsafe({ schema, plugins: [plugin] })
