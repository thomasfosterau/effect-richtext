/**
 * A `prosemirror-schema-list`-compatible module: list node specs,
 * `addListNodes`, and the list commands (bridged to the core
 * `effect-richtext/schema-list` commands).
 *
 * Ported from prosemirror-schema-list (MIT, Marijn Haverbeke and others).
 *
 * @since 0.1.0
 */
import * as SL from "../schema-list.ts"
import { fromCoreCommand } from "./commands.ts"
import { CORE } from "./internal/core.ts"
import type { Attrs, DOMOutputSpec, NodeRange, NodeSpec, NodeType } from "./model.ts"
import type { OrderedMap } from "./orderedmap.ts"
import type { Command, Transaction } from "./state.ts"

const olDOM: DOMOutputSpec = ["ol", 0],
  ulDOM: DOMOutputSpec = ["ul", 0],
  liDOM: DOMOutputSpec = ["li", 0]

/**
 * An ordered list node spec.
 *
 * @since 0.1.0
 * @category specs
 */
export const orderedList = {
  attrs: { order: { default: 1, validate: "number" } },
  parseDOM: [
    {
      tag: "ol",
      getAttrs(dom: HTMLElement) {
        return { order: dom.hasAttribute("start") ? +dom.getAttribute("start")! : 1 }
      }
    }
  ],
  toDOM(node) {
    return node.attrs.order == 1 ? olDOM : ["ol", { start: node.attrs.order }, 0]
  }
} as NodeSpec

/**
 * A bullet list node spec.
 *
 * @since 0.1.0
 * @category specs
 */
export const bulletList: NodeSpec = {
  parseDOM: [{ tag: "ul" }],
  toDOM() {
    return ulDOM
  }
}

/**
 * A list item node spec.
 *
 * @since 0.1.0
 * @category specs
 */
export const listItem: NodeSpec = {
  parseDOM: [{ tag: "li" }],
  toDOM() {
    return liDOM
  },
  defining: true
}

function add(obj: { [prop: string]: any }, props: { [prop: string]: any }) {
  const copy: { [prop: string]: any } = {}
  for (const prop in obj) copy[prop] = obj[prop]
  for (const prop in props) copy[prop] = props[prop]
  return copy
}

/**
 * Convenience function for adding list-related node types to a map
 * specifying the nodes for a schema.
 *
 * @since 0.1.0
 * @category specs
 */
export function addListNodes(
  nodes: OrderedMap<NodeSpec>,
  itemContent: string,
  listGroup?: string
): OrderedMap<NodeSpec> {
  return nodes.append({
    ordered_list: add(orderedList, { content: "list_item+", group: listGroup }),
    bullet_list: add(bulletList, { content: "list_item+", group: listGroup }),
    list_item: add(listItem, { content: itemContent })
  })
}

/**
 * Returns a command function that wraps the selection in a list with
 * the given type and attributes.
 *
 * @since 0.1.0
 * @category commands
 */
export function wrapInList(listType: NodeType, attrs: Attrs | null = null): Command {
  return fromCoreCommand(SL.wrapInList(listType[CORE], attrs))
}

/**
 * Try to wrap the given node range in a list of the given type.
 * Return `true` when this is possible, `false` otherwise. When `tr` is
 * non-null, the wrapping is added to that transaction.
 *
 * @since 0.1.0
 * @category commands
 */
export function wrapRangeInList(
  tr: Transaction | null,
  range: NodeRange,
  listType: NodeType,
  attrs: Attrs | null = null
): boolean {
  return SL.wrapRangeInList(tr ? (tr[CORE] as any) : null, range[CORE], listType[CORE], attrs)
}

/**
 * Build a command that splits a non-empty textblock at the top level
 * of a list item by also splitting that list item.
 *
 * @since 0.1.0
 * @category commands
 */
export function splitListItem(itemType: NodeType, itemAttrs?: Attrs): Command {
  return fromCoreCommand(SL.splitListItem(itemType[CORE], itemAttrs))
}

/**
 * Acts like `splitListItem`, but without resetting the set of active
 * marks at the cursor.
 *
 * @since 0.1.0
 * @category commands
 */
export function splitListItemKeepMarks(itemType: NodeType, itemAttrs?: Attrs): Command {
  return fromCoreCommand(SL.splitListItemKeepMarks(itemType[CORE], itemAttrs))
}

/**
 * Create a command to lift the list item around the selection up into
 * a wrapping list.
 *
 * @since 0.1.0
 * @category commands
 */
export function liftListItem(itemType: NodeType): Command {
  return fromCoreCommand(SL.liftListItem(itemType[CORE]))
}

/**
 * Create a command to sink the list item around the selection down
 * into an inner list.
 *
 * @since 0.1.0
 * @category commands
 */
export function sinkListItem(itemType: NodeType): Command {
  return fromCoreCommand(SL.sinkListItem(itemType[CORE]))
}
