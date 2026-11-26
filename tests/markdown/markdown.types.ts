// Compile-time assertions for the Markdown parser and serializer's
// `x` / `xUnsafe` pairs. `vp run check` type-checks this file; it is never
// executed.
import type * as Effect from "effect/Effect"
import {
  defaultMarkdownParser,
  defaultMarkdownSerializer,
  type MarkdownError
} from "@thomasfosterau/effect-richtext/Markdown"
import type { ModelError, Node } from "@thomasfosterau/effect-richtext/Model"

declare const doc: Node

export const parsed: Effect.Effect<Node, MarkdownError | ModelError> = defaultMarkdownParser.parse("x")
export const serialized: Effect.Effect<string, MarkdownError> = defaultMarkdownSerializer.serialize(doc)
export const serializedUnsafe: string = defaultMarkdownSerializer.serializeUnsafe(doc)

// @ts-expect-error serialize returns an Effect, not a string
export const notAString: string = defaultMarkdownSerializer.serialize(doc)
