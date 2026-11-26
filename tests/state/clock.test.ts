import { assert, describe, it } from "@effect/vitest"
import { history, undoDepth } from "@thomasfosterau/effect-richtext/History"
import { EditorState } from "@thomasfosterau/effect-richtext/State"
import { doc, p, schema } from "@thomasfosterau/effect-richtext/TestBuilder"

describe("EditorState clock", () => {
  it("stamps transactions from the configured clock", () => {
    let now = 1000
    const state = EditorState.createUnsafe({ schema, clock: () => now })
    assert.strictEqual(state.tr.time, 1000)
    now = 2500
    assert.strictEqual(state.tr.time, 2500)
  })

  it("is kept by apply, reconfigure and fromJSON's config", () => {
    let now = 7
    const clock = () => now
    const state = EditorState.createUnsafe({ doc: doc(p("x")), clock })
    const applied = state.applyUnsafe(state.tr.insertTextUnsafe("y"))
    assert.strictEqual(applied.tr.time, 7)
    assert.strictEqual(applied.reconfigureUnsafe({ plugins: [history()] }).tr.time, 7)
    assert.strictEqual(state.reconfigureUnsafe({ clock: () => 42 }).tr.time, 42)
    const restored = EditorState.fromJSONUnsafe({ schema, clock }, state.toJSON())
    now = 9
    assert.strictEqual(restored.tr.time, 9)
  })

  it("drives the history's newGroupDelay grouping", () => {
    let now = 0
    let state = EditorState.createUnsafe({
      doc: doc(p()),
      plugins: [history({ newGroupDelay: 500 })],
      clock: () => now
    })
    const type = (text: string, at: number) => {
      now = at
      state = state.applyUnsafe(state.tr.insertTextUnsafe(text))
    }
    type("a", 1000)
    type("b", 1200)
    assert.strictEqual(undoDepth(state), 1)
    type("c", 1800)
    assert.strictEqual(undoDepth(state), 2)
  })
})
