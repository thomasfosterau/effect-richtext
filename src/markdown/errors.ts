/**
 * Tagged errors raised by the Markdown parser and serializer.
 *
 * @since 0.1.0
 */
import * as Schema from "effect/Schema"

/**
 * A Markdown error: the tokenizer produced a token type the parser has
 * no handler for, a parser was configured with an invalid parsing
 * spec, or (in strict mode) the serializer met a node or mark type it
 * has no serializer for.
 *
 * `parse` and `serialize` report unsupported tokens and unknown types in
 * the Effect error channel (their `…Unsafe` twins throw); an invalid
 * parsing spec is a programming error and is thrown.
 *
 * @since 0.1.0
 * @category errors
 */
export class MarkdownError extends Schema.TaggedError<MarkdownError>()("MarkdownError", {
  message: Schema.String
}) {}

/**
 * @since 0.1.0
 * @category guards
 */
export const isMarkdownError = (u: unknown): u is MarkdownError => u instanceof MarkdownError
