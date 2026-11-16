import { mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createProjectStore, NotFoundError, type ProjectStore } from "./projects"
import { InvalidPathError } from "./project-files"

const ENTRY = "index.circuit.tsx"
let dataDir: string
let store: ProjectStore

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "cds-store-"))
  store = createProjectStore(dataDir)
})
afterEach(() => rm(dataDir, { recursive: true, force: true }))

describe("project store", () => {
  it("creates a tsci-compatible folder and reads it back", async () => {
    const created = await store.create({ name: "PLC Pico", entrypoint: ENTRY, files: { [ENTRY]: "export default 1\n", "lib/power.tsx": "x" } })
    expect(created.id).toMatch(/^plc-pico-[0-9a-f]{6}$/)
    const dir = path.join(dataDir, "workspaces", "default", created.id)
    expect(await readFile(path.join(dir, "lib/power.tsx"), "utf8")).toBe("x")
    expect(JSON.parse(await readFile(path.join(dir, "package.json"), "utf8")).main).toBe(ENTRY)
    // Scaffold files stay on disk but out of the editor.
    expect(Object.keys((await store.get(created.id)).files).sort()).toEqual([ENTRY, "lib/power.tsx"])
    expect((await store.list()).map((p) => p.name)).toEqual(["PLC Pico"])
  })

  it("syncs files: writes changes, deletes removed files and empty folders", async () => {
    const { id } = await store.create({ name: "A", entrypoint: ENTRY, files: { [ENTRY]: "1", "lib/a.tsx": "a" } })
    const updated = await store.update(id, { name: "B", files: { [ENTRY]: "2" } })
    expect(updated.name).toBe("B")
    expect(updated.files).toEqual({ [ENTRY]: "2" })
    const dir = path.join(dataDir, "workspaces", "default", id)
    expect(await readdir(dir)).not.toContain("lib")
  })

  it("rejects paths outside the project or of other types", async () => {
    const { id } = await store.create({ name: "A", entrypoint: ENTRY, files: { [ENTRY]: "1" } })
    for (const bad of ["../x.tsx", "/etc/passwd.tsx", ".cds/project.json", "a/../../b.tsx", "run.sh", "package.json", "node_modules/tscircuit/index.js", "dist/x.js", "lib/package.json", "tscircuit.config.ts", "vite.config.js"]) {
      await expect(store.update(id, { files: { [ENTRY]: "1", [bad]: "x" } })).rejects.toBeInstanceOf(InvalidPathError)
    }
  })

  it("refuses to write through a symlinked folder", async () => {
    const outside = await mkdtemp(path.join(tmpdir(), "cds-outside-"))
    const { id } = await store.create({ name: "A", entrypoint: ENTRY, files: { [ENTRY]: "1" } })
    await symlink(outside, path.join(dataDir, "workspaces", "default", id, "lib"))
    await expect(store.update(id, { files: { [ENTRY]: "1", "lib/x.json": "{}" } })).rejects.toBeInstanceOf(InvalidPathError)
    expect(await readdir(outside)).toEqual([])
    await rm(outside, { recursive: true, force: true })
  })

  it("does not follow a symlinked .cds/project.json", async () => {
    const { id } = await store.create({ name: "A", entrypoint: ENTRY, files: { [ENTRY]: "1" } })
    const meta = path.join(dataDir, "workspaces", "default", id, ".cds", "project.json")
    await writeFile(path.join(dataDir, "settings.json"), '{"secret":"x"}')
    await rm(meta)
    await symlink(path.join(dataDir, "settings.json"), meta)
    await expect(store.get(id)).rejects.toBeInstanceOf(NotFoundError)
  })

  it("rejects an entrypoint that is not one of the files", async () => {
    await expect(store.create({ name: "A", entrypoint: "../x.tsx", files: { [ENTRY]: "1" } })).rejects.toBeInstanceOf(InvalidPathError)
    await expect(store.create({ name: "A", entrypoint: "main.tsx", files: { [ENTRY]: "1" } })).rejects.toBeInstanceOf(InvalidPathError)
    // Nothing half-created is left behind.
    expect(await store.list()).toEqual([])
  })

  it("moves deleted projects to the trash", async () => {
    const { id } = await store.create({ name: "A", entrypoint: ENTRY, files: { [ENTRY]: "1" } })
    await store.remove(id)
    await expect(store.get(id)).rejects.toBeInstanceOf(NotFoundError)
    expect((await readdir(path.join(dataDir, "trash")))[0]).toContain(id)
  })

  it("keeps chat history next to the project", async () => {
    const { id } = await store.create({ name: "A", entrypoint: ENTRY, files: { [ENTRY]: "1" } })
    await store.changeMessages(id, (m) => [...m, { id: "m1", projectId: id, role: "user", content: "hai", createdAt: 1 }])
    expect((await store.messages(id)).map((m) => m.content)).toEqual(["hai"])
    expect((await stat(path.join(dataDir, "workspaces", "default", id, ".cds", "chat.json"))).isFile()).toBe(true)
  })

  it("serializes concurrent updates", async () => {
    const { id } = await store.create({ name: "A", entrypoint: ENTRY, files: { [ENTRY]: "0" } })
    await Promise.all(Array.from({ length: 5 }, (_, i) => store.update(id, { files: { [ENTRY]: String(i + 1) } })))
    expect((await store.get(id)).files[ENTRY]).toBe("5")
  })
})
