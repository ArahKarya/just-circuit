import JSZip from "jszip"
import { isEditablePath, MAX_FILE_BYTES, MAX_FILES, SCAFFOLD_FILES } from "../../shared/project-paths"
import type { ProjectFiles } from "./types"

export interface ImportedProject {
  name: string
  entrypoint: string
  files: ProjectFiles
  /** Files left out (unsupported type, too large, build output…). */
  skipped: string[]
}

export class ZipImportError extends Error {}

/** Checked before decompressing, so a tiny zip bomb can't freeze the tab. */
const MAX_TOTAL_BYTES = 20 * 1024 * 1024
const MAX_PACKAGE_JSON_BYTES = 64 * 1024

/** Uncompressed size as declared in the zip directory (JSZip keeps it on an internal field). */
function declaredSize(entry: JSZip.JSZipObject): number {
  const data = (entry as unknown as { _data?: { uncompressedSize?: number } })._data
  return typeof data?.uncompressedSize === "number" ? data.uncompressedSize : 0
}

const ENTRY_CANDIDATES = ["index.circuit.tsx", "index.tsx", "main.circuit.tsx", "index.board.tsx"]

/** Drops one wrapping folder (zips made from a folder put everything under "<name>/"). */
function stripCommonRoot(paths: string[]): { root: string; strip: (path: string) => string } {
  const firstSegments = new Set(paths.map((p) => p.split("/")[0]))
  const root = firstSegments.size === 1 && paths.every((p) => p.includes("/")) ? [...firstSegments][0] : ""
  return { root, strip: (path) => (root ? path.slice(root.length + 1) : path) }
}

function pickEntrypoint(files: ProjectFiles, packageMain: string | undefined): string | null {
  if (packageMain && files[packageMain] !== undefined) return packageMain
  const found = ENTRY_CANDIDATES.find((candidate) => files[candidate] !== undefined)
  if (found) return found
  return Object.keys(files).filter((path) => path.endsWith(".circuit.tsx")).sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b))[0] ?? null
}

function nameFrom(fileName: string, root: string, packageName: string | undefined): string {
  const fromFile = fileName.replace(/\.zip$/i, "")
  return (packageName || root || fromFile || "Proyek impor").slice(0, 100)
}

/** Reads a tsci project (or a CDS download) from a ZIP file. */
export async function readProjectZip(data: ArrayBuffer | Uint8Array, fileName: string): Promise<ImportedProject> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(data)
  } catch {
    throw new ZipImportError("File bukan ZIP yang valid")
  }
  const entries = Object.values(zip.files).filter((entry) => !entry.dir && !entry.name.startsWith("__MACOSX/"))
  const { root, strip } = stripCommonRoot(entries.map((entry) => entry.name))
  const files: Record<string, string> = {}
  const skipped: string[] = []
  let packageJson: { name?: string; main?: string } = {}
  let totalBytes = 0
  const seen = new Set<string>()

  for (const entry of entries) {
    const path = strip(entry.name)
    const size = declaredSize(entry)
    if (path === "package.json") {
      if (size > MAX_PACKAGE_JSON_BYTES) continue
      try {
        packageJson = JSON.parse(await entry.async("string")) as typeof packageJson
      } catch {
        // A broken package.json only loses the name/main hints.
      }
      continue
    }
    if (SCAFFOLD_FILES.has(path)) continue
    // Case-insensitive duplicates (A.tsx / a.tsx) would overwrite each other on macOS.
    if (!isEditablePath(path) || Object.keys(files).length >= MAX_FILES || size > MAX_FILE_BYTES || seen.has(path.toLowerCase())) {
      skipped.push(path)
      continue
    }
    totalBytes += size
    if (totalBytes > MAX_TOTAL_BYTES) throw new ZipImportError("Isi ZIP lebih dari 20 MB")
    seen.add(path.toLowerCase())
    const content = await entry.async("string")
    if (new TextEncoder().encode(content).length > MAX_FILE_BYTES) {
      skipped.push(path)
      continue
    }
    files[path] = content
  }

  const entrypoint = pickEntrypoint(files, typeof packageJson.main === "string" ? packageJson.main : undefined)
  if (!entrypoint) throw new ZipImportError("ZIP tidak berisi file sirkuit (mis. index.circuit.tsx)")
  return { name: nameFrom(fileName, root, packageJson.name), entrypoint, files, skipped }
}
