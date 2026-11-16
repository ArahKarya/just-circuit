import { Router, type NextFunction, type Request, type Response } from "express"
import express from "express"
import { z } from "zod"
import { logger } from "../logger.js"
import { rateLimit } from "../middleware/rate-limit.js"
import { verifyPassword } from "../security/password.js"
import { readCookie, SESSION_COOKIE } from "./cookies.js"
import type { SessionStore } from "./sessions.js"

export interface AuthOptions {
  /** Empty: login disabled (only allowed when the server listens on loopback). */
  passwordHash: string
  sessions: SessionStore
  cookieSecure: boolean
  loginRateLimitPerMinute: number
}

/** Header every state-changing request must carry; browsers can't add it cross-site without CORS. */
export const CSRF_HEADER = "x-cds-request"

const loginSchema = z.object({ password: z.string().min(1).max(500) })
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

function sendUnauthorized(res: Response): void {
  res.status(401).json({ success: false, error: "Silakan login dulu" })
}

export function createAuth(options: AuthOptions) {
  const isEnabled = options.passwordHash !== ""

  async function isSignedIn(req: Request): Promise<boolean> {
    return !isEnabled || (await options.sessions.isValid(readCookie(req, SESSION_COOKIE)))
  }

  /** Blocks cross-site form posts: non-GET requests must send the custom header. */
  function requireCsrfHeader(req: Request, res: Response, next: NextFunction): void {
    if (SAFE_METHODS.has(req.method) || req.get(CSRF_HEADER) === "1") return next()
    res.status(403).json({ success: false, error: "Permintaan ditolak (header CSRF tidak ada)" })
  }

  function requireSession(req: Request, res: Response, next: NextFunction): void {
    isSignedIn(req).then((ok) => (ok ? next() : sendUnauthorized(res)), next)
  }

  function router(): Router {
    const r = Router()
    r.get("/me", (req, res, next) => {
      isSignedIn(req).then((authenticated) => res.json({ success: true, data: { authRequired: isEnabled, authenticated } }), next)
    })
    r.post("/login", rateLimit(options.loginRateLimitPerMinute), express.json({ limit: "4kb" }), (req, res, next) => {
      const parsed = loginSchema.safeParse(req.body)
      if (!parsed.success) {
        res.status(400).json({ success: false, error: "Password wajib diisi" })
        return
      }
      if (!isEnabled) {
        res.json({ success: true, data: { authenticated: true } })
        return
      }
      void (async () => {
        if (!(await verifyPassword(parsed.data.password, options.passwordHash))) {
          logger.warn("login failed", { ip: req.ip })
          res.status(401).json({ success: false, error: "Password salah" })
          return
        }
        const session = await options.sessions.create()
        res.cookie(SESSION_COOKIE, session.token, {
          httpOnly: true,
          sameSite: "strict",
          secure: options.cookieSecure,
          path: "/",
          expires: new Date(session.expiresAt),
        })
        res.json({ success: true, data: { authenticated: true } })
      })().catch(next)
    })
    r.post("/logout", (req, res, next) => {
      options.sessions
        .revoke(readCookie(req, SESSION_COOKIE))
        .then(() => {
          res.clearCookie(SESSION_COOKIE, { path: "/" })
          res.json({ success: true, data: null })
        })
        .catch(next)
    })
    return r
  }

  return { isEnabled, isSignedIn, requireCsrfHeader, requireSession, router }
}
