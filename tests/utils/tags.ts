/**
 * Reading the `<name>` position markers that the test builders record.
 */
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import type { Node } from "@thomasfosterau/effect-richtext/compat/model"

const decodeTags = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Finite))

/**
 * The `<name>` positions recorded on a node built with the compat test
 * builders (empty for a node without markers). ProseMirror's suites read them
 * as `(node as any).tag`; as there, an absent marker reads as `undefined`.
 */
export const tagsOf = (node: Node): { readonly [name: string]: number } =>
  decodeTags(Predicate.hasProperty(node, "tag") ? node.tag : undefined)
