// The benchmark workloads (workloads.ts) double as a conformance
// suite: each one, run on the core and on ProseMirror itself, must end in
// the same document. A workload that drifts here also stops measuring like
// for like in `vp run bench`.
import { assert, describe, it } from "@effect/vitest"
import { core } from "./core.ts"
import { prosemirror } from "./prosemirror.ts"
import { workloads } from "./workloads.ts"

describe("complex workloads", () => {
  it.each(workloads)(
    "%s",
    (_name, run) => {
      assert.deepStrictEqual(core.toJSON(run(core)), prosemirror.toJSON(run(prosemirror)))
    },
    60_000
  )
})
