import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"
import * as Schedule from "effect/Schedule"
import type { Node } from "@thomasfosterau/effect-richtext/Model"
import { editorStateAtom, selectAtom, StateRef } from "@thomasfosterau/effect-richtext/Reactive"
import { EditorState, TextSelection } from "@thomasfosterau/effect-richtext/State"
import { doc, p } from "@thomasfosterau/effect-richtext/TestBuilder"
import { selFor } from "../state/state.ts"

const stateFor = (d: Node<any>) => EditorState.createUnsafe({ doc: d, selection: selFor(d) })

// The atoms' streams run on the registry's runtime, so wait in real time.
const eventually = (check: () => boolean) =>
  Effect.retry(
    Effect.suspend(() => (check() ? Effect.void : Effect.fail("not yet"))),
    { schedule: Schedule.spaced("5 millis"), times: 400 }
  )

describe("Reactive atoms", () => {
  it.live("editorStateAtom follows the state", () =>
    Effect.gen(function* () {
      const ref = yield* StateRef.make(stateFor(doc(p("foo<a>"))))
      const registry = AtomRegistry.make()
      const atom = editorStateAtom(ref)
      const seen: Array<string> = []
      const unsubscribe = registry.subscribe(atom, (state) => seen.push(state.doc.textContent), { immediate: true })
      assert.strictEqual(registry.get(atom), ref.state.getUnsafe())
      yield* ref.dispatch(ref.state.getUnsafe().tr.insertTextUnsafe("!"))
      yield* eventually(() => registry.get(atom).doc.textContent === "foo!")
      assert.strictEqual(registry.get(atom), ref.state.getUnsafe())
      assert.deepStrictEqual(seen.at(0), "foo")
      assert.deepStrictEqual(seen.at(-1), "foo!")
      unsubscribe()
    }).pipe(Effect.scoped)
  )

  it.live("selectAtom only changes when the projection does", () =>
    Effect.gen(function* () {
      const ref = yield* StateRef.make(stateFor(doc(p("foo<a>"))))
      const registry = AtomRegistry.make()
      const size = selectAtom(ref, (state) => state.doc.content.size)
      const seen: Array<number> = []
      const unsubscribe = registry.subscribe(size, (n) => seen.push(n), { immediate: true })
      // A selection-only change keeps the size.
      const current = ref.state.getUnsafe()
      yield* ref.dispatch(current.tr.setSelectionUnsafe(TextSelection.createUnsafe(current.doc, 1)))
      yield* ref.dispatch(ref.state.getUnsafe().tr.insertTextUnsafe("ab"))
      yield* eventually(() => registry.get(size) === 7)
      assert.deepStrictEqual(seen, [5, 7])
      unsubscribe()
    }).pipe(Effect.scoped)
  )
})
