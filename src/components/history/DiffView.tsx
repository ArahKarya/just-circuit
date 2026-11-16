interface DiffViewProps {
  diff: string
  truncated: boolean
}

function lineClass(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---")) return "text-muted"
  if (line.startsWith("diff --git")) return "mt-3 border-t border-line pt-2 font-semibold text-ink first:mt-0 first:border-0 first:pt-0"
  if (line.startsWith("@@")) return "text-sky-400"
  if (line.startsWith("+")) return "bg-emerald-500/10 text-emerald-300"
  if (line.startsWith("-")) return "bg-red-500/10 text-red-300"
  return "text-muted"
}

/** Unified diff with added/removed lines highlighted. */
export function DiffView({ diff, truncated }: DiffViewProps) {
  if (!diff.trim()) return <p className="text-sm text-muted">Versi ini tidak mengubah isi file.</p>
  const lines = diff.split("\n").filter((line) => !line.startsWith("index ") && !line.startsWith("new file mode") && !line.startsWith("deleted file mode"))
  return (
    <div className="overflow-auto rounded-md border border-line bg-surface p-2 font-mono text-xs leading-5">
      {lines.map((line, index) => (
        <div key={index} className={`whitespace-pre px-1 ${lineClass(line)}`}>
          {line.startsWith("diff --git") ? line.replace(/^diff --git a\/(.+?) b\/.+$/, "$1") : line || " "}
        </div>
      ))}
      {truncated && <p className="mt-2 text-amber-300">Diff terlalu panjang, sisanya dipotong.</p>}
    </div>
  )
}
