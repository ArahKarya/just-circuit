import { addComponentFile, withFiles } from "./project-ops"
import type { Project, ProjectFiles } from "./types"

export interface PlannedWrite {
  /** The whole file map after the write, ready for the undo-recording commit. */
  files: ProjectFiles
  /** The file the user asked for. */
  path: string
  /** Existing files (other than the entry import) whose content would be replaced. */
  overwrites: string[]
}

/**
 * Plans writing a generated file. The entry file only gains an import when `insertImport`
 * is set, so an unused import is never added behind the user's back.
 */
export function planFileWrite(project: Project, path: string, contents: string, insertImport = false): PlannedWrite {
  const next = insertImport ? addComponentFile(project, path, contents).project : withFiles(project, { [path]: contents })
  const existing = project.files[path]
  const overwrites = existing !== undefined && existing !== contents ? [path] : []
  return { files: next.files, path, overwrites }
}
