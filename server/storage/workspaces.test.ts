import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { ConflictError } from "./errors"
import { createProjectStore, type ProjectStore } from "./projects"
import { createWorkspaceStore, type WorkspaceStore } from "./workspaces"

const ENTRY = "index.circuit.tsx"
let dataDir: string
let projects: ProjectStore
let workspaces: WorkspaceStore

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "just-circuit-ws-"))
  projects = createProjectStore(dataDir)
  workspaces = createWorkspaceStore(projects)
})
afterEach(() => rm(dataDir, { recursive: true, force: true }))

describe("workspaces", () => {
  it("always has the default workspace and counts projects", async () => {
    await projects.create({ name: "A", entrypoint: ENTRY, files: { [ENTRY]: "1" } })
    const plc = await workspaces.create("PLC")
    expect((await workspaces.list()).map((w) => [w.name, w.projectCount])).toEqual([["Umum", 1], ["PLC", 0]])
    await workspaces.rename(plc.id, "PLC Pico")
    expect((await workspaces.list())[1].name).toBe("PLC Pico")
  })

  it("moves projects between workspaces and only deletes empty ones", async () => {
    const plc = await workspaces.create("PLC")
    const { id } = await projects.create({ name: "A", entrypoint: ENTRY, files: { [ENTRY]: "1" } })
    expect((await projects.move(id, plc.id)).workspaceId).toBe(plc.id)
    expect((await projects.get(id)).files[ENTRY]).toBe("1")
    await expect(workspaces.remove(plc.id)).rejects.toBeInstanceOf(ConflictError)
    await expect(workspaces.remove("default")).rejects.toBeInstanceOf(ConflictError)
    await projects.move(id, "default")
    await workspaces.remove(plc.id)
    expect((await workspaces.list()).map((w) => w.id)).toEqual(["default"])
  })
})

describe("trash", () => {
  it("restores a project into the workspace it came from", async () => {
    const plc = await workspaces.create("PLC")
    const { id } = await projects.create({ name: "Relay", entrypoint: ENTRY, files: { [ENTRY]: "1" }, workspaceId: plc.id })
    await projects.remove(id)
    const [entry] = await projects.listTrash()
    expect(entry).toMatchObject({ projectId: id, name: "Relay", workspaceId: plc.id, fileCount: 1 })
    const restored = await projects.restore(entry.entryId)
    expect(restored.workspaceId).toBe(plc.id)
    expect(await projects.listTrash()).toEqual([])
  })

  it("purges old entries only", async () => {
    const a = await projects.create({ name: "A", entrypoint: ENTRY, files: { [ENTRY]: "1" } })
    await projects.remove(a.id)
    expect(await projects.purgeOlderThan(0)).toBe(0)
    expect(await projects.purgeOlderThan(Date.now() + 1)).toBe(1)
    expect(await projects.listTrash()).toEqual([])
  })
})
