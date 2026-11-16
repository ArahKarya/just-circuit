/**
 * Which project files the editor shows and the AI may write. Shared by the server
 * (enforcement) and the browser (ZIP import), so both apply the same rules.
 */

export const EDITABLE_EXTENSIONS = new Set([".tsx", ".ts", ".jsx", ".js", ".json", ".md", ".txt", ".csv"])
/** tsci scaffold files: kept on disk for the CLI and terminal, hidden from the editor and AI. */
export const SCAFFOLD_FILES = new Set(["package.json", "tscircuit.config.json", "tsconfig.json", "bun.lock", "bun.lockb", "package-lock.json", "pnpm-lock.yaml"])
export const SKIPPED_DIRS = new Set(["node_modules", "dist"])
/** Never written through the API: tools execute what is inside, or read it as configuration. */
const FORBIDDEN_SEGMENTS = new Set([...SKIPPED_DIRS, "package.json", "bunfig.toml"])
const CONFIG_NAME = /^(tscircuit|vite|vitest|bunfig|tsconfig|jsconfig)\.config\.|^(tsconfig|jsconfig|bunfig)\./i
/** Starts with a letter, digit or underscore: never "-x" (it would read as a CLI option). */
const SEGMENT = /^\w[\w.-]*$/
export const MAX_FILE_BYTES = 1024 * 1024
export const MAX_FILES = 500

/** Relative, forward-slash path with no dot-segments or hidden parts, of an editable type. */
export function isEditablePath(relative: string): boolean {
  if (relative.length === 0 || relative.length > 300) return false
  const segments = relative.split("/")
  return (
    segments.every((s) => SEGMENT.test(s) && s !== "." && s !== ".." && !FORBIDDEN_SEGMENTS.has(s.toLowerCase())) &&
    !CONFIG_NAME.test(segments[segments.length - 1]) &&
    EDITABLE_EXTENSIONS.has(extname(relative))
  )
}

function extname(file: string): string {
  const base = file.slice(file.lastIndexOf("/") + 1)
  const dot = base.lastIndexOf(".")
  return dot > 0 ? base.slice(dot).toLowerCase() : ""
}
