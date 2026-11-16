import { defineConfig } from "@playwright/test"

/** E2E runs its own servers with a throwaway data dir, never the developer's ~/cds-data. */
const WEB_PORT = 5181
const API_PORT = 8788

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  expect: { timeout: 10_000 },
  // Tests share one server-side data dir and reset it before each test.
  workers: 1,
  use: { actionTimeout: 15_000, baseURL: `http://localhost:${WEB_PORT}`, viewport: { width: 1440, height: 900 } },
  webServer: [
    { command: "node e2e/mock-llm.mjs", port: 9911, reuseExistingServer: true },
    {
      command: "rm -rf .e2e-data && pnpm dev",
      port: WEB_PORT,
      reuseExistingServer: false,
      timeout: 90_000,
      env: { CDS_E2E: "1", CDS_DATA_DIR: ".e2e-data", API_PORT: String(API_PORT), VITE_PORT: String(WEB_PORT), CDS_PASSWORD_HASH: "" },
    },
  ],
})
