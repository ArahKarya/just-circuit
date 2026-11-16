import { Router } from "express"
import { settingsInputSchema, type SettingsStore } from "../storage/settings.js"
import { handle, parseBody, sendData } from "./http.js"

export function settingsRouter(store: SettingsStore): Router {
  const r = Router()
  r.get("/", handle(async (_req, res) => sendData(res, await store.read())))
  r.put("/", handle(async (req, res) => {
    const body = parseBody(settingsInputSchema, req, res)
    if (body) sendData(res, await store.write(body))
  }))
  return r
}
