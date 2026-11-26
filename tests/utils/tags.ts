/**
 * Reading the `<name>` position markers that the test builders record.
 */
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import type { Node as CompatNode } from "@thomasfosterau/effect-richtext/compat/model"
import type { Node } from "@thomasfosterau/effect-richtext/Model"

const decodeTags = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Finite))

/**
 * The `<name>` positions recorded on a node's `tag` property, as the compat
 * test builders and some core tests set it (empty for a node without markers). ProseMirror's suites read them
 * as `(node as any).tag`; as there, an absent marker reads as `undefined`.
 */
export const tagsOf = (node: CompatNode | Node<any, any>): { readonly [name: string]: number } =>
  decodeTags(Predicate.hasProperty(node, "tag") ? node.tag : undefined)
