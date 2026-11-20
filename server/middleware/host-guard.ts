import type { NextFunction, Request, Response } from "express"
import type { IncomingHttpHeaders } from "node:http"

const LOOPBACK_NAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"])
const FORWARDED_HEADERS = ["x-forwarded-for", "forwarded", "cf-connecting-ip", "x-real-ip"]

export interface HostGuardOptions {
  /** Host names allowed besides loopback (from JUST_CIRCUIT_ALLOWED_HOSTS). */
  allowedHosts: readonly string[]
  /** Accept any Host (a password protects the server, and HOST is not loopback). */
  allowAnyHost: boolean
  /** Without login, refuse requests relayed by a proxy or tunnel. */
  loginDisabled: boolean
}

export function hostName(value: string | undefined): string {
  if (!value) return ""
  const host = value.trim().toLowerCase()
  if (host.startsWith("[")) return host.slice(0, host.indexOf("]") + 1)
  return host.split(":")[0]
}

/**
 * Blocks DNS rebinding (a web page whose domain suddenly points at 127.0.0.1) by checking
 * the Host header, and refuses proxied traffic while login is off, so a tunnel in front
 * of a loopback-only server can't expose it without a password.
 */
/** Why a request must be refused, or null when it may pass (shared by HTTP and the terminal WebSocket). */
export function hostProblem(options: HostGuardOptions, headers: IncomingHttpHeaders): { status: number; error: string } | null {
  const allowed = new Set([...LOOPBACK_NAMES, ...options.allowedHosts.map(hostName)])
  if (options.loginDisabled && FORWARDED_HEADERS.some((header) => headers[header] !== undefined)) {
    return { status: 403, error: "Akses lewat proxy butuh login. Set JUST_CIRCUIT_PASSWORD_HASH (pnpm set-password)." }
  }
  if (!options.allowAnyHost && !allowed.has(hostName(headers.host))) {
    return { status: 421, error: "Host tidak dikenal. Tambahkan ke JUST_CIRCUIT_ALLOWED_HOSTS." }
  }
  return null
}

export function hostGuard(options: HostGuardOptions) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const problem = hostProblem(options, req.headers)
    if (problem) {
      res.status(problem.status).json({ success: false, error: problem.error })
      return
    }
    next()
  }
}
