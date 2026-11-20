import type { NextFunction, Request, Response } from "express"
import { describe, expect, it, vi } from "vitest"
import { hostGuard } from "./host-guard"

function run(options: Parameters<typeof hostGuard>[0], headers: Record<string, string>) {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() }
  const next = vi.fn()
  hostGuard(options)({ headers } as unknown as Request, res as unknown as Response, next as NextFunction)
  return { next, status: res.status.mock.calls[0]?.[0] as number | undefined }
}

const local = { allowedHosts: [], allowAnyHost: false, loginDisabled: true }

describe("hostGuard", () => {
  it("allows loopback hosts with any port", () => {
    expect(run(local, { host: "localhost:5180" }).next).toHaveBeenCalled()
    expect(run(local, { host: "127.0.0.1:8787" }).next).toHaveBeenCalled()
    expect(run(local, { host: "[::1]:8787" }).next).toHaveBeenCalled()
  })

  it("blocks DNS-rebinding hosts and allows configured names", () => {
    expect(run(local, { host: "evil.example:8787" }).status).toBe(421)
    expect(run({ ...local, allowedHosts: ["just-circuit.tailnet.ts.net"] }, { host: "just-circuit.tailnet.ts.net" }).next).toHaveBeenCalled()
  })

  it("refuses proxied requests while login is off", () => {
    expect(run(local, { host: "localhost", "x-forwarded-for": "1.2.3.4" }).status).toBe(403)
    expect(run({ ...local, loginDisabled: false }, { host: "localhost", "cf-connecting-ip": "1.2.3.4" }).next).toHaveBeenCalled()
  })
})
