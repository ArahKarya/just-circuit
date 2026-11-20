import { homedir } from "node:os"
import path from "node:path"

// Load .env when present (Node's built-in loader; real environment variables win).
try {
  process.loadEnvFile()
} catch {
  // No .env file: rely on the environment.
}

function readBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback
  return value.toLowerCase() === "true" || value === "1"
}

function readInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const isProduction = process.env.NODE_ENV === "production"
const host = process.env.HOST || (isProduction ? "0.0.0.0" : "127.0.0.1")
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"])

function expandHome(dir: string): string {
  return dir === "~" || dir.startsWith("~/") ? path.join(homedir(), dir.slice(1)) : dir
}

export const config = Object.freeze({
  port: readInt(process.env.API_PORT, 8787),
  /** Dev listens on loopback only; set HOST=0.0.0.0 to expose it. */
  host,
  /** True when only this machine can reach the server. */
  isLoopbackOnly: LOOPBACK_HOSTS.has(host),
  isProduction,
  /** Private/LAN LLM hosts (Ollama) are allowed in dev and blocked in production unless enabled. */
  allowPrivateLlmHosts: readBool(process.env.ALLOW_PRIVATE_LLM_HOSTS, !isProduction),
  rateLimitPerMinute: readInt(process.env.RATE_LIMIT_PER_MINUTE, 60),
  /** Part lookups made by the preview (each render can fire dozens). */
  jlcRateLimitPerMinute: readInt(process.env.JLC_RATE_LIMIT_PER_MINUTE, 1200),
  maxBodyBytes: "8mb",
  /** Hard cap for one AI reply; long circuits with reasoning models can take minutes. */
  upstreamTimeoutMs: 600_000,
  /** Agent runs build and search between model calls, so they get longer. */
  agentTimeoutMs: readInt(process.env.LLM_AGENT_TIMEOUT_MS, 900_000),
  /** Abort when the provider sends nothing (text or reasoning) for this long. */
  idleTimeoutMs: readInt(process.env.LLM_IDLE_TIMEOUT_MS, 120_000),
  /** Wait for the first chunk; proxies such as 9router may not forward a model's thinking. */
  firstChunkTimeoutMs: readInt(process.env.LLM_FIRST_CHUNK_TIMEOUT_MS, 300_000),
  /** Projects, chats, settings and sessions live here (one folder per project, tsci-compatible). */
  dataDir: path.resolve(expandHome(process.env.JUST_CIRCUIT_DATA_DIR || "~/just-circuit-data")),
  /** scrypt hash from `pnpm set-password`; empty disables login (allowed on loopback only). */
  passwordHash: process.env.JUST_CIRCUIT_PASSWORD_HASH ?? "",
  /** 32-byte key (hex or base64) for API keys at rest; generated into dataDir when empty. */
  secret: process.env.JUST_CIRCUIT_SECRET ?? "",
  /** Send the session cookie over HTTPS only (default in production). */
  cookieSecure: readBool(process.env.COOKIE_SECURE, isProduction),
  sessionTtlMs: readInt(process.env.SESSION_TTL_DAYS, 30) * 24 * 60 * 60 * 1000,
  loginRateLimitPerMinute: readInt(process.env.LOGIN_RATE_LIMIT_PER_MINUTE, 10),
  /** Extra Host names the server answers to (e.g. a Tailscale name); loopback names are always allowed. */
  allowedHosts: (process.env.JUST_CIRCUIT_ALLOWED_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean),
  /** In-browser terminal (a shell on this machine for the signed-in user). Off by default in production. */
  enableTerminal: readBool(process.env.ENABLE_TERMINAL, !isProduction),
  terminalShell: process.env.TERMINAL_SHELL || process.env.SHELL || "/bin/bash",
  maxTerminals: readInt(process.env.MAX_TERMINALS, 8),
  /** Enables POST /api/test/reset for the E2E suite. Never set this outside tests. */
  isE2e: process.env.JUST_CIRCUIT_E2E === "1",
})
