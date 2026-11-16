import express, { type NextFunction, type Request, type Response } from "express"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { config } from "./config.js"
import { errorMessage, logger } from "./logger.js"
import { rateLimit } from "./middleware/rate-limit.js"
import { jlcRouter } from "./routes/jlc.js"
import { llmRouter } from "./routes/llm.js"

const DIST_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist")

function serveClient(app: express.Express): void {
  if (!existsSync(DIST_DIR)) {
    logger.warn("dist/ not found, run `pnpm build` before `pnpm start`")
    return
  }
  app.use(express.static(DIST_DIR, { index: false, maxAge: "1h" }))
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api/")) return next()
    res.sendFile(path.join(DIST_DIR, "index.html"))
  })
}

export function createApp(): express.Express {
  const app = express()
  app.disable("x-powered-by")
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff")
    res.setHeader("Referrer-Policy", "same-origin")
    res.setHeader("X-Frame-Options", "SAMEORIGIN")
    next()
  })
  app.set("trust proxy", "loopback")

  app.get("/api/health", (_req, res) => {
    res.json({ success: true, data: { status: "ok", allowPrivateLlmHosts: config.allowPrivateLlmHosts } })
  })
  // Separate budgets: one preview render alone fires dozens of part lookups through the JLC proxy.
  app.use("/api/jlc", rateLimit(config.jlcRateLimitPerMinute), jlcRouter())
  app.use("/api/llm", rateLimit(config.rateLimitPerMinute), express.json({ limit: config.maxBodyBytes }), llmRouter())
  app.use("/api", (_req, res) => {
    res.status(404).json({ success: false, error: "Endpoint tidak ditemukan" })
  })

  if (config.isProduction) serveClient(app)

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    logger.error("unhandled error", { error: errorMessage(error) })
    if (!res.headersSent) res.status(500).json({ success: false, error: "Terjadi kesalahan di server" })
  })
  return app
}
