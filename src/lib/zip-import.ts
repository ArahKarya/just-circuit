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

  for (const entry of entries) {
    const path = strip(entry.name)
    if (path === "package.json") {
      try {
        packageJson = JSON.parse(await entry.async("string")) as typeof packageJson
      } catch {
        // A broken package.json only loses the name/main hints.
      }
      continue
    }
    if (SCAFFOLD_FILES.has(path)) continue
    if (!isEditablePath(path) || Object.keys(files).length >= MAX_FILES) {
      skipped.push(path)
      continue
    }
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
