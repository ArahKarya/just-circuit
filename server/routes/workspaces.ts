import { Router } from "express"
import { z } from "zod"
import type { ProjectStore } from "../storage/projects.js"
import type { WorkspaceStore } from "../storage/workspaces.js"
import { handle, parseBody, sendData } from "./http.js"

const nameSchema = z.object({ name: z.string().trim().min(1, "Nama wajib diisi").max(60) })

export function workspacesRouter(workspaces: WorkspaceStore): Router {
  const r = Router()
  r.get("/", handle(async (_req, res) => sendData(res, await workspaces.list())))
  r.post("/", handle(async (req, res) => {
    const body = parseBody(nameSchema, req, res)
    if (body) sendData(res, await workspaces.create(body.name), 201)
  }))
  r.patch("/:id", handle(async (req, res) => {
    const body = parseBody(nameSchema, req, res)
    if (!body) return
    await workspaces.rename(String(req.params.id), body.name)
    sendData(res, null)
  }))
  r.delete("/:id", handle(async (req, res) => {
    await workspaces.remove(String(req.params.id))
    sendData(res, null)
  }))
  return r
}

export function trashRouter(projects: ProjectStore): Router {
  const r = Router()
  r.get("/", handle(async (_req, res) => sendData(res, await projects.listTrash())))
  r.post("/:entryId/restore", handle(async (req, res) => sendData(res, await projects.restore(String(req.params.entryId)))))
  r.delete("/:entryId", handle(async (req, res) => {
    await projects.purge(String(req.params.entryId))
    sendData(res, null)
  }))
  r.delete("/", handle(async (_req, res) => {
    sendData(res, { purged: await projects.purgeOlderThan(Number.MAX_SAFE_INTEGER) })
  }))
  return r
}
