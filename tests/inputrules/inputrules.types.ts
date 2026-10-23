// Compile-time assertions for the input-rules plugin's error and
// requirement inference. `vp run check` type-checks this file
// (tsconfig.test.json); it is never executed. Every `@ts-expect-error`
// directive is an assertion that the statement below it must NOT compile.
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { emDash, InputRule, inputRules, type InputRulesState } from "effect-richtext/inputrules"
import type { AnySchema } from "effect-richtext/model"
import type { Plugin } from "effect-richtext/state"

class Counter extends Context.Service<Counter, { readonly step: number }>()("typetest/Counter") {}
class Boom extends Schema.TaggedError<Boom>()("Boom", { message: Schema.String }) {}

const counterRule = new InputRule(/\+\+$/, (state, _match, start, end) =>
  Effect.gen(function* () {
    const counter = yield* Counter
    return Option.some(state.tr.insertTextUnsafe(String(counter.step), start, end))
  })
)
const failing = new InputRule(/!!$/, () => Effect.fail(new Boom({ message: "boom" })))

const plugin: Plugin<InputRulesState, AnySchema, Boom, Counter> = inputRules({
  rules: [emDash, counterRule, failing]
})

// @ts-expect-error -- the plugin requires Counter
export const _noReqs: Plugin<InputRulesState, AnySchema, Boom, never> = plugin
