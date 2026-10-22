import { assert, describe, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import {
  Fragment,
  fromCore as modelFromCore,
  type Node,
  ReplaceError,
  Schema,
  Slice,
  toCore as modelToCore
} from "effect-richtext/compat/model"
import {
  type Command,
  EditorState,
  fromCore as stateFromCore,
  fromCoreCommand,
  Plugin,
  PluginKey,
  Selection,
  type SelectionBookmark,
  TextSelection,
  toCore as stateToCore,
  toCoreCommand,
  type Transaction
} from "effect-richtext/compat/state"
import { doc, eq, p, schema } from "effect-richtext/compat/test-builder"
import {
  type Mappable,
  ReplaceStep,
  Step,
  StepMap,
  StepResult,
  toCore as transformToCore,
  Transform,
  TransformError
} from "effect-richtext/compat/transform"
import * as CoreModel from "effect-richtext/model"
import * as CoreState from "effect-richtext/state"
import * as CoreTransform from "effect-richtext/transform"
import ist from "../utils/ist.ts"
import { getSome } from "../utils/option.ts"

// A custom step, written exactly as for ProseMirror: it sets (or
// toggles) a counter attribute stored in the step itself, replacing the
// document's first paragraph text with the counter.
class CounterStep extends Step {
  constructor(
    readonly pos: number,
    readonly text: string
  ) {
    super()
  }
  apply(doc: Node): StepResult {
    const node = doc.nodeAt(this.pos)
    if (!node || !node.isTextblock) return StepResult.fail("No textblock at " + this.pos)
    const slice = new Slice(Fragment.from(doc.type.schema.text(this.text)), 0, 0)
    return StepResult.fromReplace(doc, this.pos + 1, this.pos + 1 + node.content.size, slice)
  }
  override getMap(): StepMap {
    return StepMap.empty
  }
  invert(doc: Node): Step {
    return new CounterStep(this.pos, doc.nodeAt(this.pos)!.textContent)
  }
  map(mapping: Mappable): Step | null {
    const result = mapping.mapResult(this.pos, 1)
    return result.deleted ? null : new CounterStep(result.pos, this.text)
  }
  toJSON() {
    return { stepType: "compatCounter", pos: this.pos, text: this.text }
  }
  static fromJSON(_schema: Schema, json: any) {
    return new CounterStep(json.pos, json.text)
  }
}
Step.jsonID("compatCounter", CounterStep)

// A custom selection type: a cursor that isn't drawn.
class HiddenCursor extends Selection {
  constructor($pos: any) {
    super($pos, $pos)
  }
  override get visible() {
    return false
  }
  eq(other: Selection): boolean {
    return other instanceof HiddenCursor && other.head == this.head
  }
  map(doc: Node, mapping: Mappable): Selection {
    return new HiddenCursor(doc.resolve(mapping.map(this.head)))
  }
  toJSON(): any {
    return { type: "compatHidden", pos: this.head }
  }
  override getBookmark(): SelectionBookmark {
    const pos = this.head
    const bookmark: SelectionBookmark = {
      map: (mapping) => ({
        ...bookmark,
        map: bookmark.map,
        resolve: (doc) => new HiddenCursor(doc.resolve(mapping.map(pos)))
      }),
      resolve: (doc) => new HiddenCursor(doc.resolve(pos))
    }
    return bookmark
  }
  static fromJSON(doc: Node, json: any) {
    return new HiddenCursor(doc.resolve(json.pos))
  }
}
Selection.jsonID("compatHidden", HiddenCursor)

describe("compat bridge", () => {
  it("preserves identity when wrapping", () => {
    const d = doc(p("foo"), p("bar"))
    ist(d.child(0), d.child(0))
    ist(d.content, d.content)
    ist(d.firstChild!.marks, d.firstChild!.marks)
    ist(modelFromCore(modelToCore(d)), d)
    const core = modelToCore(d)
    ist(modelFromCore(core.childUnsafe(1)), d.child(1))
    ist(d.resolve(3).parent, d.child(0))
    ist(schema.nodes.paragraph.schema, schema)
  })

  it("mixes with the Effect API", () => {
    const d = doc(p("foo"))
    const coreTr = new CoreTransform.Transform(modelToCore(d)).insertUnsafe(1, modelToCore(schema.text("x")))
    ist(modelFromCore(coreTr.doc), doc(p("xfoo")), eq)
    const coreSchema = modelToCore(schema)
    const fromEffect = Effect.runSync(coreSchema.node("paragraph", null, [coreSchema.textUnsafe("hi")]))
    ist(modelFromCore(fromEffect), p("hi"), eq)
    ist(modelFromCore(coreSchema), schema)
  })

  it("wraps a schema created with the core API", () => {
    const core = CoreModel.DocSchema.makeUnsafe({
      nodes: { doc: { content: "text*" }, text: {} }
    })
    const wrapped = modelFromCore(core)
    ist(wrapped instanceof Schema)
    ist(wrapped.spec.nodes.size, 2)
    ist(wrapped.node("doc", null, [wrapped.text("a")]).textContent, "a")
  })

  it("throws ProseMirror's errors", () => {
    const d = doc(p("foo"))
    assert.throws(() => d.resolve(100), RangeError)
    assert.throws(() => d.replace(0, 1, Slice.empty), ReplaceError)
    assert.throws(() => new Transform(d).step(new CounterStep(100, "x")), TransformError)
    assert.throws(() => new Schema({ nodes: { doc: { content: "foo" }, text: {} } }), SyntaxError)
  })

  it("runs custom steps in facade and core transforms", () => {
    const d = doc(p("foo"), p("bar"))
    const tr = new Transform(d).step(new CounterStep(5, "baz"))
    ist(tr.doc, doc(p("foo"), p("baz")), eq)
    ist(tr.steps[0] instanceof CounterStep)
    // The core sees a core step that delegates to the facade.
    const coreStep = transformToCore(tr.steps[0]!)
    ist(coreStep instanceof CoreTransform.Step)
    const coreTr = new CoreTransform.Transform(modelToCore(d)).stepUnsafe(coreStep)
    ist(modelFromCore(coreTr.doc), tr.doc, eq)
    // Inversion, mapping and JSON go through the subclass.
    const inverted = tr.steps[0]!.invert(d)
    ist(inverted.apply(tr.doc).doc, d, eq)
    const json = tr.steps[0]!.toJSON()
    const back = Step.fromJSON(schema, json)
    ist(back instanceof CounterStep)
    ist((back as CounterStep).text, "baz")
    const coreBack = CoreTransform.Step.fromJSONUnsafe(modelToCore(schema), json)
    ist(coreBack.toJSON().text, "baz")
    const mapped = getSome(coreStep.map(new CoreTransform.Mapping([StepMap.offset(2)])))
    ist(mapped.toJSON().pos, 7)
  })

  it("supports subclasses of built-in steps", () => {
    let mapped = 0
    class LoggingStep extends ReplaceStep {
      override map(mapping: Mappable) {
        mapped++
        return super.map(mapping)
      }
    }
    const d = doc(p("foo"))
    const step = new LoggingStep(1, 2, Slice.empty)
    const core = transformToCore(step)
    ist(core instanceof CoreTransform.ReplaceStep)
    ist((step.map(new StepMap([0, 0, 1])) as ReplaceStep).from, 2)
    getSome(core.map(StepMap.offset(1)))
    ist(mapped, 2)
    ist(new Transform(d).step(step).doc, doc(p("oo")), eq)
  })

  it("supports custom selection classes", () => {
    const d = doc(p("foo"), p("bar"))
    let state = EditorState.create({ doc: d })
    const sel = new HiddenCursor(d.resolve(2))
    state = state.apply(state.tr.setSelection(sel))
    ist(state.selection, sel)
    ist(!state.selection.visible)
    ist(!stateToCore(state).selection.visible)
    // Mapping goes through the subclass.
    const tr = state.tr.insertText("xx", 1)
    ist(tr.selection instanceof HiddenCursor)
    ist(tr.selection.head, 4)
    // JSON round trip, also through the core.
    const json = state.toJSON()
    ist(json.selection.type, "compatHidden")
    const restored = EditorState.fromJSON({ schema }, json)
    ist(restored.selection instanceof HiddenCursor)
    ist(restored.selection.head, 2)
    // Bookmarks.
    const bookmark = stateToCore(state).selection.getBookmark()
    ist(stateFromCore(bookmark.resolve(modelToCore(d))) instanceof HiddenCursor)
    // Default implementations from the base class.
    ist(sel.content().size, 0)
  })

  it("bridges plugins in both directions", () => {
    const key = new PluginKey<number>("compatCounter")
    const seen: Array<Transaction> = []
    const plugin = new Plugin<number>({
      key,
      state: {
        init: () => 0,
        apply(tr, value) {
          seen.push(tr)
          return value + 1
        }
      },
      filterTransaction: (tr) => !tr.getMeta("block")
    })
    let state = EditorState.create({ schema, plugins: [plugin] })
    state = state.apply(state.tr.insertText("a"))
    state = state.apply(state.tr.insertText("b").setMeta("block", true))
    ist(key.getState(state), 1)
    ist(plugin.getState(state), 1)
    ist(seen[0]!.doc.textContent, "a")
    // The core state sees the plugin's state.
    const core = stateToCore(state)
    ist(getSome(stateToCore(plugin).getState(core)), 1)
    ist(stateFromCore(core.plugins[0]!), plugin)
    // A core plugin used from the compat API.
    const corePlugin = new CoreState.Plugin({ props: { editable: () => false } })
    const wrapped = stateFromCore(corePlugin)
    ist(wrapped instanceof Plugin)
    ist((wrapped.props.editable as any)(state), false)
    const state2 = EditorState.create({ schema, plugins: [wrapped] })
    ist(state2.plugins[0], wrapped)
  })

  it("bridges commands in both directions", () => {
    const insertX: Command = (state, dispatch) => {
      if (dispatch) dispatch(state.tr.insertText("x"))
      return true
    }
    const core = toCoreCommand(insertX)
    ist(fromCoreCommand(core), insertX)
    const coreState = stateToCore(EditorState.create({ doc: doc(p("<a>foo")) }))
    let result: CoreState.EditorState<any, any, any> = coreState
    const handled = Effect.runSync(
      core(coreState, (tr) =>
        Effect.sync(() => {
          result = coreState.applyUnsafe(tr)
        })
      )
    )
    ist(handled)
    ist(modelFromCore(result.doc).textContent, "xfoo")
    // A core command used as a ProseMirror command.
    const coreSelectAll: CoreState.Command = (state, dispatch) =>
      Effect.as(
        dispatch ? dispatch(state.tr.setSelectionUnsafe(new CoreState.AllSelection(state.doc))) : Effect.void,
        true
      )
    const pmSelectAll = fromCoreCommand(coreSelectAll)
    let state = EditorState.create({ doc: doc(p("foo")) })
    ist(pmSelectAll(state, (tr) => (state = state.apply(tr))))
    ist(state.selection.from, 0)
    ist(state.selection.to, 5)
    ist(state.selection instanceof TextSelection, false)
  })
})
