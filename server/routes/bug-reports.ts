import { Router } from "express"
import { z } from "zod"
import { BUG_STATUSES, MAX_BUG_DETAILS_CHARS, MAX_BUG_TITLE_CHARS } from "../../shared/bug-reports.js"
import type { BugReportStore } from "../storage/bug-reports.js"
import { handle, parseBody, sendData } from "./http.js"

const contextField = z.string().max(2000).optional()

/** The browser may only file user reports and its own runtime errors; server and agent reports are recorded server-side. */
const newReportSchema = z.object({
  source: z.enum(["user", "client"]),
  title: z.string().trim().min(1).max(MAX_BUG_TITLE_CHARS),
  details: z.string().max(MAX_BUG_DETAILS_CHARS).optional(),
  context: z
    .object({ projectId: contextField, projectName: contextField, where: contextField, url: contextField, userAgent: contextField })
    .strict()
    .optional(),
})

const statusSchema = z.object({ status: z.enum(BUG_STATUSES) })

export function bugReportsRouter(store: BugReportStore): Router {
  const r = Router()
  r.get("/", handle(async (_req, res) => sendData(res, [...(await store.list())].reverse())))
  r.post("/", handle(async (req, res) => {
    const body = parseBody(newReportSchema, req, res)
    if (!body) return
    const report = await store.record(body)
    // An automatic report can be dropped by the per-minute budget: accepted, not stored.
    sendData(res, report, report ? 201 : 202)
  }))
  r.patch("/:id", handle(async (req, res) => {
    const body = parseBody(statusSchema, req, res)
    if (!body) return
    sendData(res, await store.setStatus(String(req.params.id), body.status))
  }))
  r.delete("/:id", handle(async (req, res) => {
    await store.remove(String(req.params.id))
    sendData(res, null)
  }))
  return r
}
