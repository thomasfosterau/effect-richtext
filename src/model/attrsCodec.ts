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
  let out: Record<string, unknown> | undefined
  Rec.keys(attrs).forEach((name) => {
    const def = defs[name]
    if (!def?.schema || (def.identityCodec && (!decode || (def.is !== undefined && def.is(attrs[name]))))) return
    const value = (decode ? decoder : encoder)(def.schema)(attrs[name])
    if (value !== attrs[name]) {
      if (!out) out = { ...attrs }
      out[name] = value
    }
  })
  return out ?? attrs
}

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
