/**
 * Attribute steps.
 *
 * @since 0.1.0
 */
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import { type AnySchema, type Attrs, Fragment, JSONError, type Node, Slice } from "../model.ts"
import { type Mappable, StepMap } from "./map.ts"
import { Step, type StepJSON, StepResult } from "./step.ts"

/**
 * Update an attribute in a specific node.
 *
 * @since 0.1.0
 * @category steps
 */
export class AttrStep<Sc extends AnySchema = AnySchema> extends Step<Sc> {
  /** Construct an attribute step. */
  constructor(
    /** The position of the target node. */
    readonly pos: number,
    /** The attribute to set. */
    readonly attr: string,
    /** The attribute's new value. */
    readonly value: unknown
  ) {
    super()
  }

  apply(doc: Node<Sc>): StepResult<Sc> {
    const node = doc.nodeAtOrNull(this.pos)
    if (!node) return StepResult.fail("No node at attribute step's position")
    const attrs = Object.create(null)
    for (const name in node.attrs) attrs[name] = node.attrs[name]
    attrs[this.attr] = this.value
    const updated = node.type.createUnsafe(attrs, null, node.marks)
    return StepResult.fromReplace(
      doc,
      this.pos,
      this.pos + 1,
      new Slice(Fragment.from(updated as Node<Sc>), 0, node.isLeaf ? 0 : 1)
    )
  }

  override getMap(): StepMap {
    return StepMap.empty
  }

  invert(doc: Node<Sc>): Step<Sc> {
    return new AttrStep(this.pos, this.attr, (doc.nodeAtOrNull(this.pos)!.attrs as Attrs)[this.attr])
  }

  map(mapping: Mappable): Option.Option<Step<Sc>> {
    const pos = mapping.mapResult(this.pos, 1)
    return pos.deletedAfter ? Option.none() : Option.some(new AttrStep(pos.pos, this.attr, this.value))
  }

  toJSON(): StepJSON {
    return { stepType: "attr", pos: this.pos, attr: this.attr, value: this.value }
  }

  /** @internal */
  static override fromJSONUnsafe<Sc extends AnySchema>(_schema: Sc, json: any): AttrStep<Sc> {
    if (!Predicate.isNumber(json.pos) || !Predicate.isString(json.attr)) {
      throw new JSONError({ message: "Invalid input for AttrStep.fromJSON" })
    }
    return new AttrStep(json.pos, json.attr, json.value)
  }
}

Step.jsonID("attr", AttrStep)

/**
 * Update an attribute in the doc node.
 *
 * @since 0.1.0
 * @category steps
 */
export class DocAttrStep<Sc extends AnySchema = AnySchema> extends Step<Sc> {
  /** Construct an attribute step. */
  constructor(
    /** The attribute to set. */
    readonly attr: string,
    /** The attribute's new value. */
    readonly value: unknown
  ) {
    super()
  }

  apply(doc: Node<Sc>): StepResult<Sc> {
    const attrs = Object.create(null)
    for (const name in doc.attrs) attrs[name] = doc.attrs[name]
    attrs[this.attr] = this.value
    const updated = doc.type.createUnsafe(attrs, doc.content as any, doc.marks)
    return StepResult.ok(updated as Node<Sc>)
  }

  override getMap(): StepMap {
    return StepMap.empty
  }

  invert(doc: Node<Sc>): Step<Sc> {
    return new DocAttrStep(this.attr, (doc.attrs as Attrs)[this.attr])
  }

  map(_mapping: Mappable): Option.Option<Step<Sc>> {
    return Option.some(this)
  }

  toJSON(): StepJSON {
    return { stepType: "docAttr", attr: this.attr, value: this.value }
  }

  /** @internal */
  static override fromJSONUnsafe<Sc extends AnySchema>(_schema: Sc, json: any): DocAttrStep<Sc> {
    if (!Predicate.isString(json.attr)) throw new JSONError({ message: "Invalid input for DocAttrStep.fromJSON" })
    return new DocAttrStep(json.attr, json.value)
  }
}

Step.jsonID("docAttr", DocAttrStep)
