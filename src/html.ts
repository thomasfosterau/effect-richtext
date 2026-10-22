/**
 * Small helpers converting between documents and HTML strings, built
 * on the model's `DOMParser` and `DOMSerializer`.
 *
 * The helpers need a DOM implementation. In the browser the global
 * `document` is used; elsewhere (for example in Node with `happy-dom`
 * or `jsdom`), pass a `document` in the options, or use the Effect
 * variants (`serialize`, `parse`, `parseSlice`), which read the
 * document from the `HtmlEnvironment` service.
 *
 * ```ts skip-type-checking
 * const html = toHTML(doc) // "<p>Hello</p>"
 * const doc2 = yield* fromHTML(schema, html)
 * ```
 *
 * @since 0.1.0
 */
import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import { attempt } from "./internal/attempt.ts"
import {
  type AnySchema,
  DOMParser,
  DOMSerializer,
  Fragment,
  isModelError,
  type ModelError,
  type Node,
  type ParseOptions,
  type Slice
} from "./model.ts"

/**
 * Raised (as a defect) when no DOM `document` is available: neither one
 * passed in the options nor a global `document`.
 *
 * @since 0.1.0
 * @category errors
 */
export class MissingDocumentError extends Data.TaggedError("MissingDocumentError")<{
  readonly message: string
}> {}

/**
 * Something that can parse an HTML string into a document, like the
 * browser's `window.DOMParser`.
 *
 * @since 0.1.0
 * @category models
 */
export interface HTMLStringParser {
  readonly parseFromString: (string: string, type: DOMParserSupportedType) => Document
}

/**
 * Options for `toHTML` and `serialize`.
 *
 * @since 0.1.0
 * @category models
 */
export interface ToHTMLOptions<Sc extends AnySchema = AnySchema> {
  /** The DOM document used to create nodes. Defaults to the global `document`. */
  readonly document?: Document | undefined
  /** The serializer to use. Defaults to `DOMSerializer.fromSchema(schema)`. */
  readonly serializer?: DOMSerializer<Sc> | undefined
}

/**
 * Options for `fromHTML`, `sliceFromHTML`, `parse` and `parseSlice`.
 * The model's `ParseOptions` are passed through to the parser.
 *
 * @since 0.1.0
 * @category models
 */
export interface FromHTMLOptions<Sc extends AnySchema = AnySchema> extends ParseOptions<Sc> {
  /**
   * The DOM document used to create an inert HTML document to parse
   * into. Defaults to the global `document`. Ignored when `htmlParser`
   * is given.
   */
  readonly document?: Document | undefined
  /** An HTML string parser, such as an instance of the browser's `DOMParser`. */
  readonly htmlParser?: HTMLStringParser | undefined
  /** The parser to use. Defaults to `DOMParser.fromSchema(schema)`. */
  readonly parser?: DOMParser<Sc> | undefined
}

const resolveDocument = (document: Document | undefined): Document => {
  const result = document ?? (globalThis as { document?: Document }).document
  if (!result) {
    throw new MissingDocumentError({
      message: "No DOM document available: pass a `document` option or provide an HtmlEnvironment"
    })
  }
  return result
}

/**
 * Serialize a node or fragment to an HTML string. When given the top
 * node of its schema (usually `doc`), its content is serialized;
 * other nodes are serialized including their own wrapper element (and
 * marks).
 *
 * Throws a `MissingDocumentError` when no document is available, and a
 * `DOMSpecError` for invalid `toDOM` output specs (both programming
 * errors).
 *
 * @since 0.1.0
 * @category serialization
 */
export const toHTML = <Sc extends AnySchema>(
  content: Node<Sc, any> | Fragment<Sc, any>,
  options: ToHTMLOptions<Sc> = {}
): string => {
  const document = resolveDocument(options.document)
  const container = document.createElement("div")
  if (content instanceof Fragment) {
    if (content.childCount === 0) return ""
    const schema = Option.getOrThrow(content.firstChild).type.schema as Sc
    const serializer = options.serializer ?? DOMSerializer.fromSchema(schema)
    serializer.serializeFragment(content, { document }, container)
  } else {
    const schema = content.type.schema as Sc
    const serializer = options.serializer ?? DOMSerializer.fromSchema(schema)
    if (content.type === schema.topNodeType) serializer.serializeFragment(content.content, { document }, container)
    else container.appendChild(serializer.serializeNode(content, { document }))
  }
  return container.innerHTML
}

const parseDOM = (html: string, options: FromHTMLOptions<any>): HTMLElement => {
  if (options.htmlParser) return options.htmlParser.parseFromString(html, "text/html").body
  // Parse into an inert document, so that scripts and resources in the
  // HTML aren't run or loaded.
  const inert = resolveDocument(options.document).implementation.createHTMLDocument("")
  inert.body.innerHTML = html
  return inert.body
}

