import { CircleAlert, CircuitBoard, Sparkles, TriangleAlert } from "lucide-react"
import { useMemo, useState } from "react"
import type { DesignIssue, IssueCategory } from "../lib/drc"
import { Button } from "./ui"

interface ProblemsPanelProps {
  issues: DesignIssue[]
  isBuilding: boolean
  /** Jumps to where a component is declared; false when it isn't found in the code. */
  onRevealComponent: (name: string) => boolean
  onAskAiToFix: (issues: DesignIssue[]) => void
  canAskAi: boolean
}

type Filter = "all" | "error" | "warning"

const CATEGORY_LABELS: Record<IssueCategory, string> = {
  build: "Build",
  pcb: "PCB",
  schematic: "Skematik",
  source: "Rangkaian",
}

export function ProblemsPanel({ issues, isBuilding, onRevealComponent, onAskAiToFix, canAskAi }: ProblemsPanelProps) {
  const [filter, setFilter] = useState<Filter>("all")
  const [notFound, setNotFound] = useState<string | null>(null)
  const errors = issues.filter((i) => i.severity === "error")
  const warnings = issues.length - errors.length
  const visible = useMemo(() => (filter === "all" ? issues : issues.filter((i) => i.severity === filter)), [issues, filter])

  const reveal = (name: string) => setNotFound(onRevealComponent(name) ? null : name)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-line px-3 py-1.5 text-xs" role="group" aria-label="Saring masalah">
        {([
          ["all", `Semua ${issues.length}`],
          ["error", `Error ${errors.length}`],
          ["warning", `Peringatan ${warnings}`],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={filter === id}
            onClick={() => setFilter(id)}
            className={`rounded px-2 py-1 ${filter === id ? "bg-raised text-ink" : "text-muted hover:text-ink"}`}
          >
            {label}
          </button>
        ))}
        {errors.length > 0 && (
          <Button className="ml-auto min-h-7 px-2 text-xs" disabled={!canAskAi} onClick={() => onAskAiToFix(errors)} title="Kirim semua error ke AI">
            <Sparkles size={13} /> Minta AI perbaiki
          </Button>
        )}
      </div>
      {notFound && <p className="shrink-0 px-3 py-1.5 text-xs text-warn">Deklarasi {notFound} tidak ditemukan di kode (mungkin dibuat lewat map/fungsi).</p>}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isBuilding && issues.length === 0 ? (
          <p className="p-4 text-sm text-muted">Membangun…</p>
        ) : visible.length === 0 ? (
          <p className="flex items-center gap-2 p-4 text-sm text-muted">
            <CircuitBoard size={16} className="text-accent" />
            {issues.length === 0 ? "Tidak ada masalah DRC/ERC." : "Tidak ada yang cocok dengan saringan."}
          </p>
        ) : (
          <ul className="divide-y divide-line" aria-label="Daftar masalah">
            {visible.map((issue) => (
              <li key={issue.key} className="flex gap-2 px-3 py-2">
                {issue.severity === "error" ? (
                  <CircleAlert size={14} className="mt-0.5 shrink-0 text-danger" aria-label="error" />
                ) : (
                  <TriangleAlert size={14} className="mt-0.5 shrink-0 text-warn" aria-label="peringatan" />
                )}
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="break-words text-sm text-ink">{issue.message}</p>
                  <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                    <span className="rounded bg-raised px-1.5 py-0.5">{CATEGORY_LABELS[issue.category]}</span>
                    <span className="font-mono">{issue.type}</span>
                    {issue.components.map((name) => (
                      <button
                        key={name}
                        type="button"
                        onClick={() => reveal(name)}
                        title={`Loncat ke ${name} di kode`}
                        className="rounded border border-line px-1.5 py-0.5 font-mono text-ink hover:border-accent hover:text-accent"
                      >
                        {name}
                      </button>
                    ))}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
