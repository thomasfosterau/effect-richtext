import * as Option from "effect/Option"
import * as Schema from "effect/Schema"

const UnknownFromJsonString = /* @__PURE__ */ Schema.fromJsonString(Schema.Unknown)
const JsonFromJsonString = /* @__PURE__ */ Schema.fromJsonString(Schema.Json)
const encodeJsonString = /* @__PURE__ */ Schema.encodeOption(UnknownFromJsonString)
const decodeJsonString = /* @__PURE__ */ Schema.decodeOption(JsonFromJsonString)

/**
 * Serialize a value as a JSON string (calling `toJSON` where defined, as
 * `JSON.stringify` does), or `None` when it has no JSON form (`undefined`,
 * a function, a cycle, a `BigInt`).
 *
 * @internal
 */
export const stringifyJson = <A>(value: A): Option.Option<string> => encodeJsonString(value)

/**
 * Parse a JSON string, or `None` when it is not valid JSON.
 *
 * @internal
 */
export const parseJson = (text: string): Option.Option<Schema.Json> => decodeJsonString(text)

/**
 * Render a value for an error or debug message: its JSON form, or
 * `String(value)` when it has none.
 *
 * @internal
 */
export const showJson = <A>(value: A): string => Option.getOrElse(stringifyJson(value), () => String(value))
