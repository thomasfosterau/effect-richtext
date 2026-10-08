/**
 * Steps: atomic, invertible, serializable document changes.
 *
 * @since 0.1.0
 */
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as S from "effect/Schema"
import * as SchemaGetter from "effect/SchemaGetter"
import * as SchemaIssue from "effect/SchemaIssue"
import { attempt } from "../internal/attempt.ts"
import { type AnySchema, isModelError, JSONError, type ModelError, type Node, type Slice } from "../model.ts"
import { StepError, TransformError } from "./errors.ts"
import { type Mappable, StepMap } from "./map.ts"

/**
 * The JSON representation of a step. It always includes the step
 * type's JSON id (see `Step.jsonID`) under `stepType`.
 *
 * @since 0.1.0
 * @category models
 */
export interface StepJSON {
  readonly stepType: string
  readonly [key: string]: unknown
}

/**
 * Something that can deserialize steps of a given type: usually the
 * step class itself, via a static `fromJSONUnsafe` method that throws
 * a `JSONError` (or another model error) for invalid input.
 *
 * @since 0.1.0
 * @category models
 */
export interface StepDeserializer {
  readonly fromJSONUnsafe: (schema: AnySchema, json: any) => Step<any>
}

const stepsByID: Record<string, StepDeserializer> = Object.create(null)

/**
 * A step object represents an atomic change. It generally applies only
 * to the document it was created for, since the positions stored in it
 * will only make sense for that document.
 *
 * New steps are defined by creating classes that extend `Step`,
 * overriding the `apply`, `invert`, `map`, `getMap` and `toJSON`
 * methods (plus a static `fromJSONUnsafe`), and registering the class
 * with a unique JSON-serialization identifier using `Step.jsonID`.
 *
 * @since 0.1.0
 * @category models
 */
export abstract class Step<Sc extends AnySchema = AnySchema> {
  /**
   * Applies this step to the given document, returning a result object
   * that either indicates failure, if the step can not be applied to
   * this document, or indicates success by containing a transformed
   * document.
   */
  abstract apply(doc: Node<Sc>): StepResult<Sc>

  /**
   * Like `apply`, but returns an Effect that fails with a `StepError`
   * when the step can't be applied.
   */
  applyEffect(doc: Node<Sc>): Effect.Effect<Node<Sc>, StepError> {
    return Effect.suspend(() => applyStep(this, doc).toEffect())
  }

  /**
   * Get the step map that represents the changes made by this step,
   * and which can be used to transform between positions in the old
   * and the new document.
   */
  getMap(): StepMap {
    return StepMap.empty
  }

  /**
   * Create an inverted version of this step. Needs the document as it
   * was before the step as argument.
   */
  abstract invert(doc: Node<Sc>): Step<Sc>

  /**
   * Map this step through a mappable thing, returning either a version
   * of that step with its positions adjusted, or `None` if the step was
   * entirely deleted by the mapping.
   */
  abstract map(mapping: Mappable): Option.Option<Step<Sc>>

  /**
   * Try to merge this step with another one, to be applied directly
   * after it. Returns the merged step when possible, `None` if the
   * steps can't be merged.
   */
  merge(_other: Step<Sc>): Option.Option<Step<Sc>> {
    return Option.none()
  }

  /**
   * Create a JSON-serializeable representation of this step. When
   * defining this for a custom subclass, make sure the result object
   * includes the step type's JSON id under the `stepType` property.
   */
  abstract toJSON(): StepJSON

  /**
   * Deserialize a step from its JSON representation. Will call through
   * to the step class' own implementation.
   */
  static fromJSON<Sc extends AnySchema>(schema: Sc, json: unknown): Effect.Effect<Step<Sc>, ModelError> {
    return attempt(() => Step.fromJSONUnsafe(schema, json), isModelError)
  }

  /** Like `fromJSON`, but throws a `JSONError` (or other model error) for invalid input. */
  static fromJSONUnsafe<Sc extends AnySchema>(schema: Sc, json: any): Step<Sc> {
    if (!json || typeof json !== "object" || !json.stepType) {
      throw new JSONError({ message: "Invalid input for Step.fromJSON" })
    }
    const type = stepsByID[json.stepType]
    if (!type) throw new JSONError({ message: `No step type ${json.stepType} defined` })
    return type.fromJSONUnsafe(schema, json)
  }

