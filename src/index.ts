/**
 * Every module as a namespace. `GapCursor` and `TestBuilder` register
 * state when imported, so they are only on their own subpaths.
 *
 * @since 0.3.0
 */

/**
 * Editing commands and base keymaps, ported from `prosemirror-commands`.
 *
 * @since 0.3.0
 */
export * as Commands from "./Commands.ts"

/**
 * A plugin that shows a drop cursor when something is dragged over the editor.
 *
 * @since 0.3.0
 */
export * as DropCursor from "./DropCursor.ts"

/**
 * Typed extensions: compose schema specs, plugins, keymaps and commands into an editor.
 *
 * @since 0.3.0
 */
export * as Extensions from "./Extensions.ts"

/**
 * An undo/redo history for the editor, ported from `prosemirror-history`.
 *
 * @since 0.3.0
 */
export * as History from "./History.ts"

/**
 * Helpers converting between documents and HTML strings.
 *
 * @since 0.3.0
 */
export * as Html from "./Html.ts"

/**
 * Input rules: typed text patterns that trigger an edit, ported from `prosemirror-inputrules`.
 *
 * @since 0.3.0
 */
export * as InputRules from "./InputRules.ts"

/**
 * Keymap plugins, ported from `prosemirror-keymap`.
 *
 * @since 0.3.0
 */
export * as Keymap from "./Keymap.ts"

/**
 * A Markdown parser and serializer, ported from `prosemirror-markdown`.
 *
 * @since 0.3.0
 */
export * as Markdown from "./Markdown.ts"

/**
 * The document model: schemas, nodes, marks, fragments, slices and resolved positions.
 *
 * @since 0.3.0
 */
export * as Model from "./Model.ts"

/**
 * Placeholder text for empty documents or empty textblocks.
 *
 * @since 0.3.0
 */
export * as Placeholder from "./Placeholder.ts"

/**
 * Framework-neutral reactive bindings: editor states and views as `SubscriptionRef`s and `Stream`s.
 *
 * @since 0.3.0
 */
export * as Reactive from "./Reactive.ts"

/**
 * A basic document schema, ported from `prosemirror-schema-basic`.
 *
 * @since 0.3.0
 */
export * as SchemaBasic from "./SchemaBasic.ts"

/**
 * List node specs and list commands, ported from `prosemirror-schema-list`.
 *
 * @since 0.3.0
 */
export * as SchemaList from "./SchemaList.ts"

/**
 * Editor state: selections, transactions, plugins and `EditorState`.
 *
 * @since 0.3.0
 */
export * as State from "./State.ts"

/**
 * Document transformations: steps, position mapping and the `Transform` builder.
 *
 * @since 0.3.0
 */
export * as Transform from "./Transform.ts"

/**
 * The editor view, decorations, node views and mark views.
 *
 * @since 0.3.0
 */
export * as View from "./View.ts"

/**
 * The editor view's stylesheet and helpers to add stylesheets to a document.
 *
 * @since 0.3.0
 */
export * as ViewCss from "./ViewCss.ts"
