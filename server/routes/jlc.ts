import express, { Router, type Request, type Response } from "express"
import { errorMessage, logger } from "../logger.js"
import { hostMatches, parseHttpUrl, readLimited, UrlGuardError } from "../net/url-guard.js"

/**
 * CORS proxy used by the runframe "Import component" dialog to fetch EasyEDA
 * part data. Only the EasyEDA / LCSC / JLCPCB hosts are reachable, so this
 * cannot be abused as an open proxy.
 */
const ALLOWED_HOST_SUFFIXES = ["easyeda.com", "lcsc.com", "jlcpcb.com", "szlcsc.com"] as const
const FORWARDED_RESPONSE_HEADERS = ["content-type", "content-encoding", "cache-control"] as const
const MAX_RESPONSE_BYTES = 15 * 1024 * 1024

function header(req: Request, name: string): string | undefined {
  const value = req.header(name)
  return value && value.length > 0 ? value : undefined
}

function buildUpstreamHeaders(req: Request): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": header(req, "x-sender-user-agent") ?? "Mozilla/5.0 (compatible; CircuitDesignStudio)",
  }
  const referer = header(req, "x-sender-referer")
  const contentType = header(req, "content-type")
  if (referer) headers.Referer = referer
  if (contentType) headers["Content-Type"] = contentType
  return headers
}

async function handleProxy(req: Request, res: Response): Promise<void> {
  const target = header(req, "x-target-url")
  let targetHost = "invalid"
  if (!target) {
    res.status(400).json({ success: false, error: "Header X-Target-Url wajib ada" })
    return
  }
  try {
    const url = parseHttpUrl(target)
    targetHost = url.hostname
    if (url.protocol !== "https:" || !hostMatches(url.hostname, ALLOWED_HOST_SUFFIXES)) {
      throw new UrlGuardError(`Host ${url.hostname} tidak diizinkan oleh proxy JLCPCB`)
    }
    const hasBody = req.method !== "GET" && req.method !== "HEAD" && Buffer.isBuffer(req.body) && req.body.length > 0
    const upstream = await fetch(url, {
      method: req.method,
      headers: buildUpstreamHeaders(req),
      body: hasBody ? new Uint8Array(req.body) : undefined,
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    })
    const payload = await readLimited(upstream, MAX_RESPONSE_BYTES)
    for (const name of FORWARDED_RESPONSE_HEADERS) {
      const value = upstream.headers.get(name)
      if (value && name !== "content-encoding") res.setHeader(name, value)
    }
    res.status(upstream.status).send(payload)
  } catch (error) {
    const status = error instanceof UrlGuardError ? 400 : 502
    if (status === 502) logger.warn("jlc proxy failed", { host: targetHost, error: errorMessage(error) })
    res.status(status).json({ success: false, error: errorMessage(error) })
  }
}

export function jlcRouter(): Router {
  const router = Router()
  router.all("/proxy", express.raw({ type: "*/*", limit: "1mb" }), handleProxy)
  return router
}
