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
import { kicadCliRouter } from "./routes/kicad-cli.js"
import { llmRouter } from "./routes/llm.js"
import { migrateRouter } from "./routes/migrate.js"
import { projectsRouter } from "./routes/projects.js"
import { libraryRouter } from "./routes/library.js"
import { partsRouter } from "./routes/parts.js"
import { memoryRouter } from "./routes/memory.js"
import { bugReportsRouter } from "./routes/bug-reports.js"
import { preferencesRouter } from "./routes/preferences.js"
import { settingsRouter } from "./routes/settings.js"
import { trashRouter, workspacesRouter } from "./routes/workspaces.js"
import { createAttachmentStore } from "./storage/attachments.js"
import type { ProjectStore } from "./storage/projects.js"
import type { GlobalMemoryStore } from "./storage/global-memory.js"
import type { BugReportStore } from "./storage/bug-reports.js"
import type { LibraryStore } from "./storage/library.js"
import type { PreferencesStore } from "./storage/preferences.js"
import type { SettingsStore } from "./storage/settings.js"
import type { WorkspaceStore } from "./storage/workspaces.js"

export interface AppDeps {
  auth: ReturnType<typeof createAuth>
  projects: ProjectStore
  settings: SettingsStore
  workspaces: WorkspaceStore
  preferences: PreferencesStore
  memory: GlobalMemoryStore
  library: LibraryStore
  bugs: BugReportStore
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

export function createApp({ auth, projects, settings, workspaces, preferences, memory, library, bugs }: AppDeps): express.Express {
  const app = express()
  const attachments = createAttachmentStore(projects)
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
    // Test-only (index.ts refuses JUST_CIRCUIT_E2E outside a loopback dev server): wipe stored data between E2E tests.
    app.post("/api/test/reset", auth.requireCsrfHeader, (_req, res, next) => {
      Promise.all(["workspaces", "trash", "settings.json", "preferences.json", "memory.md", "library", "bug-reports.json"].map((name) => rm(path.join(config.dataDir, name), { recursive: true, force: true })))
        .then(() => res.json({ success: true, data: null }), next)
    })
  }
  // Separate budgets: one preview render alone fires dozens of part lookups through the JLC proxy.
  // The JLC proxy is read-only and called by runframe without our CSRF header.
  app.get("/api/terminal/status", (_req, res) => {
    res.json({ success: true, data: { enabled: config.enableTerminal } })
  })
  app.use("/api/kicad-cli", kicadCliRouter())
  app.use("/api/jlc", rateLimit(config.jlcRateLimitPerMinute), jlcRouter())
  app.use("/api", auth.requireCsrfHeader)
  app.use("/api/llm", rateLimit(config.rateLimitPerMinute), express.json({ limit: config.maxBodyBytes }), llmRouter(settings, projects, attachments, bugs))
  app.use("/api/projects", express.json({ limit: PROJECT_BODY_LIMIT }), projectsRouter(projects, attachments))
  app.use("/api/workspaces", express.json({ limit: "16kb" }), workspacesRouter(workspaces))
  app.use("/api/trash", trashRouter(projects))
  // Room for one uploaded .kicad_mod (512 KB of text); everything else is a small JSON body.
  app.use("/api/parts", rateLimit(config.jlcRateLimitPerMinute), express.json({ limit: "600kb" }), partsRouter(attachments))
  app.use("/api/library", express.json({ limit: PROJECT_BODY_LIMIT }), libraryRouter(library))
  app.use("/api/memory", express.json({ limit: "64kb" }), memoryRouter(memory))
  app.use("/api/bug-reports", rateLimit(config.rateLimitPerMinute), express.json({ limit: "64kb" }), bugReportsRouter(bugs))
  app.use("/api/preferences", express.json({ limit: "16kb" }), preferencesRouter(preferences))
  app.use("/api/settings", express.json({ limit: "1mb" }), settingsRouter(settings))
  app.use("/api/migrate", express.json({ limit: MIGRATION_BODY_LIMIT }), migrateRouter(projects, settings))
  app.use("/api", (_req, res) => {
    res.status(404).json({ success: false, error: "Endpoint tidak ditemukan" })
  })

  if (config.isProduction) serveClient(app)

  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    // Body parser errors (too large, malformed JSON) are the client's fault and carry their status.
    const status = (error as { status?: unknown }).status
    if (typeof status === "number" && status >= 400 && status < 500 && !res.headersSent) {
      res.status(status).json({ success: false, error: status === 413 ? "Data terlalu besar" : "Permintaan tidak valid" })
      return
    }
    logger.error("unhandled error", { error: errorMessage(error) })
    void bugs
      .record({ source: "server", title: `Error tak tertangani: ${errorMessage(error)}`, details: error instanceof Error ? (error.stack ?? "") : "", context: { where: `${req.method} ${req.baseUrl}${req.route?.path ?? ""}` } })
      .catch(() => undefined)
    if (!res.headersSent) res.status(500).json({ success: false, error: "Terjadi kesalahan di server" })
  })
  return app
}
