import { mkdir } from "node:fs/promises"
import { createApp } from "./app.js"
import { createAuth } from "./auth/auth.js"
import { createSessionStore } from "./auth/sessions.js"
import { config } from "./config.js"
import { logger } from "./logger.js"
import { isPasswordHash } from "./security/password.js"
import { createSecretBox, loadSecretKey } from "./security/secret-box.js"
import { createProjectStore, TRASH_RETENTION_MS } from "./storage/projects.js"
import { createGlobalMemoryStore } from "./storage/global-memory.js"
import { createLibraryStore } from "./storage/library.js"
import { createPreferencesStore } from "./storage/preferences.js"
import { createSettingsStore } from "./storage/settings.js"
import { createWorkspaceStore } from "./storage/workspaces.js"
import { attachTerminalServer } from "./terminal/terminal-server.js"

function checkAuthConfig(): void {
  if (config.passwordHash && !isPasswordHash(config.passwordHash)) {
    logger.error("JUST_CIRCUIT_PASSWORD_HASH is not a valid hash; create one with `pnpm set-password`")
    process.exit(1)
  }
  // Without a password anyone who can reach the server can read projects and use the API keys.
  if (!config.passwordHash && !config.isLoopbackOnly) {
    logger.error("Refusing to listen on a non-loopback host without a password. Run `pnpm set-password` and set JUST_CIRCUIT_PASSWORD_HASH.", { host: config.host })
    process.exit(1)
  }
  // Production usually sits behind a tunnel or proxy, where "loopback" says nothing about who connects.
  if (!config.passwordHash && config.isProduction) {
    logger.error("Production needs a password. Run `pnpm set-password` and set JUST_CIRCUIT_PASSWORD_HASH.")
    process.exit(1)
  }
  if (config.isE2e && (config.isProduction || !config.isLoopbackOnly)) {
    logger.error("JUST_CIRCUIT_E2E=1 is for the local test server only")
    process.exit(1)
  }
}

checkAuthConfig()
await mkdir(config.dataDir, { recursive: true, mode: 0o700 })
const box = createSecretBox(await loadSecretKey(config.secret, config.dataDir))
const auth = createAuth({
  passwordHash: config.passwordHash,
  sessions: createSessionStore(config.dataDir, config.sessionTtlMs),
  cookieSecure: config.cookieSecure,
  loginRateLimitPerMinute: config.loginRateLimitPerMinute,
})
const projects = createProjectStore(config.dataDir)
const purged = await projects.purgeOlderThan(Date.now() - TRASH_RETENTION_MS)
if (purged > 0) logger.info("trash emptied", { purged })
const app = createApp({ auth, projects, settings: createSettingsStore(config.dataDir, box), workspaces: createWorkspaceStore(projects), preferences: createPreferencesStore(config.dataDir), memory: createGlobalMemoryStore(config.dataDir), library: createLibraryStore(config.dataDir) })

const server = app.listen(config.port, config.host, () => {
  logger.info("Just Circuit API listening", {
    host: config.host,
    port: config.port,
    production: config.isProduction,
    dataDir: config.dataDir,
    login: auth.isEnabled ? "password" : "off (loopback only)",
    terminal: config.enableTerminal,
    allowPrivateLlmHosts: config.allowPrivateLlmHosts,
  })
})

if (config.enableTerminal && !auth.isEnabled) {
  logger.warn("Terminal is on without a password: any program or user on this machine that can reach the port can open a shell. Set JUST_CIRCUIT_PASSWORD_HASH (pnpm set-password) on shared machines.")
}

attachTerminalServer(server, {
  enabled: config.enableTerminal,
  shell: config.terminalShell,
  maxSessions: config.maxTerminals,
  hostGuard: { allowedHosts: config.allowedHosts, allowAnyHost: auth.isEnabled && !config.isLoopbackOnly, loginDisabled: !auth.isEnabled },
  isSignedIn: auth.isSignedIn,
  projectDir: projects.pathOf,
})

function shutdown(signal: string): void {
  logger.info("shutting down", { signal })
  server.close(() => process.exit(0))
}

process.on("SIGINT", () => shutdown("SIGINT"))
process.on("SIGTERM", () => shutdown("SIGTERM"))
