function readBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback
  return value.toLowerCase() === "true" || value === "1"
}

function readInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const isProduction = process.env.NODE_ENV === "production"

export const config = Object.freeze({
  port: readInt(process.env.API_PORT, 8787),
  /** Dev listens on loopback only; set HOST=0.0.0.0 to expose it. */
  host: process.env.HOST || (isProduction ? "0.0.0.0" : "127.0.0.1"),
  isProduction,
  /** Private/LAN LLM hosts (Ollama) are allowed in dev and blocked in production unless enabled. */
  allowPrivateLlmHosts: readBool(process.env.ALLOW_PRIVATE_LLM_HOSTS, !isProduction),
  rateLimitPerMinute: readInt(process.env.RATE_LIMIT_PER_MINUTE, 60),
  maxBodyBytes: "2mb",
  upstreamTimeoutMs: 120_000,
})
