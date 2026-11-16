import { lstat, mkdir, readdir, readFile, realpath, rm, rmdir } from "node:fs/promises"
import path from "node:path"
import { isEditablePath, MAX_FILE_BYTES, MAX_FILES, SCAFFOLD_FILES, SKIPPED_DIRS } from "../../shared/project-paths.js"
import { writeFileAtomic } from "./fs-utils.js"

export { isEditablePath, MAX_FILE_BYTES, MAX_FILES, SCAFFOLD_FILES }

export type FileMap = Record<string, string>

export class InvalidPathError extends Error {}

/** Resolves a project-relative path, refusing anything that escapes the project folder. */
export function resolveInside(root: string, relative: string): string {
  if (!isEditablePath(relative)) throw new InvalidPathError(`Nama file tidak valid: ${relative}`)
  const full = path.resolve(root, relative)
  if (!full.startsWith(root + path.sep)) throw new InvalidPathError(`Nama file tidak valid: ${relative}`)
  return full
}

async function walk(root: string, dir: string, out: string[]): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue
    const full = path.join(dir, entry.name)
    const relative = path.relative(root, full).split(path.sep).join("/")
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) await walk(root, full, out)
    } else if (entry.isFile() && !SCAFFOLD_FILES.has(relative) && isEditablePath(relative)) {
      out.push(relative)
    }
    if (out.length >= MAX_FILES) return
  }
}

export async function listEditableFiles(root: string): Promise<string[]> {
  const out: string[] = []
  await walk(root, root, out)
  return out.sort()
}

export async function readEditableFiles(root: string): Promise<FileMap> {
  const files: FileMap = {}
  for (const relative of await listEditableFiles(root)) {
    const full = path.join(root, relative)
    const info = await lstat(full)
    if (!info.isFile() || info.size > MAX_FILE_BYTES) continue
    files[relative] = await readFile(full, "utf8")
  }
  return files
}

/**
 * Refuses to write through symlinked folders (e.g. `lib -> /etc` made in the terminal):
 * the nearest existing parent must resolve inside the real project folder.
 */
async function assertNoSymlinkEscape(root: string, full: string): Promise<void> {
  const realRoot = await realpath(root)
  let dir = path.dirname(full)
  for (;;) {
    try {
      const resolved = await realpath(dir)
      if (resolved !== realRoot && !resolved.startsWith(realRoot + path.sep)) throw new InvalidPathError(`Folder ${path.relative(root, dir)} mengarah ke luar proyek`)
      break
    } catch (error) {
      if (error instanceof InvalidPathError || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      dir = path.dirname(dir)
    }
  }
  const existing = await lstat(full).catch(() => null)
  if (existing?.isSymbolicLink()) throw new InvalidPathError(`${path.relative(root, full)} adalah symlink`)
}

async function removeEmptyParents(root: string, file: string): Promise<void> {
  for (let dir = path.dirname(file); dir.startsWith(root + path.sep); dir = path.dirname(dir)) {
    try {
      await rmdir(dir)
    } catch {
      return
    }
  }
}

/** Makes the editable files on disk equal `next`: writes changed files, deletes missing ones. */
export async function syncEditableFiles(root: string, next: FileMap): Promise<void> {
  const entries = Object.entries(next)
  if (entries.length > MAX_FILES) throw new InvalidPathError(`Maksimal ${MAX_FILES} file per proyek`)
  const targets = entries.map(([relative, content]) => {
    if (SCAFFOLD_FILES.has(relative)) throw new InvalidPathError(`${relative} dikelola otomatis`)
    if (Buffer.byteLength(content) > MAX_FILE_BYTES) throw new InvalidPathError(`${relative} lebih dari 1 MB`)
    return { full: resolveInside(root, relative), content }
  })
  const current = await readEditableFiles(root)
  await mkdir(root, { recursive: true })
  // Delete first: on case-insensitive disks (macOS) "A.tsx" -> "a.tsx" is the same file,
  // and deleting after the write would remove the renamed file.
  for (const relative of Object.keys(current)) {
    if (Object.hasOwn(next, relative)) continue
    const full = path.join(root, relative)
    await rm(full, { force: true })
    await removeEmptyParents(root, full)
  }
  for (const { full, content } of targets) {
    const relative = path.relative(root, full).split(path.sep).join("/")
    if (current[relative] === content && Object.hasOwn(current, relative)) continue
    await assertNoSymlinkEscape(root, full)
    await writeFileAtomic(full, content)
  }
}
