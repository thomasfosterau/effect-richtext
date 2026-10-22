/**
 * DOM serialization, ported from ProseMirror's `DOMSerializer`.
 *
 * @since 0.1.0
 */
import type * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { attempt } from "../internal/attempt.ts"
import { DOMSpecError } from "./errors.ts"
import type { Fragment } from "./fragment.ts"
import type { Mark } from "./mark.ts"
import type { Node, TextNode } from "./node.ts"
import type { AnySchema, MarkType, NodeType } from "./schema.ts"

/**
 * A description of a DOM structure. Can be either a DOM node, a
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
 * A hole should be the only child element in its parent node.
 *
 * Plain arrays are accepted as well as tuples, because TypeScript does
 * not always infer a tuple for an array literal returned from a `toDOM`
 * callback; the shape is validated when the spec is rendered.
 *
 * @since 0.1.0
 * @category models
 */
export type DOMOutputSpec =
  | globalThis.Node
  | { readonly dom: globalThis.Node; readonly contentDOM?: HTMLElement | undefined }
  | readonly [string, ...Array<any>]
  | ReadonlyArray<any>

/**
 * The result of rendering a [`DOMOutputSpec`](#DOMOutputSpec). When
 * the spec contained a hole, `contentDOM` points at the element that
 * should hold the content.
 *
 * @since 0.1.0
 * @category models
 */
export interface RenderedSpec {
  readonly dom: globalThis.Node
  readonly contentDOM?: HTMLElement | undefined
}

/**
 * Options accepted by the serialization methods. When not running in
 * an environment with a global `document`, pass one explicitly.
 *
 * @since 0.1.0
 * @category models
 */
export interface SerializeOptions {
  readonly document?: Document | undefined
}

/**
 * A function serializing a node to a [`DOMOutputSpec`](#DOMOutputSpec).
 *
 * @since 0.1.0
 * @category models
 */
export type NodeSerializer<Sc extends AnySchema = AnySchema> = (node: Node<Sc, any>) => DOMOutputSpec

/**
 * A function serializing a mark to a [`DOMOutputSpec`](#DOMOutputSpec).
 * `inline` tells it whether the mark's content is inline content.
 *
 * @since 0.1.0
 * @category models
 */
export type MarkSerializer<Sc extends AnySchema = AnySchema> = (mark: Mark<Sc, any>, inline: boolean) => DOMOutputSpec

/**
 * A DOM serializer knows how to convert nodes and marks of various
 * types to DOM nodes.
 *
 * The serialization methods are synchronous and infallible for valid
 * specs. An invalid output spec returned by a `toDOM` function is a
 * programming error: the serialization methods then throw a
 * `DOMSpecError` (a defect). Use [`renderSpec`](#DOMSerializer.renderSpec)
 * to check specs in the Effect error channel.
 *
 * @since 0.1.0
 * @category models
 */
export class DOMSerializer<Sc extends AnySchema = AnySchema> {
  /**
   * Create a serializer. `nodes` should map node names to functions
   * that take a node and return a description of the corresponding
   * DOM. `marks` does the same for mark names, but also gets an
   * argument that tells it whether the mark's content is block or
   * inline content (for typical use, it'll always be inline). A mark
   * serializer may be `null` to indicate that marks of that type
   * should not be serialized.
   */
  constructor(
    /** The node serialization functions. */
    readonly nodes: { readonly [node: string]: NodeSerializer<Sc> },
    /** The mark serialization functions. */
    readonly marks: { readonly [mark: string]: MarkSerializer<Sc> | null | undefined }
  ) {}

  /**
   * Serialize the content of this fragment to a DOM fragment. When
   * not in the browser, the `document` option, containing a DOM
   * document, should be passed so that the serializer can create
   * nodes.
   *
   * Throws a `DOMSpecError` (as a defect) for invalid output specs.
   */
  serializeFragment(
    fragment: Fragment<Sc, any>,
    options: SerializeOptions = {},
    target?: HTMLElement | DocumentFragment
  ): HTMLElement | DocumentFragment {
    if (!target) target = doc(options).createDocumentFragment()

    let top: globalThis.Node = target
    const active: Array<[Mark<any, any>, globalThis.Node]> = []
    fragment.forEach((node) => {
      if (active.length || node.marks.length) {
        let keep = 0,
          rendered = 0
        while (keep < active.length && rendered < node.marks.length) {
          const next = node.marks[rendered]!
          if (!this.marks[next.type.name]) {
            rendered++
            continue
          }
          if (!next.eq(active[keep]![0]) || next.type.spec.spanning === false) break
          keep++
          rendered++
        }
        while (keep < active.length) top = active.pop()![1]
        while (rendered < node.marks.length) {
          const add = node.marks[rendered++]!
          const markDOM = this.serializeMarkOrNull(add, node.isInline, options)
          if (markDOM) {
            active.push([add, top])
            top.appendChild(markDOM.dom)
            top = markDOM.contentDOM || markDOM.dom
          }
        }
      }
      top.appendChild(this.serializeNodeInner(node, options))
    })

    return target
  }

