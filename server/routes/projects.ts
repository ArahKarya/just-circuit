import express, { Router, type NextFunction, type Request, type Response } from "express"
import { z } from "zod"
import { ATTACHMENT_ID, cleanFileName, kindFromName, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_MESSAGE, MAX_UPLOAD_BYTES, type AttachmentMeta } from "../../shared/attachments.js"
import { rateLimit } from "../middleware/rate-limit.js"
import { tooBigMessage, type AttachmentStore } from "../storage/attachments.js"
import { ValidationError } from "../storage/errors.js"
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
      schematicDisabled: z.boolean().optional(),
      routingDisabled: z.boolean().optional(),
    })
    .optional(),
})
export const memorySchema = z.object({ content: z.string().max(8000, "Memori maksimal 8000 karakter") })
const versionSchema = z.object({ message: z.string().trim().min(1, "Isi keterangan versi").max(200) })

export const messageSchema = z.object({
  id: z.string().min(1).max(100),
  role: z.enum(["user", "assistant"]),
  content: z.string().max(400_000),
  createdAt: z.number(),
  appliedFiles: z.array(z.string().max(300)).optional(),
  previousFiles: fileMap.optional(),
  isError: z.boolean().optional(),
  toolSteps: z
    .array(z.object({ name: z.string().max(60), detail: z.string().max(400), ok: z.boolean().optional(), result: z.string().max(400).optional() }))
    .max(100)
    .optional(),
  attachments: z
    .array(
      z.object({
        id: z.string().regex(ATTACHMENT_ID),
        name: z.string().max(200),
        kind: z.enum(["image", "pdf", "text"]),
        mediaType: z.string().max(100),
        size: z.number().int().nonnegative(),
        pages: z.number().int().nonnegative().optional(),
        textChars: z.number().int().nonnegative().optional(),
      }),
    )
    .max(MAX_ATTACHMENTS_PER_MESSAGE)
    .optional(),
})
const messagePatchSchema = z.object({
  appliedFiles: z.array(z.string().max(300)).optional(),
  /** null removes the undo snapshot. */
  previousFiles: fileMap.nullable().optional(),
})

/** Images open in the browser; everything else downloads, and nothing served here may run scripts. */
function sendAttachment(res: Response, meta: AttachmentMeta, bytes: Buffer): void {
  const inline = meta.kind === "image"
  res.setHeader("Content-Type", inline ? meta.mediaType : meta.kind === "pdf" ? "application/pdf" : "text/plain; charset=utf-8")
  res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(meta.name)}`)
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox")
  // Not kept in the browser cache: a cleared chat or a logout must not leave copies behind.
  res.setHeader("Cache-Control", "private, no-store")
  res.end(bytes)
}

function fileNameHeader(value: string | undefined): string {
  try {
    return value ? decodeURIComponent(value.slice(0, 1000)) : ""
  } catch {
    return ""
  }
}

const UPLOADS_PER_MINUTE = 60
const PARALLEL_UPLOADS = 4

/**
 * Refuses an upload before its body is read: too many at once, or bigger than its kind allows
 * (the raw parser's own limit is the largest kind's).
 */
function uploadGate() {
  let active = 0
  return (req: Request, res: Response, next: NextFunction): void => {
    const kind = kindFromName(cleanFileName(fileNameHeader(req.get("X-File-Name"))))
    const length = Number(req.get("Content-Length"))
    if (kind && Number.isFinite(length) && length > MAX_ATTACHMENT_BYTES[kind]) {
      res.status(413).json({ success: false, error: tooBigMessage(kind, length) })
      return
    }
    if (active >= PARALLEL_UPLOADS) {
      res.status(429).json({ success: false, error: "Terlalu banyak unggahan bersamaan, tunggu sebentar" })
      return
    }
    active += 1
    res.once("close", () => {
      active -= 1
    })
    next()
  }
}

export function projectsRouter(store: ProjectStore, attachments: AttachmentStore): Router {
  const r = Router()
  const uploadLimit = rateLimit(UPLOADS_PER_MINUTE)
  const gate = uploadGate()

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

  r.get("/:id/memory", handle(async (req, res) => sendData(res, { content: await store.readMemory(String(req.params.id)) })))

  r.put("/:id/memory", handle(async (req, res) => {
    const body = parseBody(memorySchema, req, res)
    if (!body) return
    await store.writeMemory(String(req.params.id), body.content)
    sendData(res, { content: body.content })
  }))

  r.get("/:id/messages", handle(async (req, res) => sendData(res, await store.messages(String(req.params.id)))))

  r.post("/:id/messages", handle(async (req, res) => {
    const body = parseBody(messageSchema, req, res)
    if (!body) return
    const projectId = String(req.params.id)
    // What the files are comes from the server, not from the message the browser sent.
    const { attachments: claimed, ...rest } = body
    const refs = claimed ? await attachments.refsFor(projectId, claimed.map((a) => a.id)) : []
    const message: ChatMessageRecord = { ...rest, projectId, ...(refs.length > 0 ? { attachments: refs } : {}) }
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
    const projectId = String(req.params.id)
    await store.changeMessages(projectId, () => [])
    await attachments.clear(projectId)
    sendData(res, null)
  }))

  // Raw bytes; the file name travels URI-encoded in a header (never in the URL).
  r.post("/:id/attachments", uploadLimit, gate, express.raw({ type: "application/octet-stream", limit: MAX_UPLOAD_BYTES }), handle(async (req, res) => {
    if (!Buffer.isBuffer(req.body)) throw new ValidationError(req.is("application/octet-stream") ? "File kosong" : "Kirim file sebagai application/octet-stream")
    sendData(res, await attachments.add(String(req.params.id), fileNameHeader(req.get("X-File-Name")), req.body), 201)
  }))

  r.get("/:id/attachments/:attachmentId", handle(async (req, res) => {
    const { meta, bytes } = await attachments.get(String(req.params.id), String(req.params.attachmentId))
    sendAttachment(res, meta, bytes)
  }))

  r.delete("/:id/attachments/:attachmentId", handle(async (req, res) => {
    await attachments.remove(String(req.params.id), String(req.params.attachmentId))
    sendData(res, null)
  }))

  return r
}
