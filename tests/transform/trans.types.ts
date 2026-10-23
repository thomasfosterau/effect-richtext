// Compile-time assertions for `Transform`'s typed node attributes.
// `vp run check` type-checks this file (tsconfig.test.json); it is never
// executed. Every `@ts-expect-error` directive is an assertion that the
// statement below it must NOT compile.
import type { Transform } from "effect-richtext/transform"
import { schema } from "effect-richtext/test-builder"

declare const tr: Transform<typeof schema>

// @ts-expect-error -- `level` must be a number
export const _bad = () => tr.setBlockTypeUnsafe(1, 1, schema.nodes.heading, { level: "x" })
// @ts-expect-error -- unknown attribute
export const _bad2 = () => tr.setNodeMarkupUnsafe(0, schema.nodes.heading, { lvl: 1 })
// A function computing the attributes from the node is accepted.
export const _ok = () => tr.setBlockTypeUnsafe(1, 1, schema.nodes.heading, (node) => ({ level: node.childCount + 1 }))
