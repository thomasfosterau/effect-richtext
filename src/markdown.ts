/**
 * A Markdown parser and serializer, ported from `prosemirror-markdown`.
 *
 * Parsing uses [markdown-it](https://github.com/markdown-it/markdown-it)
 * and fails in the Effect error channel; serializing is synchronous.
 *
 * ```ts
 * const doc = yield* defaultMarkdownParser.parse("# Hello *world*")
 * const text = defaultMarkdownSerializer.serialize(doc)
 * ```
 *
 * @since 0.1.0
 */

export * from "./markdown/errors.ts"
export * from "./markdown/from_markdown.ts"
export * from "./markdown/schema.ts"
export * from "./markdown/to_markdown.ts"
