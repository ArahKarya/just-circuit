import { Router } from "express"
import { z } from "zod"
import { logger } from "../logger.js"
import type { ProjectStore } from "../storage/projects.js"
import { settingsInputSchema, type SettingsStore } from "../storage/settings.js"
import { handle, parseBody, sendData } from "./http.js"
import { messageSchema } from "./projects.js"

const browserExportSchema = z.object({
  projects: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(100),
        entrypoint: z.string().max(300),
        files: z.record(z.string().max(300), z.string()),
        createdAt: z.number(),
        updatedAt: z.number(),
        messages: z.array(messageSchema).max(5000),
      }),
    )
    .max(500),
  settings: settingsInputSchema.nullable(),
})

/** One-time import of projects, chats and AI settings that used to live in the browser's IndexedDB. */
export function migrateRouter(projects: ProjectStore, settings: SettingsStore): Router {
  const r = Router()
  r.post("/browser", handle(async (req, res) => {
    const body = parseBody(browserExportSchema, req, res)
    if (!body) return
    const imported: { name: string; id: string }[] = []
    const skipped: { name: string; error: string }[] = []
    for (const item of body.projects) {
      try {
        const created = await projects.create({ name: item.name, entrypoint: item.entrypoint, files: item.files, createdAt: item.createdAt, updatedAt: item.updatedAt })
        const messages = item.messages.map((m) => ({ ...m, projectId: created.id }))
        await projects.changeMessages(created.id, () => messages)
        imported.push({ name: item.name, id: created.id })
      } catch (error) {
        skipped.push({ name: item.name, error: error instanceof Error ? error.message : "gagal" })
      }
    }
    // Only take browser settings when the server has none yet.
    const current = await settings.read()
    const settingsImported = body.settings !== null && current.connections.length === 0
    if (settingsImported && body.settings) await settings.write(body.settings)
    logger.info("browser data migrated", { projects: imported.length, skipped: skipped.length, settingsImported })
    sendData(res, { imported, skipped, settingsImported })
  }))
  return r
}
