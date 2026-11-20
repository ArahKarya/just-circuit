const MAX_SUMMARY = 160

function clip(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim()
  return oneLine.length > MAX_SUMMARY ? `${oneLine.slice(0, MAX_SUMMARY)}…` : oneLine
}

const asRecord = (value: unknown): Record<string, unknown> => (value && typeof value === "object" ? (value as Record<string, unknown>) : {})

/** One line describing what a tool was asked to do, for the chat log. */
export function describeToolCall(name: string, input: unknown): string {
  const args = asRecord(input)
  switch (name) {
    case "read_file":
    case "write_file":
    case "edit_file":
    case "delete_file":
      return String(args.path ?? "")
    case "search_files":
    case "search_jlcpcb":
    case "search_parts":
      return `"${clip(String(args.query ?? ""))}"`
    case "search_footprints":
      return `"${clip(String(args.package ?? ""))}"`
    case "propose_command":
      return String(args.command ?? "")
    case "report_app_bug":
      return clip(String(args.title ?? ""))
    default:
      return ""
  }
}

/** One line describing a tool's result. */
export function describeToolResult(name: string, output: unknown): string {
  const result = asRecord(output)
  switch (name) {
    case "build_circuit": {
      if (result.problem) return String(result.problem)
      const errors = Array.isArray(result.errors) ? result.errors.length : 0
      const warnings = Array.isArray(result.warnings) ? result.warnings.length : 0
      return errors === 0 ? `build OK${warnings ? `, ${warnings} peringatan` : ""}` : `${errors} error: ${clip(String((result.errors as unknown[])[0]))}`
    }
    case "list_files":
      return `${Array.isArray(result.files) ? result.files.length : 0} file`
    case "read_file":
      return `${String(result.content ?? "").length} karakter${result.truncated ? " (dipotong)" : ""}`
    case "search_files":
      return `${Array.isArray(result.hits) ? result.hits.length : 0} baris cocok`
    case "search_jlcpcb": {
      const parts = Array.isArray(result.parts) ? (result.parts as Record<string, unknown>[]) : []
      return parts.length === 0 ? "tidak ada part" : clip(parts.slice(0, 3).map((p) => `${p.lcsc} ${p.mfr} (${p.package})`).join(", "))
    }
    case "search_parts": {
      const parts = Array.isArray(result.parts) ? (result.parts as Record<string, unknown>[]) : []
      return parts.length === 0 ? "tidak ada part" : clip(parts.slice(0, 3).map((p) => `${p.mpn} (${p.source})`).join(", "))
    }
    case "search_footprints": {
      const found = Array.isArray(result.footprints) ? (result.footprints as string[]) : []
      return found.length === 0 ? "tidak ada footprint" : clip(found.slice(0, 2).join(", "))
    }
    default:
      return "OK"
  }
}
