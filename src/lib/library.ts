import { exportedNames, importSpecifier, withFiles } from "./project-ops"
import type { Project, ProjectFiles } from "./types"

/** A reusable block saved from a project (power module, I/O channel, a connector…). */
export interface LibraryItem {
  id: string
  name: string
  description: string
  /** Main file inside the item; its exports are what other projects import. */
  entry: string
  exports: string[]
  fileCount: number
  createdAt: number
  updatedAt: number
}

export interface LibraryItemWithFiles extends LibraryItem {
  files: ProjectFiles
}

export interface LibrarySelection {
  files: Record<string, string>
  entry: string
  /** Relative imports that point outside the saved files (they won't come along). */
  missingImports: string[]
}

const RELATIVE_IMPORT = /\bfrom\s+["'](\.{1,2}\/[^"']+)["']/g
const CODE_FILE = /\.(tsx|ts|jsx|js)$/

function resolveImport(fromFile: string, specifier: string): string {
  const parts = fromFile.split("/").slice(0, -1)
  for (const segment of specifier.split("/")) {
    if (segment === "..") parts.pop()
    else if (segment !== ".") parts.push(segment)
  }
  return parts.join("/")
}

function exists(files: ProjectFiles, path: string): boolean {
  return [path, `${path}.tsx`, `${path}.ts`, `${path}.jsx`, `${path}.js`, `${path}.json`, `${path}/index.tsx`, `${path}/index.ts`].some((p) => Object.hasOwn(files, p))
}

/** Files saved when "Simpan ke library" is used on a file or a folder of the project. */
export function selectForLibrary(project: Project, path: string): LibrarySelection {
  const isFile = Object.hasOwn(project.files, path)
  const prefix = isFile ? path.split("/").slice(0, -1).join("/") : path
  const picked = isFile ? [path] : Object.keys(project.files).filter((p) => p.startsWith(`${path}/`))
  if (picked.length === 0) throw new Error(`${path} tidak ditemukan`)
  const strip = (p: string) => (prefix ? p.slice(prefix.length + 1) : p)
  const files = Object.fromEntries(picked.map((p) => [strip(p), project.files[p]]))
  const missing = new Set<string>()
  for (const p of picked) {
    for (const [, specifier] of project.files[p].matchAll(RELATIVE_IMPORT)) {
      const target = resolveImport(p, specifier)
      const inside = picked.some((q) => q === target || q.startsWith(`${target}.`) || q.startsWith(`${target}/`))
      if (!inside && exists(project.files, target)) missing.add(specifier)
    }
  }
  const codeFiles = Object.keys(files).filter((f) => CODE_FILE.test(f))
  const entry = isFile ? strip(path) : (codeFiles.find((f) => /^index\.(tsx|ts)$/.test(f)) ?? codeFiles.find((f) => exportedNames(files[f]).length > 0) ?? codeFiles[0] ?? Object.keys(files)[0])
  return { files, entry, missingImports: [...missing].sort() }
}

export function slugify(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "komponen"
}

export interface InsertResult {
  project: Project
  folder: string
  componentName: string | null
}

/** Copies a library item into lib/<name>/ and imports its first export in the entrypoint. */
export function insertLibraryItem(project: Project, item: LibraryItemWithFiles): InsertResult {
  const base = `lib/${slugify(item.name)}`
  let folder = base
  for (let n = 2; Object.keys(project.files).some((p) => p.startsWith(`${folder}/`)); n++) folder = `${base}-${n}`
  const copied = Object.fromEntries(Object.entries(item.files).map(([p, content]) => [`${folder}/${p}`, content]))
  const entryPath = `${folder}/${item.entry}`
  const componentName = item.exports[0] ?? null
  const entrySource = project.files[project.entrypoint] ?? ""
  const usedNames = new Set([...entrySource.matchAll(/import\s*\{([^}]*)\}/g)].flatMap((m) => m[1].split(",").map((n) => n.trim().split(/\s+as\s+/).pop() ?? "")))
  const canImport = componentName !== null && CODE_FILE.test(item.entry) && !usedNames.has(componentName)
  const nextEntry = canImport ? `import { ${componentName} } from "${importSpecifier(project.entrypoint, entryPath)}"\n${entrySource}` : entrySource
  return { project: withFiles(project, { ...copied, [project.entrypoint]: nextEntry }), folder, componentName: canImport ? componentName : null }
}

/** Short catalog of the user's library for the AI's system prompt. */
export function describeLibrary(items: readonly LibraryItem[]): string {
  return items
    .slice(0, 50)
    .map((item) => `- ${item.name}${item.exports.length ? ` (exports: ${item.exports.join(", ")})` : ""}${item.description ? `: ${item.description}` : ""}`)
    .join("\n")
}