  /** @internal */
  serializeNodeInner(node: Node<Sc, any>, options: SerializeOptions): globalThis.Node {
    if (node.isText) return doc(options).createTextNode((node as unknown as TextNode).text)
    const toDOM = this.nodes[node.type.name]
    if (!toDOM) throw new DOMSpecError({ message: `No serializer for node type ${node.type.name}` })
    const { contentDOM, dom } = renderSpecInner(doc(options), toDOM(node), null, node.attrs)
    if (contentDOM) {
      if (node.isLeaf) throw new DOMSpecError({ message: "Content hole not allowed in a leaf node spec" })
      this.serializeFragment(node.content, options, contentDOM)
    }
    return dom
  }

  /**
   * Serialize this node to a DOM node. This can be useful when you
   * need to serialize a part of a document, as opposed to the whole
   * document. To serialize a whole document, use
   * [`serializeFragment`](#DOMSerializer.serializeFragment) on its
   * `content`.
   *
   * Throws a `DOMSpecError` (as a defect) for invalid output specs.
   */
  serializeNode(node: Node<Sc, any>, options: SerializeOptions = {}): globalThis.Node {
    let dom = this.serializeNodeInner(node, options)
    for (let i = node.marks.length - 1; i >= 0; i--) {
      const wrap = this.serializeMarkOrNull(node.marks[i]!, node.isInline, options)
      if (wrap) {
        ;(wrap.contentDOM || wrap.dom).appendChild(dom)
        dom = wrap.dom
      }
    }
    return dom
  }

  /**
   * Serialize a mark. Returns `None` when there is no serializer for
   * the mark's type.
   *
   * Throws a `DOMSpecError` (as a defect) for invalid output specs.
   */
  serializeMark(mark: Mark<Sc, any>, inline: boolean, options: SerializeOptions = {}): Option.Option<RenderedSpec> {
    return Option.fromNullishOr(this.serializeMarkOrNull(mark, inline, options))
  }

  /** @internal */
  serializeMarkOrNull(mark: Mark<Sc, any>, inline: boolean, options: SerializeOptions = {}): RenderedSpec | null {
    const toDOM = this.marks[mark.type.name]
    return toDOM ? renderSpecInner(doc(options), toDOM(mark, inline), null, mark.attrs) : null
  }

  /**
   * Render an [output spec](#DOMOutputSpec) to a DOM node. If the spec
   * has a hole (zero) in it, `contentDOM` will point at the node with
   * the hole. Fails with a `DOMSpecError` for invalid specs.
   */
  static renderSpec(
    doc: Document,
    structure: DOMOutputSpec,
    xmlNS: string | null = null
  ): Effect.Effect<RenderedSpec, DOMSpecError> {
    return attempt(() => DOMSerializer.renderSpecUnsafe(doc, structure, xmlNS), isDOMSpecError)
  }

  /**
   * Like `renderSpec`, but throws a `DOMSpecError` for invalid specs.
   * When `blockArraysIn` (usually the attributes of the node or mark
   * being rendered) is given, arrays found in it are refused as specs.
   */
  static renderSpecUnsafe(
    doc: Document,
    structure: DOMOutputSpec,
    xmlNS: string | null = null,
    blockArraysIn?: object
  ): RenderedSpec {
    // Kludge for backwards-compatibility with accidental original behaviour
    if (typeof structure == "string") return { dom: doc.createTextNode(structure) }
    return renderSpecInner(doc, structure, xmlNS, blockArraysIn)
  }

  /**
   * Build a serializer using the [`toDOM`](#NodeSpec.toDOM) properties
   * in a schema's node and mark specs. The result is cached on the
   * schema.
   */
  static fromSchema<Sc extends AnySchema>(schema: Sc): DOMSerializer<Sc> {
    return (
      (schema.cached.domSerializer as DOMSerializer<Sc> | undefined) ||
      ((schema.cached.domSerializer = new DOMSerializer<Sc>(
        DOMSerializer.nodesFromSchema(schema),
        DOMSerializer.marksFromSchema(schema)
      )) as DOMSerializer<Sc>)
    )
  }

