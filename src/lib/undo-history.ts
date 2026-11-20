import type { ProjectFiles } from "./types"

/** Before/after contents of each file one CAD edit touched; `undefined` means the file did not exist. */
export type FileChange = Readonly<Record<string, { before: string | undefined; after: string | undefined }>>

export interface UndoHistory {
  past: readonly FileChange[]
  future: readonly FileChange[]
}

export const MAX_UNDO_STEPS = 50
export const EMPTY_HISTORY: UndoHistory = { past: [], future: [] }

/** The files that differ between two snapshots, or null when nothing changed. */
export function diffFiles(before: ProjectFiles, after: ProjectFiles): FileChange | null {
  const change: Record<string, { before: string | undefined; after: string | undefined }> = {}
  for (const path of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (before[path] !== after[path]) change[path] = { before: before[path], after: after[path] }
  }
  return Object.keys(change).length > 0 ? change : null
}

/** Applies only the files `next` changed relative to `base` onto `latest`, keeping other edits. */
export function rebaseFiles(base: ProjectFiles, next: ProjectFiles, latest: ProjectFiles): ProjectFiles {
  const change = diffFiles(base, next)
  if (!change) return latest
  return applySide(latest, change, "after")
}

function applySide(files: ProjectFiles, change: FileChange, side: "before" | "after"): ProjectFiles {
  const result: Record<string, string> = { ...files }
  for (const [path, contents] of Object.entries(change)) {
    const value = contents[side]
    if (value === undefined) delete result[path]
    else result[path] = value
  }
  return result
}

/** Records an edit; a no-op edit leaves the history untouched. */
export function recordEdit(history: UndoHistory, before: ProjectFiles, after: ProjectFiles): UndoHistory {
  const change = diffFiles(before, after)
  if (!change) return history
  return { past: [...history.past.slice(-(MAX_UNDO_STEPS - 1)), change], future: [] }
}

export type StepResult =
  | { status: "empty" }
  /** A touched file was changed since (code editor, AI, terminal); stepping would discard that. */
  | { status: "conflict"; paths: string[] }
  | { status: "ok"; files: ProjectFiles; history: UndoHistory }

function step(history: UndoHistory, current: ProjectFiles, direction: "undo" | "redo"): StepResult {
  const from = direction === "undo" ? history.past : history.future
  const change = from[from.length - 1]
  if (!change) return { status: "empty" }
  const expected = direction === "undo" ? "after" : "before"
  const conflicts = Object.entries(change)
    .filter(([path, contents]) => current[path] !== contents[expected])
    .map(([path]) => path)
  if (conflicts.length > 0) return { status: "conflict", paths: conflicts }
  const files = applySide(current, change, direction === "undo" ? "before" : "after")
  const rest = from.slice(0, -1)
  const history2 =
    direction === "undo"
      ? { past: rest, future: [...history.future.slice(-(MAX_UNDO_STEPS - 1)), change] }
      : { past: [...history.past.slice(-(MAX_UNDO_STEPS - 1)), change], future: rest }
  return { status: "ok", files, history: history2 }
}

export const undoEdit = (history: UndoHistory, current: ProjectFiles): StepResult => step(history, current, "undo")
export const redoEdit = (history: UndoHistory, current: ProjectFiles): StepResult => step(history, current, "redo")
