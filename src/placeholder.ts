/**
 * Placeholder text for empty documents or empty textblocks.
 *
 * The plugin only adds node decorations: the empty textblock gets a
 * `data-placeholder` attribute holding the text and a class (`is-empty`
 * by default). Showing the text is left to CSS; `placeholderCSS` is a
 * small default stylesheet.
 *
 * ```ts skip-type-checking
 * const plugins = [placeholder({ placeholder: "Write something…" })]
 * ```
 *
 * @since 0.1.0
 */
import type { AnySchema, Node } from "./model.ts"
import { type EditorState, Plugin } from "./state.ts"
import { Decoration, DecorationSet } from "./view.ts"

/**
 * Where to show the placeholder:
 *
 * - `"doc"`: only when the whole document is empty (consists of a
 *   single empty textblock), on that textblock.
 * - `"block"`: on the empty textblock that holds the cursor (which
 *   includes the case of an empty document).
 *
 * @since 0.1.0
 * @category models
 */
export type PlaceholderStrategy = "doc" | "block"

/**
 * Options for `placeholder`.
 *
 * @since 0.1.0
 * @category models
 */
export interface PlaceholderOptions<Sc extends AnySchema = AnySchema> {
  /**
   * The placeholder text, or a function computing it from the state and
   * the empty textblock (and its position).
   */
  readonly placeholder: string | ((state: EditorState<Sc, any, any>, node: Node<Sc>, pos: number) => string)

  /** Where to show the placeholder. Defaults to `"doc"`. */
  readonly strategy?: PlaceholderStrategy | undefined

  /** The class added to the empty textblock. Defaults to `"is-empty"`. */
  readonly className?: string | undefined
}

const isEmptyTextblock = (node: Node<any>): boolean => node.isTextblock && node.content.size === 0

/**
 * Find the empty textblock (and its position) a placeholder should be
 * shown on with the given strategy, if any.
 */
const findEmptyBlock = (
  state: EditorState<any, any, any>,
  strategy: PlaceholderStrategy
): { readonly node: Node<any>; readonly pos: number } | null => {
  const doc = state.doc
  if (strategy === "doc") {
    if (doc.childCount !== 1) return null
    const first = doc.content.content[0]!
    return isEmptyTextblock(first) ? { node: first, pos: 0 } : null
  }
  const { $from, empty } = state.selection
  if (!empty || $from.depth === 0) return null
  const parent = $from.parent
  return isEmptyTextblock(parent) ? { node: parent, pos: $from.beforeUnsafe() } : null
}

/**
 * Create a placeholder plugin, which adds node decorations to empty
 * textblocks: a `data-placeholder` attribute holding the placeholder
 * text and a class (`is-empty` by default). Use CSS (for example
 * `placeholderCSS`) to show the text.
 *
 * @since 0.1.0
 * @category constructors
 */
export const placeholder = <Sc extends AnySchema = AnySchema>(
  options: PlaceholderOptions<Sc>
): Plugin<undefined, Sc> => {
  const strategy = options.strategy ?? "doc"
  const className = options.className ?? "is-empty"
  return new Plugin<undefined, Sc>({
    props: {
      decorations(state) {
        const found = findEmptyBlock(state, strategy)
        if (!found) return null
        const text = typeof options.placeholder === "function"
          ? options.placeholder(state, found.node, found.pos)
          : options.placeholder
        return DecorationSet.create(state.doc, [
          Decoration.node(found.pos, found.pos + found.node.nodeSize, {
            class: className,
            "data-placeholder": text
          })
        ])
      }
    }
  })
}

/**
 * A default stylesheet that shows the placeholder text (in grey) for
 * textblocks with the default `is-empty` class.
 *
 * @since 0.1.0
 * @category styles
 */
export const placeholderCSS: string = `.ProseMirror .is-empty[data-placeholder]::before {
  content: attr(data-placeholder);
  float: left;
  height: 0;
  color: #adb5bd;
  pointer-events: none;
}
`
