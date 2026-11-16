import { Router } from "express"
import { z } from "zod"
import type { ChatMessageRecord, ProjectStore } from "../storage/projects.js"
import { handle, parseBody, sendData } from "./http.js"

const fileMap = z.record(z.string().max(300), z.string())
const name = z.string().trim().min(1, "Nama wajib diisi").max(100)
const entrypoint = z.string().max(300)

const workspaceId = z.string().max(100)
const createSchema = z.object({ name, entrypoint, files: fileMap, workspaceId: workspaceId.optional() })
const moveSchema = z.object({ workspaceId })
const updateSchema = z.object({
  name: name.optional(),
  entrypoint: entrypoint.optional(),
  files: fileMap.optional(),
  commitMessage: z.string().trim().min(1).max(200).optional(),
  settings: z
    .object({
      aiRules: z.string().max(4000).optional(),
      connectionId: z.string().max(100).nullable().optional(),
    })
    .optional(),
})
const versionSchema = z.object({ message: z.string().trim().min(1, "Isi keterangan versi").max(200) })

export const messageSchema = z.object({
  id: z.string().min(1).max(100),
  role: z.enum(["user", "assistant"]),
  content: z.string().max(400_000),
  createdAt: z.number(),
  appliedFiles: z.array(z.string().max(300)).optional(),
  previousFiles: fileMap.optional(),
  isError: z.boolean().optional(),
})
const messagePatchSchema = z.object({
  appliedFiles: z.array(z.string().max(300)).optional(),
  /** null removes the undo snapshot. */
  previousFiles: fileMap.nullable().optional(),
})

export function projectsRouter(store: ProjectStore): Router {
  const r = Router()

  r.get("/", handle(async (req, res) => {
    const workspace = typeof req.query.workspace === "string" ? req.query.workspace : undefined
    sendData(res, await store.list(workspace))
  }))

  r.post("/", handle(async (req, res) => {
    const body = parseBody(createSchema, req, res)
    if (body) sendData(res, await store.create(body), 201)
  }))

  r.get("/:id", handle(async (req, res) => sendData(res, await store.get(String(req.params.id)))))

  r.put("/:id", handle(async (req, res) => {
    const body = parseBody(updateSchema, req, res)
    if (body) sendData(res, await store.update(String(req.params.id), body))
  }))

  r.post("/:id/move", handle(async (req, res) => {
    const body = parseBody(moveSchema, req, res)
    if (body) sendData(res, await store.move(String(req.params.id), body.workspaceId))
  }))

  r.delete("/:id", handle(async (req, res) => {
    await store.remove(String(req.params.id))
    sendData(res, null)
  }))

  r.get("/:id/versions", handle(async (req, res) => sendData(res, await store.versions(String(req.params.id)))))

  r.post("/:id/versions", handle(async (req, res) => {
    const body = parseBody(versionSchema, req, res)
    if (body) sendData(res, { sha: await store.saveVersion(String(req.params.id), body.message) }, 201)
  }))

  r.get("/:id/versions/:sha/diff", handle(async (req, res) => sendData(res, await store.diffOf(String(req.params.id), String(req.params.sha)))))

  r.post("/:id/versions/:sha/restore", handle(async (req, res) => sendData(res, await store.restoreVersion(String(req.params.id), String(req.params.sha)))))

  r.get("/:id/messages", handle(async (req, res) => sendData(res, await store.messages(String(req.params.id)))))

  r.post("/:id/messages", handle(async (req, res) => {
    const body = parseBody(messageSchema, req, res)
    if (!body) return
    const projectId = String(req.params.id)
    const message: ChatMessageRecord = { ...body, projectId }
    await store.changeMessages(projectId, (current) => [...current.filter((m) => m.id !== message.id), message])
    sendData(res, message, 201)
  }))

  r.patch("/:id/messages/:messageId", handle(async (req, res) => {
    const body = parseBody(messagePatchSchema, req, res)
    if (!body) return
    const messageId = String(req.params.messageId)
    const next = await store.changeMessages(String(req.params.id), (current) =>
      current.map((m) => {
        if (m.id !== messageId) return m
        const { previousFiles: _dropped, ...rest } = m
        const base = body.previousFiles === null ? rest : m
        return {
          ...base,
          ...(body.appliedFiles ? { appliedFiles: body.appliedFiles } : {}),
          ...(body.previousFiles ? { previousFiles: body.previousFiles } : {}),
        }
      }),
    )
    sendData(res, next.find((m) => m.id === messageId) ?? null)
  }))

  r.delete("/:id/messages", handle(async (req, res) => {
    await store.changeMessages(String(req.params.id), () => [])
    sendData(res, null)
  }))

  return r
}
