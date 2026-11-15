import { createApp } from "./app.js"
import { config } from "./config.js"
import { logger } from "./logger.js"

const server = createApp().listen(config.port, config.host, () => {
  logger.info("CDS API listening", { host: config.host, port: config.port, production: config.isProduction, allowPrivateLlmHosts: config.allowPrivateLlmHosts })
})

function shutdown(signal: string): void {
  logger.info("shutting down", { signal })
  server.close(() => process.exit(0))
}

process.on("SIGINT", () => shutdown("SIGINT"))
process.on("SIGTERM", () => shutdown("SIGTERM"))
