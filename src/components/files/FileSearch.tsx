import { CaseSensitive } from "lucide-react"
import { useMemo, useState } from "react"
import { useDebounced } from "../../hooks/useDebounced"
import { MAX_SEARCH_HITS, searchFiles } from "../../lib/file-tree"
import type { ProjectFiles } from "../../lib/types"

interface FileSearchProps {
  files: ProjectFiles
  onOpen: (path: string, line: number, column: number) => void
}

const SEARCH_DEBOUNCE_MS = 150

export function FileSearch({ files, onOpen }: FileSearchProps) {
  const [query, setQuery] = useState("")
  const [caseSensitive, setCaseSensitive] = useState(false)
  const debounced = useDebounced(query, SEARCH_DEBOUNCE_MS)
  const result = useMemo(() => searchFiles(files, debounced, caseSensitive), [files, debounced, caseSensitive])
  const fileCount = new Set(result.hits.map((h) => h.path)).size

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
      <div className="flex gap-1">
        <input
          autoFocus
          type="search"
          aria-label="Teks yang dicari"
          placeholder="Cari di semua file…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-8 min-w-0 flex-1 rounded border border-line bg-surface px-2 text-xs focus:border-accent focus:outline-none"
        />
        <button
          type="button"
          aria-label="Bedakan huruf besar/kecil"
          aria-pressed={caseSensitive}
          title="Bedakan huruf besar/kecil"
          onClick={() => setCaseSensitive((v) => !v)}
          className={`flex size-8 items-center justify-center rounded border ${caseSensitive ? "border-accent text-accent" : "border-line text-muted"}`}
        >
          <CaseSensitive size={15} />
        </button>
      </div>
      {debounced && (
        <p className="text-xs text-muted">
          {result.hits.length === 0 ? "Tidak ditemukan." : `${result.hits.length}${result.truncated ? `+ (maks ${MAX_SEARCH_HITS})` : ""} hasil di ${fileCount} file`}
        </p>
      )}
      <ul className="min-h-0 flex-1 overflow-y-auto" aria-label="Hasil pencarian">
        {result.hits.map((hit) => (
          <li key={`${hit.path}:${hit.line}`}>
            <button type="button" onClick={() => onOpen(hit.path, hit.line, hit.column)} className="block w-full rounded px-1.5 py-1 text-left hover:bg-raised">
              <span className="block truncate font-mono text-[11px] text-muted">{hit.path}:{hit.line}</span>
              <span className="block truncate font-mono text-xs text-ink">{hit.preview}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
