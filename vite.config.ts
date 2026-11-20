import { recommended } from "@effect/tsgo/oxlint-presets"
import effect from "@enfect/oxlint"
import * as R from "effect/Record"
import { defineConfig } from "vite-plus"
import { playwright } from "vite-plus/test/browser-playwright"

const srcDir = new URL("./src/", import.meta.url).pathname

/**
 * The public entry points: `src/<entry>.ts` → `dist/<entry>.js`. A new entry
 * is added here, to `exports` in package.json and to `entry` in
 * .fallowrc.json.
 */
const entries = [
  "commands",
  "dropcursor",
  "extensions",
  "gapcursor",
  "history",
  "html",
  "inputrules",
  "keymap",
  "markdown",
  "model",
  "placeholder",
  "reactive",
  "schema-basic",
  "schema-list",
  "state",
  "test-builder",
  "transform",
  "view",
  "view-css",
  "compat/commands",
  "compat/keymap",
  "compat/model",
  "compat/orderedmap",
  "compat/schema-basic",
  "compat/schema-list",
  "compat/state",
  "compat/test-builder",
  "compat/transform",
  "compat/view"
]

/**
 * Input fingerprint for the cached tasks: auto tracking minus node_modules
 * bookkeeping churn (pnpm rewrites `.modules.yaml` on every install), with
 * the lockfile back explicitly so a dependency upgrade still invalidates a
 * type-check or a test run.
 */
const cacheInputs = [{ auto: true }, "!node_modules/**", "!docs/api/**", "!coverage/**", "pnpm-lock.yaml"]

const testEnv = ["VITEST_MAX_WORKERS", "NODE_OPTIONS", "PLAYWRIGHT_CHROMIUM_EXECUTABLE"]

// Spread into `test` below: `undefined` leaves vitest's `maxWorkers` unset,
// which `exactOptionalPropertyTypes` does not allow an explicit `undefined` for.
const maxWorkers =
  process.env.VITEST_MAX_WORKERS === undefined ? undefined : { maxWorkers: Number(process.env.VITEST_MAX_WORKERS) }
const chromium = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE

