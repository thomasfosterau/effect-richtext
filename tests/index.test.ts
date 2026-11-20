// The package root and the `exports` map: every module is a namespace of
// the root, and each deprecated lowercase subpath points at its module.
import { assert, describe, it } from "@effect/vitest"
import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import * as Order from "effect/Order"
import * as R from "effect/Record"
import * as Root from "@thomasfosterau/effect-richtext"
import * as Model from "@thomasfosterau/effect-richtext/Model"
import * as State from "@thomasfosterau/effect-richtext/State"
import pkg from "../package.json" with { type: "json" }

const subpaths = R.keys(pkg.exports)

const modules = Arr.filter(subpaths, (key) => /^\.\/[A-Z]/.test(key))

describe("package root", () => {
  it("re-exports modules as namespaces", () => {
    assert.strictEqual(Root.Model.DocSchema, Model.DocSchema)
    assert.strictEqual(Root.State.EditorState, State.EditorState)
  })

  it("leaves out only the modules that register state on import", () => {
    const names = Arr.map(modules, (key) => key.slice(2))
    const missing = Arr.difference(names, R.keys(Root))
    assert.deepStrictEqual(Arr.sort(missing, Order.String), ["GapCursor", "TestBuilder"])
  })
})

describe("exports map", () => {
  it("points each deprecated lowercase subpath at its PascalCase module", () => {
    const deprecated = Arr.filter(subpaths, (key) => /^\.\/[a-z]/.test(key) && !key.startsWith("./compat/"))
    const aliased = Arr.filter(deprecated, (key) => key !== "./package.json")
    assert.strictEqual(aliased.length, modules.length)
    const pascal = Arr.map(aliased, (key) =>
      Option.map(
        Arr.findFirst(modules, (m) => m.toLowerCase() === key.replaceAll("-", "")),
        (module) => pkg.exports[module]
      )
    )
    assert.deepStrictEqual(
      pascal,
      Arr.map(aliased, (key) => Option.some(pkg.exports[key]))
    )
  })
})