  /**
   * Gather the serializers in a schema's node specs into an object.
   * This can be useful as a base to build a custom serializer from.
   */
  static nodesFromSchema<Sc extends AnySchema>(schema: Sc): { [node: string]: NodeSerializer<Sc> } {
    const result = gatherToDOM(schema.nodes) as { [node: string]: NodeSerializer<Sc> }
    if (!result.text) result.text = (node) => (node as unknown as TextNode).text as unknown as DOMOutputSpec
    return result
  }

  /** Gather the serializers in a schema's mark specs into an object. */
  static marksFromSchema<Sc extends AnySchema>(schema: Sc): { [mark: string]: MarkSerializer<Sc> } {
    return gatherToDOM(schema.marks) as { [mark: string]: MarkSerializer<Sc> }
  }
}

const isDOMSpecError = (u: unknown): u is DOMSpecError => u instanceof DOMSpecError

function gatherToDOM(obj: { readonly [name: string]: NodeType<any, any> | MarkType<any, any> }) {
  const result: { [name: string]: (value: any, inline: boolean) => DOMOutputSpec } = {}
  for (const name in obj) {
    const toDOM = obj[name]!.spec.toDOM as ((value: any, inline: boolean) => DOMOutputSpec) | undefined
    if (toDOM) result[name] = toDOM
  }
  return result
}

function doc(options: SerializeOptions): Document {
  return options.document || globalThis.document
}

const suspiciousAttributeCache = new WeakMap<object, ReadonlyArray<unknown> | null>()

function suspiciousAttributes(attrs: object): ReadonlyArray<unknown> | null {
  let value = suspiciousAttributeCache.get(attrs)
  if (value === undefined) suspiciousAttributeCache.set(attrs, (value = suspiciousAttributesInner(attrs)))
  return value
}

function suspiciousAttributesInner(attrs: object): ReadonlyArray<unknown> | null {
  let result: Array<unknown> | null = null
  function scan(value: any) {
    if (value && typeof value == "object") {
      if (Array.isArray(value)) {
        if (typeof value[0] == "string") {
          if (!result) result = []
          result.push(value)
        } else {
          for (let i = 0; i < value.length; i++) scan(value[i])
        }
      } else {
        for (const prop in value) scan(value[prop])
      }
    }
  }
  scan(attrs)
  return result
}

function renderSpecInner(
  doc: Document,
  structure: DOMOutputSpec,
  xmlNS: string | null,
  blockArraysIn?: object
): RenderedSpec {
  if ((structure as globalThis.Node).nodeType != null) return { dom: structure as globalThis.Node }
  if ((structure as any).dom && (structure as any).dom.nodeType != null) return structure as RenderedSpec
  let tagName = (structure as ReadonlyArray<unknown>)[0],
    suspicious
  if (typeof tagName != "string") throw new DOMSpecError({ message: "Invalid array passed to renderSpec" })
  if (blockArraysIn && (suspicious = suspiciousAttributes(blockArraysIn)) && suspicious.indexOf(structure) > -1) {
    throw new DOMSpecError({
      message:
        "Using an array from an attribute object as a DOM spec. This may be an attempted cross site scripting attack."
    })
  }
  const space = tagName.indexOf(" ")
  if (space > 0) {
    xmlNS = tagName.slice(0, space)
    tagName = tagName.slice(space + 1)
  }
  let contentDOM: HTMLElement | undefined
  const dom = (
    xmlNS ? doc.createElementNS(xmlNS, tagName as string) : doc.createElement(tagName as string)
  ) as HTMLElement
  const spec = structure as ReadonlyArray<any>
  const attrs = spec[1]
  let start = 1
  if (attrs && typeof attrs == "object" && attrs.nodeType == null && !Array.isArray(attrs)) {
    start = 2
    for (const name in attrs) {
      if (attrs[name] != null) {
        const space = name.indexOf(" ")
        if (space > 0) dom.setAttributeNS(name.slice(0, space), name.slice(space + 1), attrs[name])
        else if (name == "style" && dom.style) dom.style.cssText = attrs[name]
        else dom.setAttribute(name, attrs[name])
      }
    }
  }
  for (let i = start; i < spec.length; i++) {
    const child = spec[i] as DOMOutputSpec | string | 0
    if (child === 0) {
      if (i < spec.length - 1 || i > start) {
        throw new DOMSpecError({ message: "Content hole must be the only child of its parent node" })
      }
      return { dom, contentDOM: dom }
    } else if (typeof child == "string") {
      dom.appendChild(doc.createTextNode(child))
    } else {
      const { contentDOM: innerContent, dom: inner } = renderSpecInner(doc, child, xmlNS, blockArraysIn)
      dom.appendChild(inner)
      if (innerContent) {
        if (contentDOM) throw new DOMSpecError({ message: "Multiple content holes" })
        contentDOM = innerContent
      }
    }
  }
  return { dom, contentDOM }
}
