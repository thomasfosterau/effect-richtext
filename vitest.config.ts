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
