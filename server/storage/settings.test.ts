import { randomBytes } from "node:crypto"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createSecretBox } from "../security/secret-box"
import { createSettingsStore, type SettingsInput } from "./settings"

let dataDir: string
beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "cds-settings-"))
})
afterEach(() => rm(dataDir, { recursive: true, force: true }))

const input = (apiKey: string | null): SettingsInput => ({
  activeConnectionId: "c1",
  temperature: 0.2,
  maxOutputTokens: 8000,
  autoFixAttempts: 2,
  connections: [{ id: "c1", name: "9router", kind: "anthropic", baseUrl: "http://x/v1", model: "m", apiKey }],
})

describe("settings store", () => {
  it("encrypts keys at rest and never returns them", async () => {
    const store = createSettingsStore(dataDir, createSecretBox(randomBytes(32)))
    const saved = await store.write(input("sk-secret-123"))
    expect(saved.connections[0]).toMatchObject({ apiKey: "", hasApiKey: true })
    expect(await readFile(path.join(dataDir, "settings.json"), "utf8")).not.toContain("sk-secret-123")
    expect((await store.resolve("c1"))?.apiKey).toBe("sk-secret-123")
  })

  it("keeps the key on null and removes it on empty string", async () => {
    const store = createSettingsStore(dataDir, createSecretBox(randomBytes(32)))
    await store.write(input("sk-1"))
    await store.write(input(null))
    expect((await store.resolve("c1"))?.apiKey).toBe("sk-1")
    await store.write(input(""))
    expect((await store.resolve("c1"))?.apiKey).toBe("")
    expect((await store.read()).connections[0].hasApiKey).toBe(false)
  })

  it("drops the stored key when the connection points to another provider", async () => {
    const store = createSettingsStore(dataDir, createSecretBox(randomBytes(32)))
    await store.write(input("sk-1"))
    const moved = input(null)
    await store.write({ ...moved, connections: [{ ...moved.connections[0], baseUrl: "https://evil.example/v1" }] })
    expect((await store.resolve("c1"))?.apiKey).toBe("")
  })

  it("cannot decrypt with another key", async () => {
    await createSettingsStore(dataDir, createSecretBox(randomBytes(32))).write(input("sk-1"))
    await expect(createSettingsStore(dataDir, createSecretBox(randomBytes(32))).resolve("c1")).rejects.toThrow()
  })
})
