import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { NotFoundError } from "./errors"
import { createProjectStore, type ProjectStore } from "./projects"

const ENTRY = "index.circuit.tsx"
let dataDir: string
let store: ProjectStore

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "cds-history-"))
  store = createProjectStore(dataDir)
})
afterEach(() => rm(dataDir, { recursive: true, force: true }))

describe("version history", () => {
  it("records AI changes separately from hand edits and restores old versions", async () => {
    const { id } = await store.create({ name: "A", entrypoint: ENTRY, files: { [ENTRY]: "v1" } })
    const dir = path.join(dataDir, "workspaces", "default", id)
    expect(await readFile(path.join(dir, ".gitignore"), "utf8")).toContain(".cds/")

    // A hand edit (e.g. from the terminal), then an AI change.
    await writeFile(path.join(dir, ENTRY), "v2-manual")
    await store.update(id, { files: { [ENTRY]: "v3-ai" }, commitMessage: "AI: ganti resistor" })
    const versions = await store.versions(id)
    expect(versions.map((v) => v.message)).toEqual(["AI: ganti resistor", "Perubahan manual", "Riwayat dimulai"])
    expect(versions[0].files).toEqual([ENTRY])

    const { diff } = await store.diffOf(id, versions[0].sha)
    expect(diff).toContain("-v2-manual")
    expect(diff).toContain("+v3-ai")

    const restored = await store.restoreVersion(id, versions[2].shortSha)
    expect(restored.files[ENTRY]).toBe("v1")
    expect((await store.versions(id))[0].message).toBe("Kembali ke versi " + versions[2].shortSha + ": Riwayat dimulai")
  })

  it("saves a named version only when something changed", async () => {
    const { id } = await store.create({ name: "A", entrypoint: ENTRY, files: { [ENTRY]: "v1" } })
    expect(await store.saveVersion(id, "tidak ada perubahan")).toBeNull()
    await store.update(id, { files: { [ENTRY]: "v2" } })
    expect(await store.saveVersion(id, "Sebelum layout")).toMatch(/^[0-9a-f]{40}$/)
  })

  it("never logs chat history or rejects unknown versions", async () => {
    const { id } = await store.create({ name: "A", entrypoint: ENTRY, files: { [ENTRY]: "v1" } })
    await store.changeMessages(id, () => [{ id: "m", projectId: id, role: "user", content: "rahasia", createdAt: 1 }])
    await store.update(id, { files: { [ENTRY]: "v2" }, commitMessage: "AI" })
    expect((await store.versions(id)).flatMap((v) => v.files)).not.toContain(".cds/chat.json")
    await expect(store.diffOf(id, "deadbeef")).rejects.toBeInstanceOf(NotFoundError)
    await expect(store.diffOf(id, "--output=/tmp/x")).rejects.toBeInstanceOf(NotFoundError)
  })
})
