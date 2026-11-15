import { importSpecifier, withFiles } from "./project-ops"
import type { Project } from "./types"

/** Drag-and-drop positions from the PCB/schematic viewers live here, as in the tsci CLI. */
export const MANUAL_EDITS_FILE = "manual-edits.json"

const BOARD_TAG = /<(board|subcircuit)\b/
const DEFAULT_IMPORT_NAME = "manualEdits"

export function parseManualEdits(raw: string | undefined): Record<string, unknown> {
  if (!raw?.trim()) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** Drops float noise such as 4.000000000000002 (keeps 0.0001 mm). */
function roundCoordinates(_key: string, value: unknown): unknown {
  return typeof value === "number" ? Math.round(value * 10_000) / 10_000 : value
}

export interface WiredEntry {
  source: string
  /** False when the entry has no <board>/<subcircuit> tag to attach the edits to. */
  wired: boolean
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Makes sure the entry file imports manual-edits.json and passes it to the
 * first <board> (or <subcircuit>) through the `manualEdits` prop.
 */
export function wireManualEdits(source: string, entryPath: string): WiredEntry {
  const specifier = importSpecifier(entryPath, MANUAL_EDITS_FILE)
  const existingImport = source.match(new RegExp(`import\\s+([A-Za-z_$][\\w$]*)\\s+from\\s+["']${escapeRegExp(specifier)}["']`))
  const boardMatch = BOARD_TAG.exec(source)
  if (!boardMatch) return { source, wired: false }

  const importName = existingImport?.[1] ?? DEFAULT_IMPORT_NAME
  const tagStart = boardMatch.index
  const tagEnd = source.indexOf(">", tagStart)
  const openingTag = tagEnd === -1 ? source.slice(tagStart) : source.slice(tagStart, tagEnd)
  const hasProp = /\bmanualEdits\s*=/.test(openingTag)

  let next = source
  if (!hasProp) {
    const insertAt = tagStart + boardMatch[0].length
    next = `${next.slice(0, insertAt)} manualEdits={${importName}}${next.slice(insertAt)}`
  }
  if (!existingImport) next = `import ${importName} from "${specifier}"\n${next}`
  return { source: next, wired: true }
}

/** Stores new manual edits and wires them into the entrypoint. */
export function withManualEdits(project: Project, manualEdits: unknown, now: number = Date.now()): { project: Project; wired: boolean } {
  const entry = wireManualEdits(project.files[project.entrypoint] ?? "", project.entrypoint)
  const files = {
    [MANUAL_EDITS_FILE]: `${JSON.stringify(manualEdits, roundCoordinates, 2)}\n`,
    ...(entry.wired ? { [project.entrypoint]: entry.source } : {}),
  }
  return { project: withFiles(project, files, now), wired: entry.wired }
}
