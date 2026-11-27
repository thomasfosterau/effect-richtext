import * as Option from "effect/Option"
import * as Rec from "effect/Record"
import * as S from "effect/Schema"
import type { Attribute } from "./schema.ts"

// `identityCodec` is set when the schema has no transformation, so its
// encoded form is its value: encoding is the identity and decoding is just
// the `is` guard.
type AttrDef = Pick<Attribute, "schema" | "identityCodec" | "is">

const encoderCache = new WeakMap<object, (u: unknown) => unknown>()
const decoderCache = new WeakMap<object, (u: unknown) => unknown>()

const encoder = (schema: S.Codec<any, any>): ((u: unknown) => unknown) => {
  let enc = encoderCache.get(schema)
  if (!enc) {
    enc = S.encodeUnknownSync(schema)
    encoderCache.set(schema, enc)
  }
  return enc
}

const decoder = (schema: S.Codec<any, any>): ((u: unknown) => unknown) => {
  let dec = decoderCache.get(schema)
  if (!dec) {
    dec = S.decodeUnknownSync(schema)
    decoderCache.set(schema, dec)
  }
  return dec
}

type Attrs = { readonly [name: string]: unknown }

// Encodes (`decode` false) or decodes the attributes with their schemas,
// copying the object only when a value changes. Encoding skips identity
// codecs, since values were validated when the node or mark was created;
// decoding skips them when the guard passes (a successful identity decode),
// and otherwise runs the full decoder, to transform or to report the
// failure.
const mapAttrs = (defs: { readonly [name: string]: AttrDef }, attrs: Attrs, decode: boolean): Attrs => {
  // A copy of `attrs`, made at the first changed value.
  const out: Record<string, unknown> = {}
  let copied = false
  // Runs for every node and mark in JSON input and output, so it stays a plain loop.
  // oxlint-disable-next-line effect/imperative-loops
  for (const name in attrs) {
    const schema = Object.hasOwn(defs, name) ? codecFor(defs[name], attrs[name], decode) : Option.none()
    if (Option.isNone(schema)) continue
    const value = (decode ? decoder : encoder)(schema.value)(attrs[name])
    if (value === attrs[name]) continue
    if (!copied) {
      Object.assign(out, attrs)
      copied = true
    }
    out[name] = value
  }
  return copied ? out : attrs
}

// The codec to run on `value`, or none when it can be skipped.
const codecFor = (def: AttrDef, value: unknown, decode: boolean): Option.Option<S.Codec<any, any>> =>
  def.identityCodec && (!decode || Option.exists(def.is, (is) => is(value))) ? Option.none() : def.schema

/**
 * Encode attribute values with their schemas, for JSON output. Returns
 * the input object when nothing changed.
 *
 * @internal
 */
export const encodeAttrs = (defs: { readonly [name: string]: AttrDef }, attrs: Attrs): Attrs =>
  mapAttrs(defs, attrs, false)

/**
 * Set `json.attrs` to the encoded attrs of a node or mark, when it has any.
 *
 * @internal
 */
export const writeAttrsJSON = (
  json: { attrs?: { readonly [name: string]: unknown } },
  type: { readonly identityAttrs: boolean; readonly attrs: { readonly [name: string]: AttrDef } },
  attrs: Attrs
): void => {
  if (!Rec.isEmptyRecord(attrs)) json.attrs = type.identityAttrs ? attrs : encodeAttrs(type.attrs, attrs)
}

/**
 * Decode attribute values from JSON with their schemas. Throws the
 * schema error on failure.
 *
 * @internal
 */
export const decodeAttrs = (defs: { readonly [name: string]: AttrDef }, attrs: Attrs): Attrs =>
  mapAttrs(defs, attrs, true)
