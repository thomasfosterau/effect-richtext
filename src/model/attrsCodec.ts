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
    enc = S.encodeUnknownSync(schema as any) as (u: unknown) => unknown
    encoderCache.set(schema, enc)
  }
  return enc
}

const decoder = (schema: S.Codec<any, any>): ((u: unknown) => unknown) => {
  let dec = decoderCache.get(schema)
  if (!dec) {
    dec = S.decodeUnknownSync(schema as any) as (u: unknown) => unknown
    decoderCache.set(schema, dec)
  }
  return dec
}

/**
 * Encode attribute values with their schemas, for JSON output. Returns
 * the input object when nothing changed.
 *
 * @internal
 */
export const encodeAttrs = (
  defs: { readonly [name: string]: AttrDef },
  attrs: { readonly [name: string]: unknown }
): { readonly [name: string]: unknown } => {
  let out: Record<string, unknown> | undefined
  for (const name in attrs) {
    const def = defs[name]
    // Values were validated when the node or mark was created.
    if (def?.schema && !def.identityCodec) {
      const encoded = encoder(def.schema)(attrs[name])
      if (encoded !== attrs[name]) {
        if (!out) out = { ...attrs }
        out[name] = encoded
      }
    }
  }
  return out ?? attrs
}

/**
 * Decode attribute values from JSON with their schemas. Throws the
 * schema error on failure.
 *
 * @internal
 */
export const decodeAttrs = (
  defs: { readonly [name: string]: AttrDef },
  attrs: { readonly [name: string]: unknown }
): { readonly [name: string]: unknown } => {
  let out: Record<string, unknown> | undefined
  for (const name in attrs) {
    const def = defs[name]
    // A passing guard is a successful identity decode; otherwise the full
    // decoder runs, to transform or to report the failure.
    if (def?.schema && !(def.identityCodec && def.is && def.is(attrs[name]))) {
      const decoded = decoder(def.schema)(attrs[name])
      if (decoded !== attrs[name]) {
        if (!out) out = { ...attrs }
        out[name] = decoded
      }
    }
  }
  return out ?? attrs
}
