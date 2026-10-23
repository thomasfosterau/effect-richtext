// Compile-time assertions for `EditorState`'s requirement tracking.
// `vp run check` type-checks this file (tsconfig.test.json); it is never
// executed. Every `@ts-expect-error` directive is an assertion that the
// statement below it must NOT compile.
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import type { AnySchema } from "effect-richtext/model"
import { EditorState, Plugin, type Transaction } from "effect-richtext/state"
import { schema } from "effect-richtext/test-builder"

class Counter extends Context.Service<Counter, { readonly step: number }>()("typetest/Counter") {}

// A plugin whose state hooks require a service.
const stepCountPlugin = new Plugin({
  state: {
    init: () =>
      Effect.gen(function* () {
        yield* Counter
        return 0
      }),
    apply: (_tr: Transaction<AnySchema>, value: number) =>
      Effect.gen(function* () {
        const counter = yield* Counter
        return value + counter.step
      })
  }
})

const program = EditorState.create({ schema, plugins: [stepCountPlugin] })
declare const state: Effect.Success<typeof program>

// @ts-expect-error -- applyUnsafe is not available when plugins require services
export const _unavailable = () => state.applyUnsafe(state.tr)
