import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createSessionStore } from "./sessions"

let dataDir: string
beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "cds-sessions-"))
})
afterEach(() => rm(dataDir, { recursive: true, force: true }))

describe("session store", () => {
  it("survives a restart, expires and can be revoked", async () => {
    let now = 1000
    const { token } = await createSessionStore(dataDir, 500, () => now).create()
    const reopened = createSessionStore(dataDir, 500, () => now)
    expect(await reopened.isValid(token)).toBe(true)
    expect(await reopened.isValid("other")).toBe(false)
    await reopened.revoke(token)
    expect(await reopened.isValid(token)).toBe(false)

    const second = await reopened.create()
    now += 501
    expect(await reopened.isValid(second.token)).toBe(false)
  })
})
