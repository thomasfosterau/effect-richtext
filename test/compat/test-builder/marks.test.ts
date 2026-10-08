// Ported from prosemirror-test-builder/test/test-marks.ts (MIT, Marijn Haverbeke and others).
// Changes: imports only (ProseMirror packages -> effect-richtext/compat/*, ist ->
// ../../utils/ist.ts, mocha describe/it -> @effect/vitest; type-only imports
// marked as such) and dprint formatting.
import { describe, it } from "@effect/vitest"
import { Schema } from "effect-richtext/compat/model"
import { builders, eq } from "effect-richtext/compat/test-builder"
import ist from "../../utils/ist.ts"

// This schema has an "a" mark which doesn't exclude itself
const nodes = {
  doc: {
    content: "block+"
  },
  p: {
    content: "inline*",
    group: "block"
  },
  text: {
    group: "inline"
  }
}
const marks = {
  a: {
    attrs: {
      href: {}
    },
    excludes: ""
  }
}
const schema = new Schema({ nodes, marks })

const { doc, p, a } = builders(schema) as any

describe("Multiple marks", () => {
  it("deduplicates identical marks", () => {
    const actual = doc(p(a({ href: "/foo" }, a({ href: "/foo" }, "click <p>here"))))
    const expected = doc(p(a({ href: "/foo" }, "click here")))

    ist(actual, expected, eq)
    ist(actual.nodeAt(actual.tag.p).marks.length, 1)
  })

  it("marks of same type but different attributes are distinct", () => {
    const actual = doc(p(a({ href: "/foo" }, a({ href: "/bar" }, "click <p>here"))))

    ist(actual.nodeAt(actual.tag.p).marks.length, 2)
  })
})
