import type { NextFunction, Request, Response } from "express"

interface Bucket {
  count: number
  resetAt: number
}

/** Fixed-window, in-memory rate limiter keyed by client IP. */
export function rateLimit(limitPerMinute: number) {
  const windowMs = 60_000
  let buckets = new Map<string, Bucket>()

  const sweep = setInterval(() => {
    const now = Date.now()
    buckets = new Map([...buckets].filter(([, bucket]) => bucket.resetAt > now))
  }, windowMs)
  sweep.unref()

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.ip ?? "unknown"
    const now = Date.now()
    const current = buckets.get(key)
    const bucket = current && current.resetAt > now ? { ...current, count: current.count + 1 } : { count: 1, resetAt: now + windowMs }
    buckets.set(key, bucket)
    res.setHeader("RateLimit-Remaining", String(Math.max(0, limitPerMinute - bucket.count)))
    if (bucket.count > limitPerMinute) {
      res.setHeader("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)))
      res.status(429).json({ success: false, error: "Terlalu banyak permintaan, coba lagi sebentar" })
      return
    }
    next()
  }
}
