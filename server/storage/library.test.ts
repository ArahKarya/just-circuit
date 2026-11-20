import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { NotFoundError } from "./errors"
import { createLibraryStore, type LibraryStore } from "./library"
import { InvalidPathError } from "./project-files"

let dataDir: string
let store: LibraryStore
beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "just-circuit-lib-"))
  store = createLibraryStore(dataDir)
})
afterEach(() => rm(dataDir, { recursive: true, force: true }))

describe("library store", () => {
  it("saves, lists, renames and deletes items with their exports", async () => {
    const item = await store.create({ name: "Power 3V3", description: "AMS1117", entry: "index.tsx", files: { "index.tsx": "export const Power = () => null", "ldo.tsx": "x" } })
    expect(item).toMatchObject({ name: "Power 3V3", exports: ["Power"], fileCount: 2 })
    expect((await store.get(item.id)).files["ldo.tsx"]).toBe("x")
    await store.update(item.id, { description: "AMS1117 + caps" })
    expect((await store.list()).map((i) => i.description)).toEqual(["AMS1117 + caps"])
    await store.remove(item.id)
    await expect(store.get(item.id)).rejects.toBeInstanceOf(NotFoundError)
  })

  it("applies the project path rules", async () => {
    await expect(store.create({ name: "x", description: "", entry: "a.tsx", files: { "a.tsx": "1", "node_modules/x.js": "evil" } })).rejects.toBeInstanceOf(InvalidPathError)
    await expect(store.create({ name: "x", description: "", entry: "missing.tsx", files: { "a.tsx": "1" } })).rejects.toBeInstanceOf(InvalidPathError)
    expect(await store.list()).toEqual([])
  })
})
