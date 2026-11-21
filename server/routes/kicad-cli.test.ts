import type { Server } from "node:http"
import type { AddressInfo } from "node:net"
import express from "express"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cachedDetector, kicadCliRouter, type KicadCliStatus } from "./kicad-cli"

const found: KicadCliStatus = { available: true, version: "9.0.1" }

describe("cachedDetector", () => {
  it("reuses the result within the TTL and probes again after it", async () => {
    let clock = 0
    const detect = vi.fn(async () => found)
    const status = cachedDetector({ detect, ttlMs: 60_000, now: () => clock })
    await status()
    clock = 59_999
    await status()
    expect(detect).toHaveBeenCalledTimes(1)
    clock = 60_000
    await status()
    expect(detect).toHaveBeenCalledTimes(2)
  })

  it("shares one in-flight probe between concurrent callers", async () => {
    const detect = vi.fn(async () => found)
    const status = cachedDetector({ detect, now: () => 0 })
    await Promise.all([status(), status(), status()])
    expect(detect).toHaveBeenCalledTimes(1)
  })

  it("reports unavailable when the probe throws", async () => {
    const status = cachedDetector({ detect: async () => Promise.reject(new Error("boom")), now: () => 0 })
    expect(await status()).toEqual({ available: false, version: null })
  })
})

describe("GET /status", () => {
  let server: Server | undefined
  afterEach(async () => {
    await new Promise((resolve) => server?.close(resolve))
    server = undefined
  })

  it("returns the cached detection in the API envelope", async () => {
    const app = express()
    app.use("/api/kicad-cli", kicadCliRouter({ detect: async () => found }))
    server = app.listen(0, "127.0.0.1")
    await new Promise((resolve) => server?.once("listening", resolve))
    const { port } = server.address() as AddressInfo
    const res = await fetch(`http://127.0.0.1:${port}/api/kicad-cli/status`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, data: found })
  })
})
