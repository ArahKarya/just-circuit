import { Router } from "express"
import { preferencesSchema, type PreferencesStore } from "../storage/preferences.js"
import { handle, parseBody, sendData } from "./http.js"

export function preferencesRouter(store: PreferencesStore): Router {
  const r = Router()
  r.get("/", handle(async (_req, res) => sendData(res, await store.read())))
  r.put("/", handle(async (req, res) => {
    const body = parseBody(preferencesSchema, req, res)
    if (body) sendData(res, await store.write(body))
  }))
  return r
}
