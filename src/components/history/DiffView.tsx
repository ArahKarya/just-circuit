interface DiffViewProps {
  diff: string
  truncated: boolean
}

function lineClass(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---")) return "text-muted/70"
  if (line.startsWith("diff --git")) return "mt-3 border-t border-line pt-2 font-semibold text-ink first:mt-0 first:border-0 first:pt-0"
  if (line.startsWith("@@")) return "text-info/90"
  if (line.startsWith("+")) return "bg-added/12 text-added"
  if (line.startsWith("-")) return "bg-removed/12 text-removed"
  return "text-muted"
}

/** Unified diff with added/removed lines highlighted. */
export function DiffView({ diff, truncated }: DiffViewProps) {
  if (!diff.trim()) return <p className="rounded-xl border border-dashed border-line bg-surface/40 p-6 text-center text-sm text-muted">Versi ini tidak mengubah isi file.</p>
  const lines = diff.split("\n").filter((line) => !line.startsWith("index ") && !line.startsWith("new file mode") && !line.startsWith("deleted file mode"))
  return (
    <div className="overflow-auto rounded-xl border border-line bg-surface p-3 font-mono text-xs leading-5">
      {lines.map((line, index) => (
        <div key={index} className={`whitespace-pre rounded-xs px-1.5 ${lineClass(line)}`}>
          {line.startsWith("diff --git") ? line.replace(/^diff --git a\/(.+?) b\/.+$/, "$1") : line || " "}
        </div>
      ))}
      {truncated && <p className="mt-2.5 text-warn">Diff terlalu panjang, sisanya dipotong.</p>}
    </div>
  )
}
