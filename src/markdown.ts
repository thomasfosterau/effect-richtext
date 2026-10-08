/**
 * A Markdown parser and serializer, ported from `prosemirror-markdown`.
 *
 * Parsing uses [markdown-it](https://github.com/markdown-it/markdown-it)
 * and fails in the Effect error channel; serializing is synchronous.
 *
 * ```ts skip-type-checking
 * const doc = yield* defaultMarkdownParser.parse("# Hello *world*")
 * const text = defaultMarkdownSerializer.serialize(doc)
 * ```
 *
 * @since 0.1.0
 */

/** @since 0.1.0 */
export * from "./markdown/errors.ts"
/** @since 0.1.0 */
export * from "./markdown/from_markdown.ts"
/** @since 0.1.0 */
export * from "./markdown/schema.ts"
/** @since 0.1.0 */
export * from "./markdown/to_markdown.ts"
