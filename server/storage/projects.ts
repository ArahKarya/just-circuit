import { randomBytes } from "node:crypto"
import { mkdir, readdir, rename, rm } from "node:fs/promises"
import path from "node:path"
import { ConflictError, NotFoundError } from "./errors.js"
import { createKeyedLock, isDirectory, readOwnJson, writeJsonFile } from "./fs-utils.js"
import { InvalidPathError, isEditablePath, listEditableFiles, readEditableFiles, syncEditableFiles, type FileMap } from "./project-files.js"
import { scaffoldFiles } from "./scaffold.js"

export interface ProjectMeta {
  id: string
  name: string
  entrypoint: string
  workspaceId: string
  createdAt: number
  updatedAt: number
}

export interface ProjectSummary extends ProjectMeta {
  fileCount: number
}

export interface StoredProject extends ProjectMeta {
  files: FileMap
}

export interface ChatMessageRecord {
  id: string
  projectId: string
  role: "user" | "assistant"
  content: string
  createdAt: number
  appliedFiles?: string[]
  previousFiles?: FileMap
  isError?: boolean
}

export interface NewProject {
  name: string
  files: FileMap
  entrypoint: string
  workspaceId?: string
  createdAt?: number
  updatedAt?: number
}

export interface ProjectPatch {
  name?: string
  entrypoint?: string
  files?: FileMap
}

export { NotFoundError } from "./errors.js"

export const DEFAULT_WORKSPACE = "default"
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,80}$/
const META_FILE = path.join(".cds", "project.json")
/** Written into a project when it is moved to the trash, so it can go back where it came from. */
const TRASH_INFO_FILE = path.join(".cds", "trash.json")
const TRASH_ENTRY = /^(\d{10,16})-([a-z0-9][a-z0-9-]{0,120})$/
/** Trash entries older than this are removed when the server starts. */
export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

export interface TrashEntry {
  entryId: string
  projectId: string
  name: string
  workspaceId: string
  deletedAt: number
  fileCount: number
}

interface TrashInfo {
  workspaceId: string
  deletedAt: number
}
const CHAT_FILE = path.join(".cds", "chat.json")

export function isValidId(id: string): boolean {
  return ID_PATTERN.test(id)
}

function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
  return slug || "proyek"
}

/** Folder name = id: readable in the terminal, unique thanks to a short random suffix. */
export function newProjectId(name: string): string {
  return `${slugify(name)}-${randomBytes(3).toString("hex")}`
}

/** Most recent chat messages kept per project. */
export const MAX_MESSAGES = 1000

function assertEntrypoint(entrypoint: string, files: FileMap | undefined): void {
  if (!isEditablePath(entrypoint)) throw new InvalidPathError(`File utama tidak valid: ${entrypoint}`)
  if (files && !(entrypoint in files)) throw new InvalidPathError(`File utama ${entrypoint} tidak ada di daftar file`)
}

/**
 * Projects stored as plain folders: dataDir/workspaces/<workspace>/<id>/ holds the
 * circuit files (usable with `tsci`), and .cds/ holds metadata and chat history.
 */
