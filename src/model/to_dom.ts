/**
 * DOM serialization. (Full implementation pending.)
 *
 * @since 0.1.0
 */

/**
 * A description of a DOM structure. Can be either a DOM element, a
 * `{dom, contentDOM}` object, or an array.
 *
 * An array describes a DOM element. The first value in the array
 * should be a string—the name of the DOM element, optionally prefixed
 * by a namespace URL and a space. If the second element is plain
 * object, it is interpreted as a set of attributes for the element.
 * Any elements after that (including the 2nd if it's not an attribute
 * object) are interpreted as children of the DOM elements, and must
 * either be valid `DOMOutputSpec` values, strings (for text nodes), or
 * the number zero ("hole"), which marks where the node's content goes.
 *
 * @since 0.1.0
 * @category models
 */
export type DOMOutputSpec =
  | globalThis.Node
  | { readonly dom: globalThis.Node; readonly contentDOM?: HTMLElement | undefined }
  | readonly [string, ...Array<any>]
