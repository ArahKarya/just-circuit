import { execFile } from "node:child_process"
import { Router } from "express"

function detectKicadCli(): Promise<{ available: boolean; version: string | null }> {
  return new Promise((resolve) => {
    execFile("kicad-cli", ["--version"], { timeout: 2_000 }, (error, stdout) => {
      if (error) {
        resolve({ available: false, version: null })
        return
      }
      const version = stdout.trim().split("\n")[0] || null
      resolve({ available: true, version })
    })
  })
}

let cached: Promise<{ available: boolean; version: string | null }> | null = null

/** Read-only status endpoint reporting whether native `kicad-cli` is installed on the host. */
export function kicadCliRouter(): Router {
  const router = Router()
  router.get("/status", (_req, res) => {
    cached ??= detectKicadCli()
    void cached.then((data) => res.json({ success: true, data }))
  })
  return router
}
