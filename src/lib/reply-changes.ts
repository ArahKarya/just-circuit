import { applyEdits, extractEdits } from "./apply-edits"
import { extractFiles } from "./extract-code"
import type { ProjectFiles } from "./types"

export interface ReplyChanges {
  /** New content per changed file (full files first, then edits on top). */
  changes: Record<string, string>
  /** Edits that could not be applied; those files keep their previous content. */
  failures: string[]
}

/** Everything an assistant reply wants to change in the project. */
export function changesFromReply(reply: string, files: ProjectFiles, entrypoint: string): ReplyChanges {
  const fullFiles = Object.fromEntries(extractFiles(reply, entrypoint).map((f) => [f.path, f.content]))
  const edited = applyEdits({ ...files, ...fullFiles }, extractEdits(reply))
  return { changes: { ...fullFiles, ...edited.files }, failures: edited.failures }
}
