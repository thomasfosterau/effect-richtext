/**
 * List node specs (and, in the future, list commands), ported from
 * `prosemirror-schema-list`.
 *
 * @since 0.1.0
 */
import * as S from "effect/Schema"
import { Content, type ContentExpr, type ContentInput, type DOMOutputSpec, type NodeSpec, nodeSpec } from "./model.ts"

const olDOM: DOMOutputSpec = ["ol", 0], ulDOM: DOMOutputSpec = ["ul", 0], liDOM: DOMOutputSpec = ["li", 0]

/**
 * An ordered list node spec. Has a single attribute, `order`, which
 * determines the number at which the list starts counting, and
 * defaults to 1. Represented as an `<ol>` element.
 *
 * @since 0.1.0
 * @category specs
 */
export const orderedList = nodeSpec({
  attrs: { order: { schema: S.Number, default: 1 } },
  parseDOM: [{
    tag: "ol",
    getAttrs(dom: HTMLElement) {
      return { order: dom.hasAttribute("start") ? +dom.getAttribute("start")! : 1 }
    }
  }],
  toDOM(node) {
    return node.attrs.order === 1 ? olDOM : ["ol", { start: node.attrs.order }, 0]
  }
})

/**
 * A bullet list node spec, represented in the DOM as `<ul>`.
 *
 * @since 0.1.0
 * @category specs
 */
export const bulletList = nodeSpec({
  parseDOM: [{ tag: "ul" }],
  toDOM() {
    return ulDOM
  }
})

/**
 * A list item (`<li>`) spec.
 *
 * @since 0.1.0
 * @category specs
 */
export const listItem = nodeSpec({
  parseDOM: [{ tag: "li" }],
  toDOM() {
    return liDOM
  },
  defining: true
})

/**
 * The node specs added by `addListNodes`.
 *
 * @since 0.1.0
 * @category type-level
 */
export type ListNodes<ItemRefs extends string, Group extends string | undefined> = {
  readonly ordered_list: typeof orderedList & {
    readonly content: ContentExpr<"list_item">
    readonly group: Group
  }
  readonly bullet_list: typeof bulletList & {
    readonly content: ContentExpr<"list_item">
    readonly group: Group
  }
  readonly list_item: typeof listItem & { readonly content: ContentExpr<ItemRefs> }
}

/**
 * Convenience function for adding list-related node types to a set of
 * node specs. Adds them under the names `"ordered_list"`,
 * `"bullet_list"`, and `"list_item"`.
 *
 * `itemContent` determines the content expression for the list items.
 * If you want the commands defined in this module to apply to your
 * list structure, it should have a shape like
 * `Content.seq("paragraph", Content.zeroOrMore("block"))`.
 * `listGroup` can be given to assign a group name to the list node
 * types, for example `"block"`.
 *
 * @since 0.1.0
 * @category specs
 */
export const addListNodes = <
  const N extends { readonly [name: string]: NodeSpec },
  const ItemRefs extends string,
  const Group extends string | undefined = undefined
>(
  nodes: N,
  itemContent: ContentInput<ItemRefs>,
  listGroup?: Group
): N & ListNodes<ItemRefs, Group> =>
  ({
    ...nodes,
    ordered_list: { ...orderedList, content: Content.oneOrMore("list_item"), group: listGroup },
    bullet_list: { ...bulletList, content: Content.oneOrMore("list_item"), group: listGroup },
    list_item: { ...listItem, content: typeof itemContent === "string" ? Content.ref(itemContent) : itemContent }
  }) as any