  /**
   * To be able to serialize steps to JSON, each step needs a string ID
   * to attach to its JSON representation. Use this method to register
   * an ID for your step classes. Try to pick something that's unlikely
   * to clash with steps from other modules. Throws a `TransformError`
   * when the ID is already in use.
   */
  static jsonID<C extends StepDeserializer>(id: string, stepClass: C): C {
    if (id in stepsByID) throw new TransformError({ message: "Duplicate use of step JSON ID " + id })
    stepsByID[id] = stepClass
    const proto = (stepClass as unknown as { prototype?: object }).prototype
    if (proto) (proto as { jsonID?: string }).jsonID = id
    return stepClass
  }
}

/**
 * The result of applying a step. Contains either a new document or a
 * failure value.
 *
 * @since 0.1.0
 * @category models
 */
export class StepResult<Sc extends AnySchema = AnySchema> {
  /** @internal */
  constructor(
    /** @internal */
    readonly docOrNull: Node<Sc> | null,
    /** @internal */
    readonly failedOrNull: string | null
  ) {}

  /** The transformed document, if successful. */
  get doc(): Option.Option<Node<Sc>> {
    return Option.fromNullishOr(this.docOrNull)
  }

  /** The failure message, if unsuccessful. */
  get failed(): Option.Option<string> {
    return Option.fromNullishOr(this.failedOrNull)
  }

  /** Convert the result to an Effect that fails with a `StepError` for failed results. */
  toEffect(): Effect.Effect<Node<Sc>, StepError> {
    return this.failedOrNull !== null
      ? Effect.fail(new StepError({ message: this.failedOrNull }))
      : Effect.succeed(this.docOrNull!)
  }

  /** Get the resulting document, throwing a `StepError` for failed results. */
  getUnsafe(): Node<Sc> {
    if (this.failedOrNull !== null) throw new StepError({ message: this.failedOrNull })
    return this.docOrNull!
  }

  /** Create a successful step result. */
  static ok<Sc extends AnySchema>(doc: Node<Sc>): StepResult<Sc> {
    return new StepResult(doc, null)
  }

  /** Create a failed step result. */
  static fail<Sc extends AnySchema = AnySchema>(message: string): StepResult<Sc> {
    return new StepResult<Sc>(null, message)
  }

  /**
   * Call `Node.replace` with the given arguments. Create a successful
   * result if it succeeds, and a failed one if it fails with a model
   * error (such as a `ReplaceError`).
   */
  static fromReplace<Sc extends AnySchema>(doc: Node<Sc>, from: number, to: number, slice: Slice<Sc>): StepResult<Sc> {
    try {
      return StepResult.ok(doc.replaceUnsafe(from, to, slice))
    } catch (e) {
      if (isModelError(e)) return StepResult.fail(e.message)
      throw e
    }
  }
}

/**
 * Apply a step, converting model errors thrown by its `apply` method
 * (for example for positions outside of the document) to failed
 * results.
 *
 * @internal
 */
export const applyStep = <Sc extends AnySchema>(step: Step<Sc>, doc: Node<Sc>): StepResult<Sc> => {
  try {
    return step.apply(doc)
  } catch (e) {
    if (isModelError(e)) return StepResult.fail(e.message)
    throw e
  }
}

const StepJSONSchema = S.declare(
  (u: unknown): u is StepJSON =>
    typeof u === "object" && u !== null && typeof (u as { stepType?: unknown }).stepType === "string",
  { title: "StepJSON" }
)

/**
 * An Effect `Schema` that decodes the JSON representation of a step
 * (using the `Step.jsonID` registry) into a `Step` for the given
 * document schema, and encodes steps back to JSON.
 *
 * @since 0.1.0
 * @category schemas
 */
export const StepFromJSON = <Sc extends AnySchema>(schema: Sc): S.Codec<Step<Sc>, StepJSON> => {
  const target = S.declare((u: unknown): u is Step<Sc> => u instanceof Step, { title: "Step" })
  return StepJSONSchema.pipe(
    S.decodeTo(target, {
      decode: SchemaGetter.transformEffect((json: StepJSON) =>
        Effect.suspend(() => {
          try {
            return Effect.succeed(Step.fromJSONUnsafe(schema, json))
          } catch (e) {
            return Effect.fail(
              new SchemaIssue.InvalidValue({ message: e instanceof Error ? e.message : String(e) }, json)
            )
          }
        })
      ),
      encode: SchemaGetter.transform((step: Step<Sc>) => step.toJSON())
    })
  ) as any
}
