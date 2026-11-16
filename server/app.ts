import express, { type NextFunction, type Request, type Response } from "express"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { config } from "./config.js"
import { errorMessage, logger } from "./logger.js"
import { rm } from "node:fs/promises"
import type { createAuth } from "./auth/auth.js"
import { hostGuard } from "./middleware/host-guard.js"
import { rateLimit } from "./middleware/rate-limit.js"
import { jlcRouter } from "./routes/jlc.js"
import { llmRouter } from "./routes/llm.js"
import { migrateRouter } from "./routes/migrate.js"
import { projectsRouter } from "./routes/projects.js"
import { settingsRouter } from "./routes/settings.js"
import { trashRouter, workspacesRouter } from "./routes/workspaces.js"
import type { ProjectStore } from "./storage/projects.js"
import type { SettingsStore } from "./storage/settings.js"
import type { WorkspaceStore } from "./storage/workspaces.js"

export interface AppDeps {
  auth: ReturnType<typeof createAuth>
  projects: ProjectStore
  settings: SettingsStore
  workspaces: WorkspaceStore
}

/** Project files and chat snapshots can be large; the browser migration sends everything at once. */
const PROJECT_BODY_LIMIT = "16mb"
const MIGRATION_BODY_LIMIT = "64mb"

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

export function createApp({ auth, projects, settings, workspaces }: AppDeps): express.Express {
  const app = express()
  app.disable("x-powered-by")
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff")
    res.setHeader("Referrer-Policy", "same-origin")
    res.setHeader("X-Frame-Options", "SAMEORIGIN")
    next()
  })
  app.set("trust proxy", "loopback")
  app.use(hostGuard({ allowedHosts: config.allowedHosts, allowAnyHost: auth.isEnabled && !config.isLoopbackOnly, loginDisabled: !auth.isEnabled }))

  app.get("/api/health", (_req, res) => {
    res.json({ success: true, data: { status: "ok", allowPrivateLlmHosts: config.allowPrivateLlmHosts } })
  })
  app.use("/api/auth", auth.requireCsrfHeader, auth.router())

  // Everything below needs a session (when a password is set).
  app.use("/api", auth.requireSession)
  if (config.isE2e) {
    // Test-only (index.ts refuses CDS_E2E outside a loopback dev server): wipe stored data between E2E tests.
    app.post("/api/test/reset", auth.requireCsrfHeader, (_req, res, next) => {
      Promise.all(["workspaces", "trash", "settings.json"].map((name) => rm(path.join(config.dataDir, name), { recursive: true, force: true })))
        .then(() => res.json({ success: true, data: null }), next)
    })
  }
  // Separate budgets: one preview render alone fires dozens of part lookups through the JLC proxy.
  // The JLC proxy is read-only and called by runframe without our CSRF header.
  app.use("/api/jlc", rateLimit(config.jlcRateLimitPerMinute), jlcRouter())
  app.use("/api", auth.requireCsrfHeader)
  app.use("/api/llm", rateLimit(config.rateLimitPerMinute), express.json({ limit: config.maxBodyBytes }), llmRouter(settings))
  app.use("/api/projects", express.json({ limit: PROJECT_BODY_LIMIT }), projectsRouter(projects))
  app.use("/api/workspaces", express.json({ limit: "16kb" }), workspacesRouter(workspaces))
  app.use("/api/trash", trashRouter(projects))
  app.use("/api/settings", express.json({ limit: "1mb" }), settingsRouter(settings))
  app.use("/api/migrate", express.json({ limit: MIGRATION_BODY_LIMIT }), migrateRouter(projects, settings))
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
