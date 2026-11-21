import { execFile } from "node:child_process"
import { Router } from "express"

export interface KicadCliStatus {
  available: boolean
  version: string | null
}

/** How long a detection result is reused; installing or removing KiCad shows up after this. */
export const KICAD_CLI_STATUS_TTL_MS = 60_000
const DETECT_TIMEOUT_MS = 2_000

/** Runs `kicad-cli --version` with a fixed argv (no shell, no user input). */
export function detectKicadCli(): Promise<KicadCliStatus> {
  return new Promise((resolve) => {
    execFile("kicad-cli", ["--version"], { timeout: DETECT_TIMEOUT_MS }, (error, stdout) => {
      if (error) {
        resolve({ available: false, version: null })
        return
      }
      const version = stdout.trim().split("\n")[0] || null
      resolve({ available: true, version })
    })
  })
}

export interface KicadCliRouterOptions {
  detect?: () => Promise<KicadCliStatus>
  ttlMs?: number
  now?: () => number
}

/** Memoises `detect` for `ttlMs`; concurrent callers share one in-flight probe. */
export function cachedDetector({ detect = detectKicadCli, ttlMs = KICAD_CLI_STATUS_TTL_MS, now = Date.now }: KicadCliRouterOptions = {}): () => Promise<KicadCliStatus> {
  let cache: { at: number; value: Promise<KicadCliStatus> } | null = null
  return () => {
    if (cache && now() - cache.at < ttlMs) return cache.value
    const value = detect().catch((): KicadCliStatus => ({ available: false, version: null }))
    cache = { at: now(), value }
    return value
  }
}

/** Read-only status endpoint reporting whether native `kicad-cli` is installed on the host. */
export function kicadCliRouter(options: KicadCliRouterOptions = {}): Router {
  const router = Router()
  const status = cachedDetector(options)
  router.get("/status", async (_req, res) => {
    res.json({ success: true, data: await status() })
  })
  return router
}
