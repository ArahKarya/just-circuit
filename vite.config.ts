/// <reference types="vitest/config" />
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { fileURLToPath } from "node:url"
import { evalVersion, evalWorkerPlugin, evalWorkerUrl } from "./vite-plugins/eval-worker.ts"

const API_PORT = Number(process.env.API_PORT ?? 8787)

export default defineConfig({
  plugins: [react(), tailwindcss(), evalWorkerPlugin()],
  define: { __EVAL_WORKER_URL__: JSON.stringify(evalWorkerUrl()), __EVAL_VERSION__: JSON.stringify(evalVersion()) },
  resolve: {
    alias: {
      "circuit-json-to-altium": fileURLToPath(new URL("./src/shims/circuit-json-to-altium.ts", import.meta.url)),
      "@resvg/resvg-js": fileURLToPath(new URL("./src/shims/resvg-js.ts", import.meta.url)),
    },
  },
  server: {
    port: 5180,
    proxy: { "/api": `http://127.0.0.1:${API_PORT}` },
  },
  worker: { format: "es" },
  // runframe bundles the whole tscircuit toolchain; large chunks are expected.
  build: { chunkSizeWarningLimit: 20_000 },
  test: { environment: "node", include: ["src/**/*.test.ts", "server/**/*.test.ts"] },
})
