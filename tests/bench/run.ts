/**
 * `vp run bench`: times every workload on ProseMirror and on the core's
 * built `dist/`, each library and workload in a fresh Node process.
 *
 * Fresh processes keep the comparison fair: in one process the shared
 * workload code sees both libraries' objects, its call sites go
 * polymorphic, and whichever library runs second pays for it (in-process
 * runs put the core 2.4× behind on deep lists, against 1.7× in isolation). Each round
 * alternates which library goes first, and the table reports the median
 * over rounds of each process's median sample.
 *
 * Configuration (environment): `BENCH_ROUNDS` (default 3) and
 * `BENCH_FILTER` (a substring of the workload names to run; default all).
 * Workers discard stderr (ProseMirror warns there about the selections the
 * deep-list workload creates); to see a failing worker's output, run it
 * directly: `vpx --tsconfig tsconfig.base.json tests/bench/run.ts core 6`.
 *
 * @copyright Thomas Foster
 */
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import * as Arr from "effect/Array"
import * as Config from "effect/Config"
import * as Console from "effect/Console"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Order from "effect/Order"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import * as Schema from "effect/Schema"
import { core } from "./core.ts"
import type { Lib, Types } from "./lib.ts"
import { prosemirror } from "./prosemirror.ts"
import { type Workload, workloads } from "./workloads.ts"

/**
 * A worker process that did not report a time.
 *
 * @since 0.1.0
 * @category errors
 */
class WorkerError extends Schema.TaggedError<WorkerError, { readonly brand: unique symbol }>()("WorkerError", {
  message: Schema.String,
  cause: Schema.Defect()
}) {}

// Warm-up before sampling, and the sampling budget per process.
const WARMUP_MS = 600
const SAMPLE_MS = 2000
const MIN_SAMPLES = 9
const MAX_SAMPLES = 400

const median = (values: ReadonlyArray<number>): number => {
  const sorted = Arr.sort(values, Order.Number)
  return Option.getOrElse(Arr.get(sorted, sorted.length >> 1), () => Number.NaN)
}

const sample = <T extends Types>(lib: Lib<T>, run: Workload): Effect.Effect<number> =>
  Effect.map(Effect.timed(Effect.sync(() => run(lib))), ([duration]) => Duration.toMillis(duration))

// Samples until both `minSamples` and `minMs` are met, or `maxSamples` is.
const collect = <T extends Types>(
  lib: Lib<T>,
  run: Workload,
  minSamples: number,
  minMs: number,
  maxSamples: number
): Effect.Effect<ReadonlyArray<number>> => {
  const go = (times: ReadonlyArray<number>, spent: number): Effect.Effect<ReadonlyArray<number>> =>
    (times.length >= minSamples && spent >= minMs) || times.length >= maxSamples
      ? Effect.succeed(times)
      : Effect.flatMap(sample(lib, run), (ms) => go([...times, ms], spent + ms))
  return go([], 0)
}

const time = <T extends Types>(lib: Lib<T>, run: Workload): Effect.Effect<number> =>
  collect(lib, run, 1, WARMUP_MS, Number.POSITIVE_INFINITY).pipe(
    Effect.andThen(collect(lib, run, MIN_SAMPLES, SAMPLE_MS, MAX_SAMPLES)),
    Effect.map(median)
  )

type LibName = "prosemirror" | "core"

// The worker: `run.ts <lib> <workload index>` prints its median in ms.
const worker = (name: LibName, index: number): Effect.Effect<void> =>
  Option.match(Arr.get(workloads, index), {
    onNone: () => Console.error(`No workload ${index}`),
    onSome: ([, run]) =>
      Effect.flatMap(name === "core" ? time(core, run) : time(prosemirror, run), (ms) => Console.log(String(ms)))
  })

// Runs one worker in a fresh process, with this process's loader flags (vpx's).
const spawn = Effect.fn("spawn")(function* (name: LibName, index: number) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const failed = (cause: unknown) => new WorkerError({ message: `Worker ${name} ${index} failed`, cause })
  const out = yield* spawner
    .string(
      ChildProcess.make(process.execPath, [...process.execArgv, import.meta.filename, name, String(index)], {
        stderr: "ignore"
      })
    )
    .pipe(Effect.mapError(failed))
  const ms = Number(out.trim())
  return Number.isFinite(ms) ? ms : yield* failed(`printed "${out.trim()}"`)
})

const format = (ms: number): string => (ms >= 1 ? `${ms.toFixed(2)}ms` : `${(ms * 1000).toFixed(0)}µs`).padStart(9)

// One round: both libraries, the first alternating between rounds.
const round = Effect.fn("round")(function* (index: number, n: number) {
  const first: LibName = n % 2 === 0 ? "prosemirror" : "core"
  const a = yield* spawn(first, index)
  const b = yield* spawn(first === "core" ? "prosemirror" : "core", index)
  return first === "core" ? { core: a, prosemirror: b } : { core: b, prosemirror: a }
})

const measure = Effect.fn("measure")(function* (name: string, index: number, rounds: number) {
  const runs = yield* Effect.forEach(
    Arr.makeBy(rounds, (n) => n),
    (n) => round(index, n),
    { concurrency: 1 }
  )
  const pm = median(runs.map((r) => r.prosemirror))
  const ours = median(runs.map((r) => r.core))
  yield* Console.log(`${name.padEnd(90)} prosemirror ${format(pm)}  core ${format(ours)}  ${(ours / pm).toFixed(2)}×`)
})

const coordinator = Effect.fn("coordinator")(function* () {
  const rounds = yield* Config.Int("BENCH_ROUNDS").pipe(Config.withDefault(3))
  const filter = yield* Config.String("BENCH_FILTER").pipe(Config.withDefault(""))
  const selected = Arr.filter(
    workloads.map(([name], index) => ({ name, index })),
    ({ name }) => name.includes(filter)
  )
  yield* Console.log(`${selected.length} workloads, ${rounds} rounds, one process per library per round\n`)
  // One worker at a time: concurrent workers would compete for the CPU.
  yield* Effect.forEach(selected, ({ name, index }) => measure(name, index, rounds), {
    concurrency: 1,
    discard: true
  })
})

const [libArg, indexArg] = process.argv.slice(2)
const program = libArg === "core" || libArg === "prosemirror" ? worker(libArg, Number(indexArg)) : coordinator()

NodeRuntime.runMain(program.pipe(Effect.provide(NodeServices.layer)))
