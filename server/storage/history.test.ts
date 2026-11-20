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
  dataDir = await mkdtemp(path.join(tmpdir(), "just-circuit-history-"))
  store = createProjectStore(dataDir)
})
afterEach(() => rm(dataDir, { recursive: true, force: true }))

describe("version history", () => {
  it("records AI changes separately from hand edits and restores old versions", async () => {
    const { id } = await store.create({ name: "A", entrypoint: ENTRY, files: { [ENTRY]: "v1" } })
    const dir = path.join(dataDir, "workspaces", "default", id)
    expect(await readFile(path.join(dir, ".gitignore"), "utf8")).toContain(".just-circuit/")

    // A hand edit (e.g. from the terminal), then an AI change.
    await writeFile(path.join(dir, ENTRY), "v2-manual")
    await store.update(id, { files: { [ENTRY]: "v3-ai" }, commitMessage: "AI: ganti resistor" })
    const versions = await store.versions(id)
    expect(versions.map((v) => v.message)).toEqual(["AI: ganti resistor", "Perubahan di luar editor", "Riwayat dimulai"])
    expect(versions[0].files).toEqual([ENTRY])

    const { diff } = await store.diffOf(id, versions[0].sha)
    expect(diff).toContain("-v2-manual")
    expect(diff).toContain("+v3-ai")

    const restored = await store.restoreVersion(id, versions[2].shortSha)
    expect(restored.files[ENTRY]).toBe("v1")
    expect((await store.versions(id))[0].message).toBe("Kembali ke versi " + versions[2].shortSha + ": Riwayat dimulai")
  })

  it("records terminal edits before an autosave replaces them, but not the editor's own autosaves", async () => {
    const { id } = await store.create({ name: "A", entrypoint: ENTRY, files: { [ENTRY]: "v1" } })
    const dir = path.join(dataDir, "workspaces", "default", id)
    await store.update(id, { files: { [ENTRY]: "v2" } })
    await store.update(id, { files: { [ENTRY]: "v3" } })
    expect((await store.versions(id)).map((v) => v.message)).toEqual(["Riwayat dimulai"])

    await writeFile(path.join(dir, "lib.tsx"), "dari terminal")
    await store.update(id, { files: { [ENTRY]: "v4" } })
    const versions = await store.versions(id)
    expect(versions[0].message).toBe("Perubahan di luar editor")
    expect(versions[0].files.sort()).toEqual([ENTRY, "lib.tsx"])
  })

  it("keeps typing since the last version separate from an AI change", async () => {
    const { id } = await store.create({ name: "A", entrypoint: ENTRY, files: { [ENTRY]: "v1" } })
    await store.update(id, { files: { [ENTRY]: "v2-typed" } })
    await store.update(id, { files: { [ENTRY]: "v3-ai" }, commitMessage: "AI: x" })
    expect((await store.versions(id)).map((v) => v.message)).toEqual(["AI: x", "Perubahan manual", "Riwayat dimulai"])
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
    expect((await store.versions(id)).flatMap((v) => v.files)).not.toContain(".just-circuit/chat.json")
    await expect(store.diffOf(id, "deadbeef")).rejects.toBeInstanceOf(NotFoundError)
    await expect(store.diffOf(id, "--output=/tmp/x")).rejects.toBeInstanceOf(NotFoundError)
  })
})