export function createProjectStore(dataDir: string) {
  const workspacesDir = path.join(dataDir, "workspaces")
  const trashDir = path.join(dataDir, "trash")
  const withLock = createKeyedLock()

  async function workspaceIds(): Promise<string[]> {
    try {
      const entries = await readdir(workspacesDir, { withFileTypes: true })
      return entries.filter((e) => e.isDirectory() && !e.isSymbolicLink() && isValidId(e.name)).map((e) => e.name)
    } catch {
      return []
    }
  }

  /** Folder of a project, searching every workspace (ids are unique across them). */
  async function locate(id: string): Promise<string> {
    if (!isValidId(id)) throw new NotFoundError("Proyek tidak ditemukan")
    for (const workspace of await workspaceIds()) {
      const dir = path.join(workspacesDir, workspace, id)
      if ((await isDirectory(dir)) && (await isDirectory(path.join(dir, ".cds")))) return dir
    }
    throw new NotFoundError("Proyek tidak ditemukan")
  }

  async function readMeta(dir: string): Promise<ProjectMeta> {
    const meta = await readOwnJson<ProjectMeta | null>(path.join(dir, META_FILE), null).catch(() => null)
    if (!meta) throw new NotFoundError("Proyek tidak ditemukan")
    return { ...meta, id: path.basename(dir), workspaceId: path.basename(path.dirname(dir)) }
  }

  async function list(workspaceId?: string): Promise<ProjectSummary[]> {
    const workspaces = workspaceId ? [workspaceId] : await workspaceIds()
    const metas: ProjectSummary[] = []
    for (const workspace of workspaces) {
      const dir = path.join(workspacesDir, workspace)
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        if (!entry.isDirectory() || !isValidId(entry.name)) continue
        try {
          const projectDir = path.join(dir, entry.name)
          metas.push({ ...(await readMeta(projectDir)), fileCount: (await listEditableFiles(projectDir)).length })
        } catch {
          // Not a CDS project (e.g. a folder made in the terminal); skip it.
        }
      }
    }
    return metas.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async function get(id: string): Promise<StoredProject> {
    const dir = await locate(id)
    return { ...(await readMeta(dir)), files: await readEditableFiles(dir) }
  }

  async function create(input: NewProject): Promise<StoredProject> {
    const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE
    if (!isValidId(workspaceId)) throw new NotFoundError("Workspace tidak ditemukan")
    assertEntrypoint(input.entrypoint, input.files)
    const workspaceDir = path.join(workspacesDir, workspaceId)
    await mkdir(workspaceDir, { recursive: true })
    if (!(await isDirectory(workspaceDir))) throw new NotFoundError("Workspace tidak ditemukan")
    let id = newProjectId(input.name)
    // Non-recursive mkdir fails on an existing folder, so an id collision never merges projects.
    for (let attempt = 0; ; attempt++) {
      try {
        await mkdir(path.join(workspaceDir, id))
        break
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST" || attempt >= 5) throw error
        id = newProjectId(input.name)
      }
    }
    const dir = path.join(workspaceDir, id)
    const now = Date.now()
    const meta: ProjectMeta = {
      id,
      name: input.name,
      entrypoint: input.entrypoint,
      workspaceId,
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
    }
    try {
      await syncEditableFiles(dir, input.files)
      for (const [file, content] of Object.entries(scaffoldFiles(meta))) {
        await writeJsonFile(path.join(dir, file), content)
      }
      await mkdir(path.join(dir, ".cds"))
      await writeJsonFile(path.join(dir, META_FILE), meta)
    } catch (error) {
      await rm(dir, { recursive: true, force: true })
      throw error
    }
    return { ...meta, files: await readEditableFiles(dir) }
  }

  function update(id: string, patch: ProjectPatch): Promise<StoredProject> {
    return withLock(id, async () => {
      const dir = await locate(id)
      const meta = await readMeta(dir)
      if (patch.entrypoint !== undefined || patch.files) {
        assertEntrypoint(patch.entrypoint ?? meta.entrypoint, patch.files ?? (await readEditableFiles(dir)))
      }
      if (patch.files) await syncEditableFiles(dir, patch.files)
      if (patch.entrypoint !== undefined && patch.entrypoint !== meta.entrypoint) {
        for (const [file, content] of Object.entries(scaffoldFiles({ id, entrypoint: patch.entrypoint }))) {
          await writeJsonFile(path.join(dir, file), content)
        }
      }
      const next: ProjectMeta = {
        ...meta,
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.entrypoint !== undefined ? { entrypoint: patch.entrypoint } : {}),
        updatedAt: Date.now(),
      }
      await writeJsonFile(path.join(dir, META_FILE), next)
      return { ...next, files: await readEditableFiles(dir) }
    })
  }

  /** Moves the project folder to dataDir/trash/<deletedAt>-<id>. */
  function remove(id: string): Promise<void> {
    return withLock(id, async () => {
      const dir = await locate(id)
      const deletedAt = Date.now()
      const info: TrashInfo = { workspaceId: path.basename(path.dirname(dir)), deletedAt }
      await writeJsonFile(path.join(dir, TRASH_INFO_FILE), info)
      await mkdir(trashDir, { recursive: true })
      await rename(dir, path.join(trashDir, `${deletedAt}-${id}`))
    })
  }

  /** Moves a project to another workspace (the folder moves on disk too). */
  function move(id: string, workspaceId: string): Promise<ProjectMeta> {
    return withLock(id, async () => {
      if (!isValidId(workspaceId) || !(await isDirectory(path.join(workspacesDir, workspaceId)))) throw new NotFoundError("Workspace tidak ditemukan")
      const dir = await locate(id)
      const target = path.join(workspacesDir, workspaceId, id)
      if (target !== dir) await rename(dir, target)
      return readMeta(target)
    })
  }

  function trashEntryDir(entryId: string): string {
    if (!TRASH_ENTRY.test(entryId)) throw new NotFoundError("Item tempat sampah tidak ditemukan")
    return path.join(trashDir, entryId)
  }

  async function listTrash(): Promise<TrashEntry[]> {
    const entries = await readdir(trashDir, { withFileTypes: true }).catch(() => [])
    const items: TrashEntry[] = []
    for (const entry of entries) {
      const match = TRASH_ENTRY.exec(entry.name)
      if (!match || !entry.isDirectory()) continue
      const dir = path.join(trashDir, entry.name)
      const meta = await readOwnJson<ProjectMeta | null>(path.join(dir, META_FILE), null).catch(() => null)
      if (!meta) continue
      const info = await readOwnJson<TrashInfo | null>(path.join(dir, TRASH_INFO_FILE), null).catch(() => null)
      items.push({
        entryId: entry.name,
        projectId: match[2],
        name: meta.name,
        workspaceId: info?.workspaceId ?? DEFAULT_WORKSPACE,
        deletedAt: info?.deletedAt ?? Number(match[1]),
        fileCount: (await listEditableFiles(dir)).length,
      })
    }
    return items.sort((a, b) => b.deletedAt - a.deletedAt)
  }

  /** Puts a trashed project back into its workspace (or the default one if that is gone). */
  async function restore(entryId: string): Promise<ProjectMeta> {
    const dir = trashEntryDir(entryId)
    if (!(await isDirectory(dir))) throw new NotFoundError("Item tempat sampah tidak ditemukan")
    const projectId = TRASH_ENTRY.exec(entryId)?.[2] ?? ""
    const info = await readOwnJson<TrashInfo | null>(path.join(dir, TRASH_INFO_FILE), null).catch(() => null)
    const wanted = info?.workspaceId && isValidId(info.workspaceId) ? info.workspaceId : DEFAULT_WORKSPACE
    const workspaceId = (await isDirectory(path.join(workspacesDir, wanted))) ? wanted : DEFAULT_WORKSPACE
    await mkdir(path.join(workspacesDir, workspaceId), { recursive: true })
    const target = path.join(workspacesDir, workspaceId, projectId)
    if (await isDirectory(target)) throw new ConflictError("Proyek dengan id yang sama sudah ada")
    await rename(dir, target)
    await rm(path.join(target, TRASH_INFO_FILE), { force: true })
    return readMeta(target)
  }

  async function purge(entryId: string): Promise<void> {
    await rm(trashEntryDir(entryId), { recursive: true, force: true })
  }

  /** Permanently removes trash entries deleted before `cutoff`; returns how many. */
  async function purgeOlderThan(cutoff: number): Promise<number> {
    const old = (await listTrash()).filter((entry) => entry.deletedAt < cutoff)
    for (const entry of old) await purge(entry.entryId)
    return old.length
  }

  async function messages(id: string): Promise<ChatMessageRecord[]> {
    return readOwnJson<ChatMessageRecord[]>(path.join(await locate(id), CHAT_FILE), [])
  }

  function changeMessages(id: string, change: (current: ChatMessageRecord[]) => ChatMessageRecord[]): Promise<ChatMessageRecord[]> {
    return withLock(`${id}:chat`, async () => {
      const file = path.join(await locate(id), CHAT_FILE)
      const next = change(await readOwnJson<ChatMessageRecord[]>(file, [])).slice(-MAX_MESSAGES)
      await writeJsonFile(file, next)
      return next
    })
  }

  return { list, get, create, update, remove, move, listTrash, restore, purge, purgeOlderThan, messages, changeMessages, workspacesDir }
}

export type ProjectStore = ReturnType<typeof createProjectStore>
