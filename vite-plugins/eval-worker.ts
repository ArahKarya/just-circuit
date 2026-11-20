import { createReadStream, readFileSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Plugin } from "vite"

/** @tscircuit/eval is a direct dependency, so pnpm links it at the project root. */
const PACKAGE_DIR = fileURLToPath(new URL("../node_modules/@tscircuit/eval/", import.meta.url))

function entrypointPath(): string {
  return join(PACKAGE_DIR, "dist", "webworker", "entrypoint.js")
}

/** Version of the installed @tscircuit/eval, matching the runframe build we ship. */
export function evalVersion(): string {
  return (JSON.parse(readFileSync(join(PACKAGE_DIR, "package.json"), "utf8")) as { version: string }).version
}

/** Public path of the bundled eval worker; the version in the name busts caches on upgrade. */
export function evalWorkerUrl(): string {
  return `/vendor/tscircuit-eval-${evalVersion()}.js`
}

/**
 * Serves the tscircuit eval web worker from this app instead of a CDN's "latest",
 * so previews work offline and always match the installed runframe.
 */
export function evalWorkerPlugin(): Plugin {
  const url = evalWorkerUrl()
  return {
    name: "just-circuit-eval-worker",
    configureServer(server) {
      server.middlewares.use(url, (_req, res) => {
        res.setHeader("Content-Type", "text/javascript; charset=utf-8")
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable")
        createReadStream(entrypointPath())
          .on("error", (error) => {
            server.config.logger.error(`eval worker: ${error.message}`)
            if (!res.headersSent) res.statusCode = 500
            res.end()
          })
          .pipe(res)
      })
    },
    async generateBundle() {
      this.emitFile({ type: "asset", fileName: url.slice(1), source: await readFile(entrypointPath()) })
    },
  }
}
