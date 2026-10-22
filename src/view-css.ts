/**
 * The editor view's stylesheet (`prosemirror-view`'s
 * `style/prosemirror.css`), as a string, plus helpers to add
 * stylesheets to a document.
 *
 * ```ts skip-type-checking
 * // Scoped: the style element is removed when the scope closes.
 * yield* injectViewCSS(document)
 * // Or, outside of Effect:
 * const remove = injectViewCSSUnsafe(document)
 * ```
 *
 * @since 0.1.0
 */
// The CSS is from prosemirror-view (MIT, Marijn Haverbeke and others)
import * as Effect from "effect/Effect"
import type * as Scope from "effect/Scope"

/**
 * The CSS the editor view needs to behave correctly (whitespace
 * handling, selected-node outlines, hidden selections, …). Include it
 * once in every document containing editors.
 *
 * @since 0.1.0
 * @category styles
 */
export const viewCSS: string = `.ProseMirror {
  position: relative;
}

.ProseMirror {
  word-wrap: break-word;
  white-space: pre-wrap;
  white-space: break-spaces;
  -webkit-font-variant-ligatures: none;
  font-variant-ligatures: none;
  font-feature-settings: "liga" 0; /* the above doesn't seem to work in Edge */
}

.ProseMirror pre {
  white-space: pre-wrap;
}

.ProseMirror li {
  position: relative;
}

.ProseMirror-hideselection *::selection { background: transparent; }
.ProseMirror-hideselection *::-moz-selection { background: transparent; }
.ProseMirror-hideselection { caret-color: transparent; }

/* See https://code.haverbeke.berlin/prosemirror/prosemirror/issues/1421#issuecomment-1759320191 */
.ProseMirror [draggable][contenteditable=false] { user-select: text }

.ProseMirror-selectednode {
  outline: 2px solid #8cf;
}

/* Make sure li selections wrap around markers */

li.ProseMirror-selectednode {
  outline: none;
}

li.ProseMirror-selectednode:after {
  content: "";
  position: absolute;
  left: -32px;
  right: -2px; top: -2px; bottom: -2px;
  border: 2px solid #8cf;
  pointer-events: none;
}

/* Protect against generic img rules */

img.ProseMirror-separator {
  display: inline !important;
  border: none !important;
  margin: 0 !important;
}
`

/**
 * Add a `<style>` element with the given CSS to the document's head.
 * Returns a function that removes it again.
 *
 * @since 0.1.0
 * @category utils
 */
export const injectCSSUnsafe = (doc: Document, css: string): (() => void) => {
  const style = doc.createElement("style")
  style.textContent = css
  doc.head.appendChild(style)
  return () => {
    style.remove()
  }
}

/**
 * Add a `<style>` element with the given CSS to the document's head for
 * the lifetime of the current scope.
 *
 * @since 0.1.0
 * @category utils
 */
export const injectCSS = (doc: Document, css: string): Effect.Effect<HTMLStyleElement, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const style = doc.createElement("style")
      style.textContent = css
      doc.head.appendChild(style)
      return style
    }),
    (style) => Effect.sync(() => style.remove())
  )

/**
 * Add the view's stylesheet (`viewCSS`) to the document for the
 * lifetime of the current scope.
 *
 * @since 0.1.0
 * @category utils
 */
export const injectViewCSS = (doc: Document): Effect.Effect<HTMLStyleElement, never, Scope.Scope> =>
  injectCSS(doc, viewCSS)

/**
 * Add the view's stylesheet (`viewCSS`) to the document. Returns a
 * function that removes it again.
 *
 * @since 0.1.0
 * @category utils
 */
export const injectViewCSSUnsafe = (doc: Document): (() => void) => injectCSSUnsafe(doc, viewCSS)
