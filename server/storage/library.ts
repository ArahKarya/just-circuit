import { mkdir, readdir, rm } from "node:fs/promises"
import path from "node:path"
import { NotFoundError } from "./errors.js"
import { isDirectory, readOwnJson, writeJsonFile } from "./fs-utils.js"
import { InvalidPathError, isEditablePath, readEditableFiles, syncEditableFiles, type FileMap } from "./project-files.js"
import { isValidId, newProjectId } from "./projects.js"

export interface LibraryItem {
  id: string
  name: string
  description: string
  entry: string
  exports: string[]
  fileCount: number
  createdAt: number
  updatedAt: number
}

interface ItemInfo {
  name: string
  description: string
  entry: string
  createdAt: number
  updatedAt: number
}

export interface NewLibraryItem {
  name: string
  description: string
  entry: string
  files: FileMap
}

const INFO_FILE = "item.json"
const FILES_DIR = "files"

function exportsOf(source: string | undefined): string[] {
  if (!source) return []
  return [...new Set([...source.matchAll(/export\s+(?:const|function)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]))]
}

/** Reusable blocks shared by all projects: dataDir/library/<id>/{item.json, files/…}. */
export function createLibraryStore(dataDir: string) {
  const root = path.join(dataDir, "library")
  const dirOf = (id: string): string => {
    if (!isValidId(id)) throw new NotFoundError("Item library tidak ditemukan")
    return path.join(root, id)
  }

  async function load(id: string): Promise<{ item: LibraryItem; files: FileMap }> {
    const dir = dirOf(id)
    const info = await readOwnJson<ItemInfo | null>(path.join(dir, INFO_FILE), null).catch(() => null)
    if (!info || !(await isDirectory(path.join(dir, FILES_DIR)))) throw new NotFoundError("Item library tidak ditemukan")
    const files = await readEditableFiles(path.join(dir, FILES_DIR))
    return { item: { id, ...info, exports: exportsOf(files[info.entry]), fileCount: Object.keys(files).length }, files }
  }

  async function list(): Promise<LibraryItem[]> {
    const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
    const items: LibraryItem[] = []
    for (const entry of entries) {
      if (!entry.isDirectory() || !isValidId(entry.name)) continue
      try {
        items.push((await load(entry.name)).item)
      } catch {
        // Broken item folder: skip it.
      }
    }
    return items.sort((a, b) => a.name.localeCompare(b.name, "id"))
  }

  async function get(id: string): Promise<LibraryItem & { files: FileMap }> {
    const { item, files } = await load(id)
    return { ...item, files }
  }

  async function create(input: NewLibraryItem): Promise<LibraryItem> {
    if (!isEditablePath(input.entry) || !Object.hasOwn(input.files, input.entry)) throw new InvalidPathError("File utama item tidak ada di daftar file")
    await mkdir(root, { recursive: true })
    const id = newProjectId(input.name)
    const dir = dirOf(id)
    await mkdir(dir)
    try {
      await syncEditableFiles(path.join(dir, FILES_DIR), input.files)
      const now = Date.now()
      await writeJsonFile(path.join(dir, INFO_FILE), { name: input.name, description: input.description, entry: input.entry, createdAt: now, updatedAt: now })
    } catch (error) {
      await rm(dir, { recursive: true, force: true })
      throw error
    }
    return (await load(id)).item
  }

  async function update(id: string, patch: { name?: string; description?: string }): Promise<LibraryItem> {
    const dir = dirOf(id)
    const { item } = await load(id)
    const info: ItemInfo = { name: patch.name ?? item.name, description: patch.description ?? item.description, entry: item.entry, createdAt: item.createdAt, updatedAt: Date.now() }
    await writeJsonFile(path.join(dir, INFO_FILE), info)
    return (await load(id)).item
  }

  async function remove(id: string): Promise<void> {
    await load(id)
    await rm(dirOf(id), { recursive: true, force: true })
  }

  return { list, get, create, update, remove }
}

export type LibraryStore = ReturnType<typeof createLibraryStore>
