import { lstat, mkdir, readdir, readFile, realpath, rm, rmdir } from "node:fs/promises"
import path from "node:path"
import { writeFileAtomic } from "./fs-utils.js"

export type FileMap = Record<string, string>

/** File types the editor shows and the AI may write. */
const EDITABLE_EXTENSIONS = new Set([".tsx", ".ts", ".jsx", ".js", ".json", ".md", ".txt", ".csv"])
/** tsci scaffold files: kept on disk for the CLI and terminal, hidden from the editor and AI. */
export const SCAFFOLD_FILES = new Set(["package.json", "tscircuit.config.json", "tsconfig.json", "bun.lock", "bun.lockb", "package-lock.json", "pnpm-lock.yaml"])
const SKIPPED_DIRS = new Set(["node_modules", "dist"])
/** Never written through the API: tools execute what is inside, or read it as configuration. */
const FORBIDDEN_SEGMENTS = new Set([...SKIPPED_DIRS, "package.json", "bunfig.toml"])
const CONFIG_NAME = /^(tscircuit|vite|vitest|bunfig|tsconfig)\.config\.|^tsconfig\./i
const SEGMENT = /^[\w-][\w.-]*$/
export const MAX_FILE_BYTES = 1024 * 1024
export const MAX_FILES = 500

export class InvalidPathError extends Error {}

/** Relative, forward-slash path with no dot-segments or hidden parts, of an editable type. */
export function isEditablePath(relative: string): boolean {
  if (relative.length === 0 || relative.length > 300) return false
  const segments = relative.split("/")
  return (
    segments.every((s) => SEGMENT.test(s) && s !== "." && s !== ".." && !FORBIDDEN_SEGMENTS.has(s.toLowerCase())) &&
    !CONFIG_NAME.test(segments[segments.length - 1]) &&
    EDITABLE_EXTENSIONS.has(path.extname(relative).toLowerCase())
  )
}

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
  for (const { full, content } of targets) {
    const relative = path.relative(root, full).split(path.sep).join("/")
    if (current[relative] === content) continue
    await assertNoSymlinkEscape(root, full)
    await writeFileAtomic(full, content)
  }
  for (const relative of Object.keys(current)) {
    if (relative in next) continue
    const full = path.join(root, relative)
    await rm(full, { force: true })
    await removeEmptyParents(root, full)
  }
}
