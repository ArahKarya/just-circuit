import type { NextFunction, Request, RequestHandler, Response } from "express"
import type { ZodType } from "zod"
import { InvalidPathError } from "../storage/project-files.js"
import { NotFoundError } from "../storage/projects.js"

export function sendError(res: Response, status: number, message: string): void {
  res.status(status).json({ success: false, error: message })
}

export function sendData(res: Response, data: unknown, status = 200): void {
  res.status(status).json({ success: true, data })
}

/** Parses req.body with a zod schema; responds 400 on failure. */
export function parseBody<T>(schema: ZodType<T>, req: Request, res: Response): T | null {
  const parsed = schema.safeParse(req.body)
  if (parsed.success) return parsed.data
  sendError(res, 400, parsed.error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; "))
  return null
}

/** Wraps an async handler and maps storage errors to HTTP statuses. */
export function handle(fn: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch((error: unknown) => {
      if (error instanceof NotFoundError) sendError(res, 404, error.message)
      else if (error instanceof InvalidPathError) sendError(res, 400, error.message)
      else next(error)
    })
  }
}
