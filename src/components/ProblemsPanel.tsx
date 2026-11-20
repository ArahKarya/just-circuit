import { CheckCircle2, CircleAlert, Loader2, Sparkles, TriangleAlert } from "lucide-react"
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
  const warningList = issues.filter((i) => i.severity === "warning")
  const warnings = warningList.length
  const visible = useMemo(() => (filter === "all" ? issues : issues.filter((i) => i.severity === filter)), [issues, filter])
  const fixTargets = filter === "warning" ? warningList : errors.length > 0 ? errors : warningList

  const reveal = (name: string) => setNotFound(onRevealComponent(name) ? null : name)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-line bg-surface/35 px-3 py-2 text-xs" role="group" aria-label="Saring masalah">
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
            className={`rounded-md px-2.5 py-1 font-medium tabular-nums transition ${
              filter === id
                ? "bg-raised text-ink shadow-xs"
                : "text-muted hover:bg-raised/50 hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
        {fixTargets.length > 0 && (
          <Button
            size="sm"
            variant="primary"
            className="ml-auto"
            disabled={!canAskAi}
            onClick={() => onAskAiToFix(fixTargets)}
            title={errors.length > 0 && filter !== "warning" ? "Kirim semua error ke AI" : "Kirim semua peringatan ke AI"}
          >
            <Sparkles size={13} /> Minta AI perbaiki
          </Button>
        )}
      </div>

      {notFound && (
        <p className="shrink-0 border-b border-warn/25 bg-warn/10 px-3 py-2 text-xs text-warn">
          Deklarasi <span className="font-mono font-medium">{notFound}</span> tidak ditemukan di kode (mungkin dibuat lewat map/fungsi).
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {isBuilding && issues.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted">
            <Loader2 size={15} className="animate-spin text-accent" />
            Membangun…
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line bg-surface/40 px-4 py-10 text-center">
            <CheckCircle2 size={22} className="text-accent" />
            <p className="text-sm font-medium text-ink">
              {issues.length === 0 ? "Tidak ada masalah DRC/ERC." : "Tidak ada yang cocok dengan saringan."}
            </p>
          </div>
        ) : (
          <ul className="space-y-2" aria-label="Daftar masalah">
            {visible.map((issue) => (
              <li
                key={issue.key}
                className={`flex gap-2.5 rounded-xl border bg-surface/50 p-3 ${
                  issue.severity === "error" ? "border-danger/30" : "border-warn/30"
                }`}
              >
                {issue.severity === "error" ? (
                  <CircleAlert size={15} className="mt-0.5 shrink-0 text-danger" aria-label="error" />
                ) : (
                  <TriangleAlert size={15} className="mt-0.5 shrink-0 text-warn" aria-label="peringatan" />
                )}
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="break-words text-xs leading-relaxed text-ink">{issue.message}</p>
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                    <span className="rounded-md bg-raised px-1.5 py-0.5 font-medium">{CATEGORY_LABELS[issue.category]}</span>
                    <span className="font-mono text-[10px] opacity-80">{issue.type}</span>
                    {issue.components.map((name) => (
                      <button
                        key={name}
                        type="button"
                        onClick={() => reveal(name)}
                        title={`Loncat ke ${name} di kode`}
                        className="rounded-md border border-line bg-panel px-1.5 py-0.5 font-mono text-[11px] font-medium text-ink transition hover:border-accent hover:text-accent"
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
