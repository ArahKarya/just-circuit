import { isSafePath } from "./extract-code"
import type { ProjectFiles } from "./types"

/** One SEARCH/REPLACE pair inside an edit block. */
export interface EditHunk {
  search: string
  replace: string
}

export interface FileEdit {
  path: string
  hunks: EditHunk[]
}

export interface EditResult {
  /** New content of every file whose hunks all applied. */
  files: Record<string, string>
  /** Human-readable reasons, one per file that was left unchanged. */
  failures: string[]
}

const FENCE = /```([^\n`]*)\n([\s\S]*?)```/g
const EDIT_INFO = /\bedit\s*=\s*["']?([^\s"']+)["']?/i
const HUNK = /<{7} SEARCH\n([\s\S]*?)\n?={7}\n([\s\S]*?)\n?>{7} REPLACE/g
const PREVIEW_CHARS = 80

/** Finds ```tsx edit=path blocks made of SEARCH/REPLACE hunks. */
export function extractEdits(reply: string): FileEdit[] {
  const edits: FileEdit[] = []
  for (const [, info, body] of reply.matchAll(FENCE)) {
    const path = info.match(EDIT_INFO)?.[1]
    if (!path || !isSafePath(path)) continue
    const hunks = [...body.matchAll(HUNK)].map(([, search, replace]) => ({ search, replace }))
    if (hunks.length > 0) edits.push({ path, hunks })
  }
  return edits
}

function countOccurrences(text: string, search: string): number {
  let count = 0
  for (let at = text.indexOf(search); at !== -1; at = text.indexOf(search, at + search.length)) count++
  return count
}

/** Re-indents replacement lines by the indentation difference between the file and the search text. */
function reindent(replace: string, fileIndent: string, searchIndent: string): string {
  return replace
    .split("\n")
    .map((line) => (line.startsWith(searchIndent) ? fileIndent + line.slice(searchIndent.length) : line))
    .join("\n")
}

const indentOf = (line: string): string => line.match(/^\s*/)?.[0] ?? ""

/** Matches the search lines against the file ignoring indentation and trailing spaces. */
function replaceLoosely(text: string, hunk: EditHunk): string | "missing" | "ambiguous" {
  const lines = text.split("\n")
  const wanted = hunk.search.split("\n").map((line) => line.trim())
  const starts: number[] = []
  for (let i = 0; i + wanted.length <= lines.length; i++) {
    if (wanted.every((line, j) => lines[i + j].trim() === line)) starts.push(i)
  }
  if (starts.length === 0) return "missing"
  if (starts.length > 1) return "ambiguous"
  const start = starts[0]
  const replacement = reindent(hunk.replace, indentOf(lines[start]), indentOf(hunk.search.split("\n")[0]))
  return [...lines.slice(0, start), ...(hunk.replace === "" ? [] : replacement.split("\n")), ...lines.slice(start + wanted.length)].join("\n")
}

function applyHunk(text: string, hunk: EditHunk): string | "missing" | "ambiguous" {
  const exact = countOccurrences(text, hunk.search)
  if (exact === 1) return text.replace(hunk.search, () => hunk.replace)
  if (exact > 1) return "ambiguous"
  return replaceLoosely(text, hunk)
}

function preview(search: string): string {
  const oneLine = search.trim().replace(/\s+/g, " ")
  return oneLine.length > PREVIEW_CHARS ? `${oneLine.slice(0, PREVIEW_CHARS)}…` : oneLine
}

function applyFileEdit(current: string | undefined, edit: FileEdit): { content: string } | { failure: string } {
  if (current === undefined) {
    const [first] = edit.hunks
    if (edit.hunks.length === 1 && first.search.trim() === "") return { content: `${first.replace.replace(/\s+$/, "")}\n` }
    return { failure: `${edit.path}: file belum ada (pakai SEARCH kosong atau kirim file lengkap)` }
  }
  let text = current
  for (const hunk of edit.hunks) {
    // An empty search would match everywhere (and never advances in countOccurrences).
    if (hunk.search.trim() === "") return { failure: `${edit.path}: SEARCH kosong hanya boleh untuk file baru` }
    const next = applyHunk(text, hunk)
    if (next === "missing") return { failure: `${edit.path}: teks SEARCH tidak ditemukan: "${preview(hunk.search)}"` }
    if (next === "ambiguous") return { failure: `${edit.path}: teks SEARCH muncul lebih dari sekali: "${preview(hunk.search)}"` }
    text = next
  }
  return { content: text }
}

/**
 * Applies SEARCH/REPLACE edits on top of the project files. A file changes only
 * when all of its hunks apply, so a half-applied edit never breaks the circuit.
 */
export function applyEdits(files: ProjectFiles, edits: readonly FileEdit[]): EditResult {
  const result: EditResult = { files: {}, failures: [] }
  for (const edit of edits) {
    const outcome = applyFileEdit(result.files[edit.path] ?? files[edit.path], edit)
    if ("failure" in outcome) result.failures.push(outcome.failure)
    else result.files[edit.path] = outcome.content
  }
  return result
}
