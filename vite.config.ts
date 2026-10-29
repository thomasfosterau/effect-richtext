/**
 * The one Vite+ configuration for this single-package repository: the
 * format / lint / staged passes (read statically by `vp fmt` / `vp lint` /
 * `vp staged`), the task graph (`check`, `build`, `test:unit`,
 * `test:browser`, `test:coverage`, `docgen`), the `vp pack` (tsdown)
 * settings, and the two vitest projects (`node` under happy-dom, `browser` in
 * real Chromium).
 *
 * Shaped after the effect-web library's root config and `vite.package.ts`:
 * every comment that explains a load-bearing decision travels with the
 * config.
 *
 * @copyright Thomas Foster
 */

import { recommended } from "@effect/tsgo/oxlint-presets"
import effect from "@mpsuesser/oxlint-plugin-effect"
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
const cacheInputs = [{ auto: true }, "!node_modules/**", "!docs/**", "!coverage/**", "pnpm-lock.yaml"]

const testEnv = ["VITEST_MAX_WORKERS", "NODE_OPTIONS", "PLAYWRIGHT_CHROMIUM_EXECUTABLE"]

const maxWorkers = process.env.VITEST_MAX_WORKERS
const chromium = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE

export default defineConfig({
  // Staged-file checks run by `vp staged` (pre-commit).
  staged: {
    "*.{js,ts,css,json,md}": "vp check --fix"
  },
  // The repo's own style, carried over from its dprint config: no
  // semicolons, no trailing commas, 120 columns.
  fmt: {
    semi: false,
    trailingComma: "none",
    printWidth: 120,
    arrowParens: "always",
    ignorePatterns: ["**/dist/**", "**/docs/**", "**/coverage/**", "CHANGELOG.md"],
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
    ignorePatterns: ["**/dist/**", "**/docs/**", "**/coverage/**", "**/node_modules/**"],
    extends: [recommended, effect.configs.recommended],
    categories: {
      correctness: "error"
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
      // `casting-awareness` is an awareness prompt, not a defect rule — it
      // fires on every `as`, including the narrowings the DOM types
      // structurally require. Stays visible as a warning.
      "effect/casting-awareness": "warn",
      // Hard-codes abbreviations (`Arr`, `P`, `R`, …) with no options, so it is
      // unsatisfiable under the full-name convention (`import { Effect,
      // Option } from "effect"`) this library shares with its consumers.
      "effect/prefer-namespace-imports": "off",

      // ---- Effect preset: ported-code allowances ---------------------------
      // src/ is a port of ProseMirror's synchronous, performance-sensitive
      // algorithms (DESIGN.md) and tests/ ports its suites; both predate the
      // Effect oxlint preset. The rules below sit at `warn` so the port stays
      // committable while each site stays reported; a new site is a defect,
      // not headroom. The trailing number is the rule's site count when this
      // block was written; the remaining sites are tracked in
      // thomasfosterau/effect-richtext#3. Lower the count as sites are
      // fixed, and delete the line (back to the preset's `error`) when it
      // reaches zero.
      "effect/avoid-non-null-assertion": "warn", // 1315
      "effect/require-safety-comment-for-type-assertion": "warn", // 1051
      "effect/prefer-option-over-null": "warn", // 1010
      "effect/imperative-loops": "warn", // 608
      "effect/avoid-any": "warn", // 444
      "effect/no-runtime-typeof": "warn", // 77
      "effect/no-unsafe-dictionary-type": "warn", // 77
      "effect/no-unknown-parameters": "warn", // 59
      "effect/prefer-effect-is": "warn", // 50
      "effect/avoid-object-type": "warn", // 33
      "effect/no-known-value-widening": "warn", // 36
      "effect/effect-run-in-body": "warn", // 34
      "effect/avoid-try-catch": "warn", // 30
      "effect/no-chained-type-assertions": "warn", // 25
      "effect/use-clock-service": "warn", // 24
      "effect/no-unknown-returns": "warn", // 22
      "effect/yield-in-for-loop": "warn", // 18
      // The four left are EditorState's Effect twins of its synchronous
      // transaction methods; with `this` in place of `self` their bodies
      // become clones of the sync versions, so they wait on deduplicating
      // the twins.
      "typescript/no-this-alias": "warn", // 4
      "typescript/no-explicit-any": "off",
      "typescript/no-empty-object-type": "off",
      "typescript/ban-ts-comment": "off",
      "unicorn/no-empty-file": "off",
      "vite-plus/prefer-vite-plus-imports": "error"
    },
    overrides: [
      // Build/test configs are evaluated by Vite and Vitest in bare Node,
      // before any Effect runtime exists — there is no `Config` provider to
      // read from and no `FileSystem` service to call, so `process.env` and
      // `node:*` are the only things that work there. The Effect preset's
      // service rules have no satisfiable fix in these files.
      {
        files: ["vite.config.ts"],
        rules: {
          "effect/avoid-node-imports": "off",
          "effect/avoid-sync-fs": "off",
          "effect/avoid-process-env": "off",
          "effect/use-console-service": "off",
          "effect/use-filesystem-service": "off",
          "effect/use-path-service": "off",
          // `...(process.env.X ? { x } : {})` is how a vitest option is left
          // unset under `exactOptionalPropertyTypes`.
          "effect/no-conditional-empty-object-spread": "off"
        }
      },
      // Type-level tests: the expect-error directives ARE the assertions
      // (a statement that must fail to compile), and every binding exists to
      // be asserted against, never to be read.
      {
        files: ["tests/**/*.types.ts"],
        rules: {
          "eslint/no-unused-vars": "off",
          "effect/avoid-ts-ignore": "off"
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
      // Test fixtures are the seams under test, not domain code.
      {
        files: ["tests/**/*.ts"],
        rules: {
          "eslint/no-console": "off"
        }
      }
    ],
    // Type-aware linting is intentionally disabled: type checking stays the
    // `check` task's job (native tsc, Effect-patched).
    options: {
      typeAware: false,
      typeCheck: false
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
      // The type gate: `src` under the native, Effect-patched `tsc`, then the
      // tests (including the type-level `tests/*.types.ts`, whose
      // expect-error directives are the assertions) under tsconfig.test.json,
      // which resolves the package name to `src/` so no build is needed first.
      check: {
        command: "tsc -p tsconfig.json && tsc -p tsconfig.test.json",
        cache: { input: cacheInputs, output: [] }
      },
      // The published artifact (`vp pack` → tsdown, see `pack` below).
      build: {
        command: "vp pack",
        cache: { input: cacheInputs, output: ["dist/**"] }
      },
      "test:unit": {
        command: "vp test run --project node",
        cache: { env: testEnv, input: cacheInputs, output: [] }
      },
      // prosemirror-view's suites, in headless Chromium through Playwright.
      "test:browser": {
        command: "vp test run --project browser",
        cache: { env: testEnv, input: cacheInputs, output: [] }
      },
      // Both projects under one Istanbul coverage map
      // (`coverage/coverage-final.json`), which `fallow audit` reads for exact
      // per-function CRAP scores (`health.coverage` in .fallowrc.json).
      // Without it fallow estimates every function as uncovered, and any
      // function with cyclomatic complexity ≥ 5 fails the gate on its own.
      // Run this before `fallow audit` (the Claude Code PreToolUse hook
      // `.claude/hooks/fallow-gate.sh` runs the audit on `git commit` /
      // `git push` but never refreshes this map).
      "test:coverage": {
        command: "vp test run --coverage",
        cache: false
      },
      // Compiles AND RUNS every JSDoc `@example` (see docgen.json). Examples
      // import the package by name exactly as a consumer would, which
      // resolves through `exports` to `dist/` — hence the build edge.
      docgen: {
        command: "docgen",
        dependsOn: ["build"],
        cache: { input: cacheInputs, output: ["docs/**"] }
      }
    }
  },
  // One output file per source module (`unbundle`), the layout the old
  // `tsc -b` emit had: package.json's `sideEffects` list names the modules
  // whose top-level statements register things (`Selection.jsonID`, the
  // compat wrappers, the test-builder's `tag` getter), and that list only
  // stays true if those statements stay in those files.
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
    // Tests import the package by name, exactly as a consumer would (and as
    // tsconfig.test.json's `paths` type-checks them), so the runner resolves
    // that name to `src/` rather than to the built `dist/` that `exports`
    // points at — a test run never needs a build first.
    alias: [{ find: /^effect-richtext\/(.+)$/, replacement: `${srcDir}$1.ts` }]
  },
  test: {
    ...(maxWorkers === undefined ? {} : { maxWorkers: Number(maxWorkers) }),
    coverage: {
      provider: "istanbul",
      // `json` writes coverage-final.json, the Istanbul map `fallow audit`
      // reads.
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
          exclude: ["tests/view/**", "tests/browser/**", "tests/**/*.browser.test.ts"],
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
          include: ["tests/view/**/*.test.ts", "tests/browser/**/*.test.ts", "tests/**/*.browser.test.ts"],
          browser: {
            enabled: true,
            headless: true,
            // `PLAYWRIGHT_CHROMIUM_EXECUTABLE` points the provider at a
            // preinstalled Chromium (agent containers ship one under
            // /opt/pw-browsers); unset, Playwright uses its own download.
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