/**
 * Like `fromHTML`, but throws a `ModelError` when the content can't be
 * parsed into a valid document.
 *
 * @since 0.1.0
 * @category parsing
 */
export const fromHTMLUnsafe = <Sc extends AnySchema>(
  schema: Sc,
  html: string,
  options: FromHTMLOptions<Sc> = {}
): Node<Sc> => (options.parser ?? DOMParser.fromSchema(schema)).parseUnsafe(parseDOM(html, options), options)

/**
 * Parse an HTML string into a document for the given schema.
 *
 * @since 0.1.0
 * @category parsing
 */
export const fromHTML = <Sc extends AnySchema>(
  schema: Sc,
  html: string,
  options: FromHTMLOptions<Sc> = {}
): Effect.Effect<Node<Sc>, ModelError> => attempt(() => fromHTMLUnsafe(schema, html, options), isModelError)

/**
 * Like `sliceFromHTML`, but throws a `ModelError` on failure.
 *
 * @since 0.1.0
 * @category parsing
 */
export const sliceFromHTMLUnsafe = <Sc extends AnySchema>(
  schema: Sc,
  html: string,
  options: FromHTMLOptions<Sc> = {}
): Slice<Sc> => (options.parser ?? DOMParser.fromSchema(schema)).parseSliceUnsafe(parseDOM(html, options), options)

/**
 * Parse an HTML string into a slice that is open at the sides (see
 * `DOMParser.parseSlice`), as for pasted content.
 *
 * @since 0.1.0
 * @category parsing
 */
export const sliceFromHTML = <Sc extends AnySchema>(
  schema: Sc,
  html: string,
  options: FromHTMLOptions<Sc> = {}
): Effect.Effect<Slice<Sc>, ModelError> => attempt(() => sliceFromHTMLUnsafe(schema, html, options), isModelError)

/**
 * A service providing the DOM `document` used to serialize and parse
 * HTML.
 *
 * @since 0.1.0
 * @category services
 */
export class HtmlEnvironment extends Context.Service<
  HtmlEnvironment,
  {
    readonly document: Document
  }
>()("effect-richtext/html/HtmlEnvironment") {
  /**
   * A layer providing the given document.
   *
   * @since 0.1.0
   */
  static readonly layer = (document: Document): Layer.Layer<HtmlEnvironment> =>
    Layer.succeed(HtmlEnvironment, { document })

  /**
   * A layer reading `globalThis.document` when built. Dies with a
   * `MissingDocumentError` when there is no global document.
   *
   * @since 0.1.0
   */
  static readonly layerGlobal: Layer.Layer<HtmlEnvironment> = Layer.effect(
    HtmlEnvironment,
    Effect.sync(() => ({ document: resolveDocument(undefined) }))
  )
}

/**
 * Serialize a node or fragment to an HTML string (see `toHTML`), using
 * the `HtmlEnvironment`'s document.
 *
 * @since 0.1.0
 * @category serialization
 */
export const serialize = <Sc extends AnySchema>(
  content: Node<Sc, any> | Fragment<Sc, any>,
  options: Omit<ToHTMLOptions<Sc>, "document"> = {}
): Effect.Effect<string, never, HtmlEnvironment> =>
  Effect.gen(function* () {
    const { document } = yield* HtmlEnvironment
    return yield* Effect.sync(() => toHTML(content, { ...options, document }))
  })

/**
 * Parse an HTML string into a document (see `fromHTML`), using the
 * `HtmlEnvironment`'s document.
 *
 * @since 0.1.0
 * @category parsing
 */
export const parse = <Sc extends AnySchema>(
  schema: Sc,
  html: string,
  options: Omit<FromHTMLOptions<Sc>, "document"> = {}
): Effect.Effect<Node<Sc>, ModelError, HtmlEnvironment> =>
  Effect.gen(function* () {
    const { document } = yield* HtmlEnvironment
    return yield* fromHTML(schema, html, { ...options, document })
  })

/**
 * Parse an HTML string into an open slice (see `sliceFromHTML`), using
 * the `HtmlEnvironment`'s document.
 *
 * @since 0.1.0
 * @category parsing
 */
export const parseSlice = <Sc extends AnySchema>(
  schema: Sc,
  html: string,
  options: Omit<FromHTMLOptions<Sc>, "document"> = {}
): Effect.Effect<Slice<Sc>, ModelError, HtmlEnvironment> =>
  Effect.gen(function* () {
    const { document } = yield* HtmlEnvironment
    return yield* sliceFromHTML(schema, html, { ...options, document })
  })
