import { Router } from "express"
import { z } from "zod"
import type { LibraryStore } from "../storage/library.js"
import { handle, parseBody, sendData } from "./http.js"

const name = z.string().trim().min(1, "Nama wajib diisi").max(80)
const description = z.string().trim().max(500)
const createSchema = z.object({ name, description: description.default(""), entry: z.string().max(300), files: z.record(z.string().max(300), z.string()) })
const updateSchema = z.object({ name: name.optional(), description: description.optional() })

export function libraryRouter(store: LibraryStore): Router {
  const r = Router()
  r.get("/", handle(async (_req, res) => sendData(res, await store.list())))
  r.get("/:id", handle(async (req, res) => sendData(res, await store.get(String(req.params.id)))))
  r.post("/", handle(async (req, res) => {
    const body = parseBody(createSchema, req, res)
    if (body) sendData(res, await store.create(body), 201)
  }))
  r.patch("/:id", handle(async (req, res) => {
    const body = parseBody(updateSchema, req, res)
    if (body) sendData(res, await store.update(String(req.params.id), body))
  }))
  r.delete("/:id", handle(async (req, res) => {
    await store.remove(String(req.params.id))
    sendData(res, null)
  }))
  return r
}
