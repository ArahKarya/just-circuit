import type { NextFunction, Request, Response } from "express"

const LOOPBACK_NAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"])
const FORWARDED_HEADERS = ["x-forwarded-for", "forwarded", "cf-connecting-ip", "x-real-ip"]

export interface HostGuardOptions {
  /** Host names allowed besides loopback (from CDS_ALLOWED_HOSTS). */
  allowedHosts: readonly string[]
  /** Accept any Host (a password protects the server, and HOST is not loopback). */
  allowAnyHost: boolean
  /** Without login, refuse requests relayed by a proxy or tunnel. */
  loginDisabled: boolean
}

function hostName(value: string | undefined): string {
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
export function hostGuard(options: HostGuardOptions) {
  const allowed = new Set([...LOOPBACK_NAMES, ...options.allowedHosts.map(hostName)])
  return (req: Request, res: Response, next: NextFunction): void => {
    if (options.loginDisabled && FORWARDED_HEADERS.some((header) => req.headers[header] !== undefined)) {
      res.status(403).json({ success: false, error: "Akses lewat proxy butuh login. Set CDS_PASSWORD_HASH (pnpm set-password)." })
      return
    }
    if (!options.allowAnyHost && !allowed.has(hostName(req.headers.host))) {
      res.status(421).json({ success: false, error: "Host tidak dikenal. Tambahkan ke CDS_ALLOWED_HOSTS." })
      return
    }
    next()
  }
}
