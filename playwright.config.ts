import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  use: { baseURL: "http://localhost:5180", viewport: { width: 1440, height: 900 } },
  webServer: [
    { command: "node e2e/mock-llm.mjs", port: 9911, reuseExistingServer: true },
    { command: "pnpm dev", port: 5180, reuseExistingServer: true, timeout: 60_000 },
  ],
})
