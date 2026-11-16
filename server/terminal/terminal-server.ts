import type { IncomingMessage, Server } from "node:http"
import type { Duplex } from "node:stream"
import { spawn, type IPty } from "node-pty"
import { WebSocketServer, type RawData, type WebSocket } from "ws"
import { z } from "zod"
import { logger } from "../logger.js"
import { hostProblem, type HostGuardOptions } from "../middleware/host-guard.js"

export const TERMINAL_PATH = "/api/terminal"
const MAX_MESSAGE_BYTES = 64 * 1024
const DEFAULT_SIZE = { cols: 100, rows: 30 }
/** Only these variables reach the shell: server secrets (.env, API keys, tokens) never do. */
const ENV_ALLOWLIST = new Set(["PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "TMPDIR", "EDITOR", "VISUAL", "PAGER", "TZ", "NVM_DIR", "BUN_INSTALL", "PNPM_HOME"])
const ENV_ALLOWED_PREFIXES = ["LC_", "XDG_"]
/** Pause the shell while this much output waits to be sent (slow tab, `yes`, huge logs). */
const MAX_BUFFERED_BYTES = 1024 * 1024
const RESUME_CHECK_MS = 50
/** Drop connections that stop answering pings (sleeping laptop, dead network). */
const HEARTBEAT_MS = 30_000

export interface TerminalServerOptions {
  enabled: boolean
  shell: string
  maxSessions: number
  hostGuard: HostGuardOptions
  isSignedIn: (req: Pick<IncomingMessage, "headers">) => Promise<boolean>
  /** Folder of a project; rejects for unknown ids. */
  projectDir: (projectId: string) => Promise<string>
}

/** Messages from the browser: keystrokes or a new terminal size. */
const clientMessage = z.discriminatedUnion("t", [
  z.object({ t: z.literal("i"), d: z.string().max(MAX_MESSAGE_BYTES) }),
  z.object({ t: z.literal("r"), c: z.number().int().min(2).max(500), r: z.number().int().min(2).max(300) }),
])

const sizeParams = z.object({
  cols: z.coerce.number().int().min(2).max(500).catch(DEFAULT_SIZE.cols),
  rows: z.coerce.number().int().min(2).max(300).catch(DEFAULT_SIZE.rows),
})

export function shellEnv(source: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue
    if (ENV_ALLOWLIST.has(key) || ENV_ALLOWED_PREFIXES.some((prefix) => key.startsWith(prefix))) env[key] = value
  }
  return { ...env, TERM: "xterm-256color", COLORTERM: "truecolor", LANG: env.LANG ?? "en_US.UTF-8" }
}

function reject(socket: Duplex, status: number, message: string): void {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${message}`)
  socket.destroy()
}

/** The page that opens the socket must come from this host (browsers always send Origin on WebSockets). */
export function isSameOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (!origin || !host) return false
  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase()
  } catch {
    return false
  }
}

function bridge(ws: WebSocket, pty: IPty, onClose: () => void): void {
  let closed = false
  let paused = false
  let alive = true
  const cleanup = () => {
    if (closed) return
    closed = true
    clearInterval(heartbeat)
    try {
      pty.kill()
    } catch {
      // Already gone.
    }
    onClose()
  }
  // Backpressure: stop reading the shell while the browser can't keep up.
  const resumeWhenDrained = () => {
    if (closed || !paused) return
    if (ws.bufferedAmount < MAX_BUFFERED_BYTES / 2) {
      paused = false
      pty.resume()
    } else {
      setTimeout(resumeWhenDrained, RESUME_CHECK_MS)
    }
  }
  const heartbeat = setInterval(() => {
    if (!alive) {
      ws.terminate()
      return
    }
    alive = false
    ws.ping()
  }, HEARTBEAT_MS)

  pty.onData((data) => {
    if (ws.readyState !== ws.OPEN) return
    ws.send(data)
    if (!paused && ws.bufferedAmount > MAX_BUFFERED_BYTES) {
      paused = true
      pty.pause()
      setTimeout(resumeWhenDrained, RESUME_CHECK_MS)
    }
  })
  pty.onExit(({ exitCode }) => {
    if (ws.readyState === ws.OPEN) ws.close(1000, `exit ${exitCode}`)
  })
  ws.on("pong", () => {
    alive = true
  })
  ws.on("message", (raw: RawData) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw.toString())
    } catch {
      return
    }
    const message = clientMessage.safeParse(parsed)
    if (!message.success) return
    try {
      if (message.data.t === "i") pty.write(message.data.d)
      else pty.resize(message.data.c, message.data.r)
    } catch {
      // The shell exited between the message and now; the close handler cleans up.
    }
  })
  // Oversized or malformed frames emit "error"; without a listener that would crash the server.
  ws.on("error", () => ws.terminate())
  ws.on("close", cleanup)
}

/** Serves shells over WebSocket at /api/terminal?project=<id>, one pty per connection. */
export function attachTerminalServer(server: Server, options: TerminalServerOptions): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES })
  let sessions = 0

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "/", "http://localhost")
    // Nothing else accepts upgrades here; close the socket instead of leaving it open.
    if (url.pathname !== TERMINAL_PATH) {
      socket.destroy()
      return
    }
    // Reserve the slot before any await so parallel upgrades can't exceed the limit.
    if (sessions >= options.maxSessions) return reject(socket, 429, "Terlalu banyak terminal terbuka")
    sessions += 1
    // The slot belongs to the socket until a shell takes it over; any failure closes the socket.
    let handedOver = false
    socket.once("close", () => {
      if (!handedOver) sessions -= 1
    })
    void (async () => {
      if (!options.enabled) return reject(socket, 403, "Terminal dimatikan (ENABLE_TERMINAL=false)")
      const problem = hostProblem(options.hostGuard, req.headers)
      if (problem) return reject(socket, problem.status, problem.error)
      if (!isSameOrigin(req.headers.origin, req.headers.host)) return reject(socket, 403, "Origin tidak cocok")
      if (!(await options.isSignedIn(req))) return reject(socket, 401, "Silakan login dulu")
      let cwd: string
      try {
        cwd = await options.projectDir(url.searchParams.get("project") ?? "")
      } catch {
        return reject(socket, 404, "Proyek tidak ditemukan")
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        handedOver = true
        const { cols, rows } = sizeParams.parse({ cols: url.searchParams.get("cols") ?? undefined, rows: url.searchParams.get("rows") ?? undefined })
        let pty: IPty
        try {
          pty = spawn(options.shell, ["-l"], { name: "xterm-256color", cols, rows, cwd, env: shellEnv(process.env) })
        } catch (error) {
          logger.error("terminal spawn failed", { error: (error as Error).message })
          sessions -= 1
          ws.close(1011, "Gagal menjalankan shell")
          return
        }
        logger.info("terminal opened", { sessions })
        bridge(ws, pty, () => {
          sessions -= 1
          logger.info("terminal closed", { sessions })
        })
      })
    })().catch((error: unknown) => {
      logger.error("terminal upgrade failed", { error: (error as Error).message })
      socket.destroy()
    })
  })
}
