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
          className="h-8 min-w-0 flex-1 rounded-md border border-line bg-surface px-2 text-xs text-ink placeholder:text-muted/55 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
        <button
          type="button"
          aria-label="Bedakan huruf besar/kecil"
          aria-pressed={caseSensitive}
          title="Bedakan huruf besar/kecil"
          onClick={() => setCaseSensitive((v) => !v)}
          className={`flex size-8 shrink-0 items-center justify-center rounded-md border transition ${
            caseSensitive ? "border-accent/50 bg-accent/12 text-accent" : "border-line bg-surface text-muted hover:text-ink"
          }`}
        >
          <CaseSensitive size={15} />
        </button>
      </div>
      {debounced && (
        <p className="px-0.5 text-[11px] font-medium text-muted tabular-nums">
          {result.hits.length === 0
            ? "Tidak ditemukan."
            : `${result.hits.length}${result.truncated ? `+ (maks ${MAX_SEARCH_HITS})` : ""} hasil di ${fileCount} file`}
        </p>
      )}
      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto" aria-label="Hasil pencarian">
        {result.hits.map((hit) => (
          <li key={`${hit.path}:${hit.line}`}>
            <button
              type="button"
              onClick={() => onOpen(hit.path, hit.line, hit.column)}
              className="block w-full rounded-md border border-transparent px-2 py-1.5 text-left transition hover:border-line hover:bg-raised"
            >
              <span className="block truncate font-mono text-[11px] text-accent">
                {hit.path}:{hit.line}
              </span>
              <span className="mt-0.5 block truncate font-mono text-xs text-ink">{hit.preview}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
