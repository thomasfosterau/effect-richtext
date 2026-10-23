// Compile-time assertions for commands' error and requirement inference.
// `vp run check` type-checks this file (tsconfig.test.json); it is never
// executed. Every `@ts-expect-error` directive is an assertion that the
// statement below it must NOT compile.
import * as Context from "effect/Context"
import * as Schema from "effect/Schema"
import { chainCommands, deleteSelection } from "effect-richtext/commands"
import type { AnySchema } from "effect-richtext/model"
import type { Command } from "effect-richtext/state"

class Log extends Context.Service<Log, { readonly entries: Array<string> }>()("typetest/Log") {}
class Denied extends Schema.TaggedError<Denied>()("Denied", { reason: Schema.String }) {}
class Other extends Schema.TaggedError<Other>()("Other", {}) {}

declare const logged: Command<AnySchema, never, Log>
declare const denied: Command<AnySchema, Denied>
declare const other: Command<AnySchema, Other>

const chained = chainCommands(logged, denied, deleteSelection, other)
export const _check: Command<AnySchema, Denied | Other, Log> = chained

// The Effect language service reports the same mismatches under its own
// codes, which `@ts-expect-error` does not cover.
// @effect-diagnostics missingEffectContext:off missingEffectError:off
// @ts-expect-error -- the chain requires `Log`
export const _noLog: Command<AnySchema, Denied | Other, never> = chained
// @ts-expect-error -- the chain may fail with `Other`
export const _noOther: Command<AnySchema, Denied, Log> = chained
// @effect-diagnostics missingEffectContext:error missingEffectError:error
