import { Router } from "express"
import type { GlobalMemoryStore } from "../storage/global-memory.js"
import { handle, parseBody, sendData } from "./http.js"
import { memorySchema } from "./projects.js"

export function memoryRouter(store: GlobalMemoryStore): Router {
  const r = Router()
  r.get("/", handle(async (_req, res) => sendData(res, { content: await store.read() })))
  r.put("/", handle(async (req, res) => {
    const body = parseBody(memorySchema, req, res)
    if (!body) return
    await store.write(body.content)
    sendData(res, { content: body.content })
  }))
  return r
}
