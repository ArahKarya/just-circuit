import { isEditablePath } from "../../shared/project-paths"
import { MANUAL_EDITS_FILE } from "./manual-edits"
import { importSpecifier } from "./project-ops"
import type { Project } from "./types"

export interface TreeFolder {
  kind: "folder"
  name: string
  path: string
  children: TreeNode[]
}

export interface TreeFile {
  kind: "file"
  name: string
  path: string
}

export type TreeNode = TreeFolder | TreeFile

/** Folders first, then files, both alphabetical; the entrypoint comes first among root files. */
export function buildTree(paths: readonly string[], entrypoint?: string): TreeNode[] {
  const root: TreeFolder = { kind: "folder", name: "", path: "", children: [] }
  for (const file of paths) {
    const parts = file.split("/")
    let folder = root
    parts.slice(0, -1).forEach((name, index) => {
      const path = parts.slice(0, index + 1).join("/")
      let next = folder.children.find((c): c is TreeFolder => c.kind === "folder" && c.name === name)
      if (!next) {
        next = { kind: "folder", name, path, children: [] }
        folder.children.push(next)
      }
      folder = next
    })
    folder.children.push({ kind: "file", name: parts[parts.length - 1], path: file })
  }
  const sort = (nodes: TreeNode[]): TreeNode[] =>
    nodes
      .map((n) => (n.kind === "folder" ? { ...n, children: sort(n.children) } : n))
      .sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1
        if (a.path === entrypoint) return -1
        if (b.path === entrypoint) return 1
        return a.name.localeCompare(b.name)
      })
  return sort(root.children)
}

export class FileOpError extends Error {}

const has = (files: Project["files"], path: string): boolean => Object.hasOwn(files, path)

function assertValidNewPath(project: Project, path: string): void {
  if (!isEditablePath(path)) throw new FileOpError(`Nama file tidak valid: ${path}. Pakai huruf, angka, - _ . dan ekstensi .tsx/.ts/.json/.md`)
  if (has(project.files, path)) throw new FileOpError(`${path} sudah ada`)
  // A path can't be both a file and a folder.
  const parts = path.split("/")
  const fileAsFolder = parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/")).find((prefix) => has(project.files, prefix))
  if (fileAsFolder) throw new FileOpError(`${fileAsFolder} adalah file, bukan folder`)
  if (Object.keys(project.files).some((p) => p.startsWith(`${path}/`))) throw new FileOpError(`${path} sudah ada sebagai folder`)
}

/** Keeps `import … from "./manual-edits.json"` working when the entrypoint moves to another folder. */
function retargetManualEditsImport(source: string, from: string, to: string): string {
  const oldSpecifier = importSpecifier(from, MANUAL_EDITS_FILE)
  const newSpecifier = importSpecifier(to, MANUAL_EDITS_FILE)
  if (oldSpecifier === newSpecifier) return source
  return source.split(`"${oldSpecifier}"`).join(`"${newSpecifier}"`).split(`'${oldSpecifier}'`).join(`'${newSpecifier}'`)
}

export function normalizePath(input: string): string {
  return input.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").replace(/\/{2,}/g, "/")
}

/** Starter content for a new file, based on its type. */
export function starterContent(path: string): string {
  if (path.endsWith(".json")) return "{}\n"
  if (!path.endsWith(".tsx")) return ""
  const base = path.split("/").pop()?.replace(/\.(circuit\.)?tsx$/, "") ?? "Component"
  const name = base.replace(/(^|[-_.\s])(\w)/g, (_m, _sep, c: string) => c.toUpperCase()).replace(/\W/g, "") || "Component"
  const safe = /^[A-Za-z]/.test(name) ? name : `C${name}`
  return `export const ${safe} = () => (\n  <group name="${base}">\n  </group>\n)\n`
}

export function addFile(project: Project, rawPath: string, content?: string): Project {
  const path = normalizePath(rawPath)
  assertValidNewPath(project, path)
  return { ...project, files: { ...project.files, [path]: content ?? starterContent(path) }, updatedAt: Date.now() }
}

/** Renames a file or a whole folder (every file under it). */
export function renamePath(project: Project, from: string, rawTo: string): Project {
  const to = normalizePath(rawTo)
  if (to === from) return project
  const isFile = has(project.files, from)
  const moves = isFile ? [[from, to]] : Object.keys(project.files).filter((p) => p.startsWith(`${from}/`)).map((p) => [p, `${to}${p.slice(from.length)}`])
  if (moves.length === 0) throw new FileOpError(`${from} tidak ditemukan`)
  if (!isFile && Object.keys(project.files).some((p) => p.startsWith(`${to}/`))) throw new FileOpError(`Folder ${to} sudah ada`)
  const remaining = Object.fromEntries(Object.entries(project.files).filter(([p]) => !moves.some(([old]) => old === p)))
  const files: Record<string, string> = { ...remaining }
  for (const [old, next] of moves) {
    assertValidNewPath({ ...project, files }, next)
    files[next] = project.files[old]
  }
  const entry = moves.find(([old]) => old === project.entrypoint)
  if (!entry) return { ...project, files, updatedAt: Date.now() }
  if (!entry[1].endsWith(".tsx")) throw new FileOpError("File utama harus berakhiran .tsx")
  files[entry[1]] = retargetManualEditsImport(files[entry[1]], entry[0], entry[1])
  return { ...project, files, entrypoint: entry[1], updatedAt: Date.now() }
}

/** Deletes a file or every file in a folder; the entrypoint can't be deleted. */
export function deletePath(project: Project, path: string): Project {
  const doomed = has(project.files, path) ? [path] : Object.keys(project.files).filter((p) => p.startsWith(`${path}/`))
  if (doomed.includes(project.entrypoint)) throw new FileOpError(`${project.entrypoint} adalah file utama dan tidak bisa dihapus`)
  const files = Object.fromEntries(Object.entries(project.files).filter(([p]) => !doomed.includes(p)))
  return { ...project, files, updatedAt: Date.now() }
}

export interface SearchHit {
  path: string
  line: number
  column: number
  preview: string
}

export const MAX_SEARCH_HITS = 300

/** Plain-text search across all files (case-insensitive unless `caseSensitive`). */
export function searchFiles(files: Readonly<Record<string, string>>, query: string, caseSensitive = false): { hits: SearchHit[]; truncated: boolean } {
  const needle = caseSensitive ? query : query.toLowerCase()
  const hits: SearchHit[] = []
  if (!needle) return { hits, truncated: false }
  for (const path of Object.keys(files).sort()) {
    const lines = files[path].split("\n")
    for (let i = 0; i < lines.length; i++) {
      const haystack = caseSensitive ? lines[i] : lines[i].toLowerCase()
      const column = haystack.indexOf(needle)
      if (column === -1) continue
      if (hits.length >= MAX_SEARCH_HITS) return { hits, truncated: true }
      hits.push({ path, line: i + 1, column: column + 1, preview: lines[i].trim().slice(0, 160) })
    }
  }
  return { hits, truncated: false }
}
