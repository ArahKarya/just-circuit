import { mkdir, readdir, rm, rmdir } from "node:fs/promises"
import path from "node:path"
import { ConflictError, NotFoundError } from "./errors.js"
import { isDirectory, readOwnJson, writeJsonFile } from "./fs-utils.js"
import { DEFAULT_WORKSPACE, isValidId, newProjectId, type ProjectStore } from "./projects.js"

export interface Workspace {
  id: string
  name: string
  createdAt: number
  projectCount: number
}

interface WorkspaceInfo {
  name: string
  createdAt: number
}

const INFO_FILE = "workspace.json"
const DEFAULT_NAME = "Umum"

/** Workspaces are folders under dataDir/workspaces, each with a small workspace.json. */
export function createWorkspaceStore(projects: ProjectStore) {
  const root = projects.workspacesDir
  const dirOf = (id: string): string => {
    if (!isValidId(id)) throw new NotFoundError("Workspace tidak ditemukan")
    return path.join(root, id)
  }

  async function ensureDefault(): Promise<void> {
    const dir = path.join(root, DEFAULT_WORKSPACE)
    await mkdir(dir, { recursive: true })
    const info = await readOwnJson<WorkspaceInfo | null>(path.join(dir, INFO_FILE), null).catch(() => null)
    if (!info) await writeJsonFile(path.join(dir, INFO_FILE), { name: DEFAULT_NAME, createdAt: Date.now() })
  }

  async function list(): Promise<Workspace[]> {
    await ensureDefault()
    const counts = new Map<string, number>()
    for (const project of await projects.list()) counts.set(project.workspaceId, (counts.get(project.workspaceId) ?? 0) + 1)
    const entries = await readdir(root, { withFileTypes: true })
    const workspaces: Workspace[] = []
    for (const entry of entries) {
      if (!entry.isDirectory() || !isValidId(entry.name)) continue
      const info = await readOwnJson<WorkspaceInfo | null>(path.join(root, entry.name, INFO_FILE), null).catch(() => null)
      workspaces.push({ id: entry.name, name: info?.name ?? entry.name, createdAt: info?.createdAt ?? 0, projectCount: counts.get(entry.name) ?? 0 })
    }
    // Default first, then by name.
    return workspaces.sort((a, b) => (a.id === DEFAULT_WORKSPACE ? -1 : b.id === DEFAULT_WORKSPACE ? 1 : a.name.localeCompare(b.name, "id")))
  }

  async function create(name: string): Promise<Workspace> {
    await ensureDefault()
    const id = newProjectId(name)
    await mkdir(dirOf(id))
    const info: WorkspaceInfo = { name, createdAt: Date.now() }
    await writeJsonFile(path.join(dirOf(id), INFO_FILE), info)
    return { id, ...info, projectCount: 0 }
  }

  async function rename(id: string, name: string): Promise<void> {
    const dir = dirOf(id)
    if (!(await isDirectory(dir))) throw new NotFoundError("Workspace tidak ditemukan")
    const info = await readOwnJson<WorkspaceInfo | null>(path.join(dir, INFO_FILE), null).catch(() => null)
    await writeJsonFile(path.join(dir, INFO_FILE), { createdAt: info?.createdAt ?? Date.now(), name })
  }

  /** Only empty workspaces can be removed, and never the default one. */
  async function remove(id: string): Promise<void> {
    if (id === DEFAULT_WORKSPACE) throw new ConflictError("Workspace utama tidak bisa dihapus")
    const dir = dirOf(id)
    if (!(await isDirectory(dir))) throw new NotFoundError("Workspace tidak ditemukan")
    if ((await projects.list(id)).length > 0) throw new ConflictError("Pindahkan atau hapus proyeknya dulu")
    const leftovers = (await readdir(dir)).filter((name) => name !== INFO_FILE)
    if (leftovers.length > 0) throw new ConflictError(`Folder workspace masih berisi: ${leftovers.slice(0, 3).join(", ")}`)
    await rm(path.join(dir, INFO_FILE), { force: true })
    await rmdir(dir)
  }

  return { list, create, rename, remove }
}

export type WorkspaceStore = ReturnType<typeof createWorkspaceStore>
