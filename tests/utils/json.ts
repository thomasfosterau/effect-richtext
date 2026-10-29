/**
 * JSON helpers for the test suites, through Effect Schema's JSON codec.
 */
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"

const UnknownFromJsonString = Schema.fromJsonString(Schema.Unknown)
const encodeJsonString = Schema.encodeSync(UnknownFromJsonString)
const decodeJsonString = Schema.decodeSync(Schema.fromJsonString(Schema.Json))

/**
 * Serializes a value to its JSON string. Throws (failing the test) when the
 * value has no JSON form.
 */
export const toJsonString = <A>(value: A): string => encodeJsonString(value)

/**
 * Sends a value through a JSON string and back, as storing it would: what
 * survives is exactly its JSON form.
 */
export const jsonRoundTrip = <A>(value: A): Schema.Json => decodeJsonString(toJsonString(value))

/**
 * Renders a value for an assertion message: its JSON form, or
 * `String(value)` when it has none (`undefined` past the end of a list).
 */
export const showJson = <A>(value: A): string =>
  Option.getOrElse(Schema.encodeOption(UnknownFromJsonString)(value), () => String(value))
