import { playwright } from "@vitest/browser-playwright"
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          include: ["test/**/*.test.ts"],
          exclude: ["test/view/**", "test/browser/**", "test/**/*.browser.test.ts"],
          environment: "happy-dom",
          sequence: { concurrent: true }
        }
      },
      {
        optimizeDeps: {
          // Pre-bundle every dependency the tests import so a cold run does
          // not trigger a mid-run re-optimization (which reloads the page).
          include: [
            "effect",
            "effect/Cause",
            "effect/Context",
            "effect/Data",
            "effect/Effect",
            "effect/Equal",
            "effect/Exit",
            "effect/Hash",
            "effect/Layer",
            "effect/Option",
            "effect/PubSub",
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
          include: ["test/view/**/*.test.ts", "test/browser/**/*.test.ts", "test/**/*.browser.test.ts"],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({
              launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?
                { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } :
                {}
            }),
            instances: [{ browser: "chromium" }]
          }
        }
      }
    ]
  }
})