export default defineConfig({
  // Lint without `--fix`: tsgolint's type-assertion autofixes can break the
  // `check` task's tsc. CSS, JSON and Markdown are only formatted (a lint pass
  // with no lintable file fails).
  staged: {
    "*.{js,ts}": ["vp check --fix --no-lint", "vp check --no-fmt"],
    "*.{css,json,md}": "vp check --fix --no-lint"
  },
  fmt: {
    semi: false,
    trailingComma: "none",
    printWidth: 120,
    arrowParens: "always",
    ignorePatterns: ["**/dist/**", "**/docs/api/**", "**/coverage/**", "CHANGELOG.md"],
    overrides: [
      {
        files: ["**/*.md"],
        options: {
          proseWrap: "never"
        }
      }
    ]
  },
  lint: {
    ignorePatterns: ["**/dist/**", "**/docs/api/**", "**/coverage/**", "**/node_modules/**"],
    extends: [recommended, effect.configs.recommended],
    plugins: ["typescript", "unicorn", "oxc", "import", "promise", "vitest", "jsdoc"],
    categories: {
      correctness: "error",
      suspicious: "error",
      perf: "error"
    },
    rules: {
      "eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_"
        }
      ],
      "eslint/prefer-const": "warn",
      "eslint/no-console": "error",
      "typescript/consistent-type-imports": "error",
      // Fires on every `as`, including the narrowings the DOM types require;
      // casts are covered by the two assertion rules below.
      "effect/casting-awareness": "off",
      // Not adopted yet: the code imports Effect modules under their full names.
      "effect/prefer-namespace-imports": "off",

      // ---- Allowances for the ported ProseMirror code ----------------------
      // `warn`, with the site count when added: a new site is a defect, not
      // headroom. Lower the count as sites go; delete the line at zero.
      "effect/avoid-non-null-assertion": "warn", // 1295
      "effect/require-safety-comment-for-type-assertion": "warn", // 991
      "effect/prefer-option-over-null": "warn", // 989
      "effect/imperative-loops": "warn", // 599
      "effect/avoid-any": "warn", // 423
      "effect/no-runtime-typeof": "warn", // 77
      "effect/no-unsafe-dictionary-type": "warn", // 73
      "effect/no-unknown-parameters": "warn", // 59
      "effect/prefer-effect-is": "warn", // 50
      "effect/avoid-object-type": "warn", // 33
      "effect/no-known-value-widening": "warn", // 36
      "effect/no-chained-type-assertions": "warn", // 9
      "effect/use-clock-service": "warn", // 20
      "effect/no-unknown-returns": "warn", // 22
      // The ported suites shadow the test-builder's `doc` / `schema`.
      "eslint/no-shadow": "warn", // 314
      // ---- Type-aware allowances (same rules as above) ---------------------
      // tsgolint's "unnecessary" verdict differs from the `check` task's tsc,
      // so remove those sites by hand, against `vp run check`, never by autofix.
      "typescript/no-unsafe-type-assertion": "warn", // 861
      "typescript/no-unnecessary-type-assertion": "warn", // 685
      "typescript/no-unnecessary-type-arguments": "warn", // 54
      "effecttsgo/any-unknown-in-error-context": "warn", // 51
      "typescript/unbound-method": "warn", // 43
      "effecttsgo/unsafe-effect-type-assertion": "warn", // 1
      // `@effect/tsgo`'s preset warns on these; they have no sites left.
      "effecttsgo/unnecessary-fail-yieldable-error": "error",
      "effecttsgo/lazy-effect": "error",
      "effecttsgo/flat-map-conditional-to-filter-or-fail": "error",
      "effecttsgo/try-catch-in-effect-gen": "error",
      "effecttsgo/prefer-succeed-some-or-none": "error",
      "effecttsgo/prefer-typed-schema-decoder": "error",
      "effecttsgo/provide-layer-succeed-to-provide-service": "error",
      "effecttsgo/strict-effect-provide": "error",
      "typescript/no-unnecessary-type-parameters": "error",
      // Covered by `effect/avoid-any` (an allowance above).
      "typescript/no-explicit-any": "off",
      "typescript/no-empty-object-type": "off",
      "typescript/ban-ts-comment": "off",
      "unicorn/no-empty-file": "off",
      // Contradicts two conventions this repo cannot drop: the `_`-prefixed
      // intentionally-unused bindings `eslint/no-unused-vars` allows (the
      // type-level tests are built from them), and the `_`-prefixed internals
      // and `__`-prefixed exports (`__parseFromClipboard`, `_props`, …) the
      // compat facade must mirror exactly from ProseMirror.
      "eslint/no-underscore-dangle": "off",
      // Every `.reverse()` here reverses an array the function has just built
      // (ProseMirror's history, content-match and view algorithms, run per
      // keystroke): `toReversed()` would copy it again, and needs the ES2023
      // lib that the es2022 target does not include.
      "unicorn/no-array-reverse": "off",
      "vite-plus/prefer-vite-plus-imports": "error",
      "effecttsgo/schema-number": "error",
      // The ported ProseMirror suites assert through `ist` (tests/utils/ist.ts),
      // `@effect/vitest`'s `assert`, and per-suite helpers that wrap them
      // (`testTransform`, `same`, …).
      "vitest/expect-expect": [
        "error",
        {
          assertFunctionNames: [
            "expect",
            "assert",
            "assert.*",
            "ist",
            "getSome",
            "add",
            "apply",
            "bad",
            "badEffect",
            "between",
            "cmd",
            "del",
            "expectTags",
            "fill",
            "fill3",
            "ins",
            "invalid",
            "isAt",
            "lift",
            "no",
            "parse",
            "parseWith",
            "recover",
            "rem",
            "repl",
            "rm",
            "roundTrip",
            "rpl",
            "same",
            "serialize",
            "set",
            "setStr",
            "testDel",
            "testMapping",
            "testStepJSON",
            "testTransform",
            "valid",
            "wrap",
            "yes",
            "compress",
            "compose",
            "cut",
            "join",
            "split",
            "from",
            "start",
            "end",
            "type",
            "markup",
            "t",
            "test",
            "unsyncedComplex",
            "open",
            "find",
            "addInAddmark",
            "addInAddnodemark",
            "delInDelete",
            "delInDeleterange",
            "replInReplace",
            "replInReplacerange",
            "replInReplacerangewith",
            "setInSetnodeattribute",
            "setInSetdocattribute",
            "typeInSetBlockType",
            "yesInCansplit",
            "noInCansplit",
            "yesInLifttarget",
            "noInLifttarget",
            "yesInFindwrapping",
            "noInFindwrapping"
          ]
        }
      ],
      // `@category` is Effect's doc tag (with `@since`), required on every export.
      "jsdoc/check-tag-names": ["error", { definedTags: ["category"] }]
    },
    overrides: [
      // Evaluated by Vite in bare Node, before any Effect runtime exists.
      {
        files: ["vite.config.ts"],
        rules: {
          "effect/avoid-process-env": "off"
        }
      },
      // Type-level tests: the expect-error directives ARE the assertions
      // (a statement that must fail to compile), and every binding exists to
      // be asserted against, never to be read.
      {
        files: ["tests/**/*.types.ts"],
        rules: {
          "eslint/no-unused-vars": "off",
          "effect/avoid-ts-ignore": "off",
          // `Expect<Equals<keyof X, never>>` asserts an empty key set; the
          // empty object type is the assertion, not a mistake.
          "typescript/no-generated-empty-object-type": "off"
        }
      },
      // The compat facade links facades to core objects and walks
      // prototype chains by reflection (`link`, `adopt`, `getterOf`): any
      // object or prototype is a valid argument, so there is no owner type
      // to name in place of `object`.
      {
        files: ["src/compat/internal/core.ts", "src/compat/state.ts"],
        rules: {
          "effect/no-object-parameters": "off"
        }
      },
      // These ported prosemirror-state suites assert that `JSON.stringify`
      // calls an `EditorState`'s `toJSON` correctly ("supports
      // JSON.stringify toJSON arguments"): the platform call is the thing
      // under test, so there is no Schema codec to use in its place.
      {
        files: ["tests/state/state.test.ts", "tests/compat/state/state.test.ts"],
        rules: {
          "effect/avoid-direct-json": "off"
        }
      },
      // The benchmarks are an entry point and a harness: tests/bench/run.ts
      // provides its platform layer where it runs the program, and the core
      // adapter runs each command synchronously (as tests/commands/apply.ts
      // does) so that it is timed like ProseMirror's.
      {
        files: ["tests/bench/run.ts", "tests/bench/core.ts"],
        rules: {
          "effecttsgo/strict-effect-provide": "off",
          "effect/effect-run-in-body": "off"
        }
      },
      // These helpers serialize or render any value at all (JSON encoding
      // through `Schema.Unknown`, assertion messages, `ist`'s truthiness
      // check): `unknown` is their domain, and the type parameter it
      // replaced (`typescript/no-unnecessary-type-parameters`) only hid that.
      {
        files: ["src/internal/json.ts", "tests/utils/json.ts", "tests/utils/ist.ts"],
        rules: {
          "effect/no-unknown-parameters": "off"
        }
      },
      // `Equals` is the standard exact-type-equality test: comparing two
      // generic signatures whose `T` appears only in the deferred
      // conditional is what makes it strict (`any` is not `unknown`), so the
      // single use is the point, not a removable parameter.
      {
        files: ["tests/utils/types.ts"],
        rules: {
          "typescript/no-unnecessary-type-parameters": "off"
        }
      },
      // Synchronous code at a non-Effect edge, where `try` is the only tool:
      // the view guards browser APIs that throw unpredictably and restores
      // DOM or view state in `finally` (per keystroke, ported); the compat
      // facade turns core errors into ProseMirror's exceptions; and these
      // ported suites restore patched globals or injected CSS in `finally`.
      {
        files: [
          "src/view/clipboard.ts",
          "src/view/dom.ts",
          "src/view/domcoords.ts",
          "src/view/selection.ts",
          "src/view/view.ts",
          "src/view/viewdesc.ts",
          "src/compat/internal/core.ts",
          "src/compat/state.ts",
          "src/compat/test-builder.ts",
          "src/compat/transform.ts",
          "src/compat/view.ts",
          "tests/view/compat-bridge.test.ts",
          "tests/view/compat-selection.test.ts",
          "tests/view/dropcursor.test.ts",
          "tests/view/gapcursor.test.ts",
          "tests/view/inputrules.test.ts",
          "tests/view/placeholder.test.ts",
          "tests/view/selection.test.ts"
        ],
        rules: {
          "effect/avoid-try-catch": "off"
        }
      },
      // Synchronous adapters between Effect commands and the ported
      // ProseMirror suites, which call commands and read their results
      // inline; and the README example's program entry point.
      {
        files: [
          "tests/commands/apply.ts",
          "tests/commands/commands.test.ts",
          "tests/compat/bridge.test.ts",
          "tests/history/history.test.ts",
          "tests/inputrules/inputrules.test.ts",
          "tests/keymap/keymap.test.ts",
          "tests/model/dom.test.ts",
          "tests/state/state.ts",
          "tests/view/inputrules.test.ts",
          "tests/readme-example.types.ts"
        ],
        rules: {
          "effect/effect-run-in-body": "off"
        }
      },
      // `new StepMap([])` returns the shared `StepMap.empty`, as in
      // ProseMirror: a constructor that returns an object on one path and
      // nothing on the other is how JavaScript does that, and the compat
      // facade can observe the identity.
      {
        files: ["src/transform/map.ts"],
        rules: {
          "typescript/consistent-return": "off"
        }
      },
      // Effect marks all of `@effect/vitest` (the mandated test API) and
      // `effect/process` unstable; there is no stable API to move to.
      {
        files: ["tests/**/*.ts"],
        rules: {
          "eslint/no-console": "off",
          "effecttsgo/unstable-api-usage": "off"
        }
      }
    ],
    // tsgolint reads each file's nearest tsconfig.json: tests/tsconfig.json
    // gives the suites tsconfig.test.json's `paths`.
    options: {
      typeAware: true,
      typeCheck: true
    },
    jsPlugins: [
      {
        name: "vite-plus",
        specifier: "vite-plus/oxlint-plugin"
      }
    ]
  },
  run: {
    tasks: {
      // Everything ci.yml runs. The gates run in a nested `vp run` so they can
      // be limited to two at a time (the type gate and the suites together
      // exhaust a CI runner's memory).
      ci: {
        command: "vp run --concurrency-limit 2 ci:gates",
        dependsOn: ["node:released", "lint"],
        cache: false
      },
      "ci:gates": {
        command: "echo 'ci: all gates green'",
        dependsOn: ["check", "test:unit", "test:browser", "docgen", "ci:audit"],
        cache: false
      },
      // Fails on a pre-release Node, which the matrix's `latest` must never be.
      "node:released": {
        command:
          "node -e \"console.log('Node ' + process.version); if (process.version.includes('-')) { console.error('pre-release Node ' + process.version); process.exit(1) }\"",
        cache: false
      },
      lint: { command: "vp check", cache: false },
      "ci:audit": { command: "pnpm audit --audit-level high", cache: false },
      // Skipped when `PLAYWRIGHT_CHROMIUM_EXECUTABLE` names an installed
      // Chromium; `--with-deps` (sudo) only on CI.
      "browser:install": {
        command:
          "bash -c '[ -n \"${PLAYWRIGHT_CHROMIUM_EXECUTABLE:-}\" ] || playwright install ${CI:+--with-deps} chromium'",
        cache: false
      },
      fallow: { command: "vp exec fallow --summary", cache: false },
      // The pre-commit gate: fails only on findings the change introduces. It
      // reads the coverage map for its CRAP scores.
      "fallow:audit": {
        command: "vp exec fallow audit --base origin/trunk --quiet",
        dependsOn: ["test:coverage"],
        cache: false
      },
      // tsconfig.test.json also covers the type-level `tests/**/*.types.ts`.
      check: {
        command: "tsc -p tsconfig.json && tsc -p tsconfig.test.json",
        cache: { input: cacheInputs, output: [] }
      },
      build: {
        command: "vp pack",
        cache: { input: cacheInputs, output: ["dist/**"] }
      },
      "test:unit": {
        command: "vp test run --project node",
        cache: { env: testEnv, input: cacheInputs, output: [] }
      },
      "test:browser": {
        command: "vp test run --project browser",
        dependsOn: ["browser:install"],
        cache: { env: testEnv, input: cacheInputs, output: [] }
      },
      // Both projects under one Istanbul map, coverage/coverage-final.json.
      "test:coverage": {
        command: "vp test run --coverage",
        dependsOn: ["browser:install"],
        cache: { env: testEnv, input: cacheInputs, output: ["coverage/**"] }
      },
      // Resolves the package through `exports` to the built `dist/`.
      bench: {
        command: "vpx --tsconfig tsconfig.base.json tests/bench/run.ts",
        dependsOn: ["build"],
        cache: false
      },
      // Runs every JSDoc example against `dist/`; fails if docgen finds none.
      docgen: {
        command: "bash -o pipefail -c 'docgen 2>&1 | tee /dev/stderr | { ! grep -q \"No examples found\"; }'",
        dependsOn: ["build"],
        cache: { input: cacheInputs, output: ["docs/api/**"] }
      }
    }
  },
  // One output file per source module: package.json's `sideEffects` list
  // names the modules whose top-level statements register things.
  pack: {
    entry: R.fromEntries(entries.map((entry) => [entry, `src/${entry}.ts`])),
    unbundle: true,
    format: "esm",
    platform: "neutral",
    dts: true,
    outDir: "dist",
    clean: true
  },
  resolve: {
    // Tests import the package by name; resolve it to `src/`, not `dist/`.
    alias: [{ find: /^@thomasfosterau\/effect-richtext\/(.+)$/, replacement: `${srcDir}$1.ts` }]
  },
  test: {
    ...maxWorkers,
    coverage: {
      provider: "istanbul",
      reporter: ["text-summary", "json-summary", "json"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: ["**/*.d.ts"]
    },
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/view/**", "tests/**/*.browser.test.ts"],
          environment: "happy-dom",
          sequence: { concurrent: true }
        }
      },
      {
        extends: true,
        optimizeDeps: {
          // Pre-bundle every dependency the tests import so a cold run does
          // not trigger a mid-run re-optimization (which reloads the page).
          include: [
            "effect",
            "effect/Array",
            "effect/Cause",
            "effect/Context",
            "effect/Data",
            "effect/Deferred",
            "effect/Effect",
            "effect/Equal",
            "effect/Exit",
            "effect/Fiber",
            "effect/Hash",
            "effect/HashMap",
            "effect/HashSet",
            "effect/Layer",
            "effect/Match",
            "effect/Number",
            "effect/Option",
            "effect/Order",
            "effect/Predicate",
            "effect/PubSub",
            "effect/Result",
            "effect/Scheduler",
            "effect/Schema",
            "effect/SchemaGetter",
            "effect/SchemaIssue",
            "effect/Scope",
            "effect/Semaphore",
            "effect/Stream",
            "effect/SubscriptionRef",
            "@effect/vitest",
            "markdown-it",
            "rope-sequence",
            "w3c-keyname"
          ]
        },
        test: {
          name: "browser",
          include: ["tests/view/**/*.test.ts", "tests/**/*.browser.test.ts"],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({
              launchOptions: chromium === undefined ? {} : { executablePath: chromium }
            }),
            instances: [{ browser: "chromium" }]
          }
        }
      }
    ]
  }
})
