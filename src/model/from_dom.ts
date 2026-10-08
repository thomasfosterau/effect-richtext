/**
 * DOM parsing. (Full implementation pending.)
 *
 * @since 0.1.0
 */
import type { Fragment } from "./fragment.ts"
import type { Mark } from "./mark.ts"
import type { AnySchema, Attrs } from "./schema.ts"

/**
 * Fields that may be present in both tag and style parse rules.
 *
 * @since 0.1.0
 * @category models
 */
export interface GenericParseRule {
  readonly priority?: number | undefined
  readonly consuming?: boolean | undefined
  readonly context?: string | undefined
  readonly mark?: string | undefined
  readonly ignore?: boolean | undefined
  readonly closeParent?: boolean | undefined
  readonly skip?: boolean | undefined
  readonly attrs?: Attrs | undefined
}

/**
 * Parse rule targeting a DOM element.
 *
 * @since 0.1.0
 * @category models
 */
export interface TagParseRule extends GenericParseRule {
  readonly tag: string
  readonly namespace?: string | undefined
  readonly node?: string | undefined
  readonly getAttrs?: ((node: HTMLElement) => Attrs | false | null | undefined) | undefined
  readonly contentElement?: string | HTMLElement | ((node: HTMLElement) => HTMLElement) | undefined
  readonly getContent?: ((node: globalThis.Node, schema: AnySchema) => Fragment<any, any>) | undefined
  readonly preserveWhitespace?: boolean | "full" | undefined
}

/**
 * A parse rule targeting a style property.
 *
 * @since 0.1.0
 * @category models
 */
export interface StyleParseRule extends GenericParseRule {
  readonly style: string
  readonly clearMark?: ((mark: Mark<any, any>) => boolean) | undefined
  readonly getAttrs?: ((node: string) => Attrs | false | null | undefined) | undefined
}

/**
 * A value that describes how to parse a given DOM node or inline style
 * as a node or mark.
 *
 * @since 0.1.0
 * @category models
 */
export type ParseRule = TagParseRule | StyleParseRule
