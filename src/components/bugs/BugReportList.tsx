import { Check, ChevronDown, EyeOff, RotateCcw, Trash2 } from "lucide-react"
import { useState } from "react"
import toast from "react-hot-toast"
import { BUG_SOURCE_LABELS, type BugReport, type BugStatus } from "../../../shared/bug-reports"
import { bugReportsRepo } from "../../lib/repo"
import { IconButton } from "../ui"

const STATUS_LABELS: Record<BugStatus, string> = { open: "Terbuka", fixed: "Diperbaiki", ignored: "Diabaikan" }
const STATUS_STYLES: Record<BugStatus, string> = {
  open: "border-warn/35 bg-warn/10 text-warn",
  fixed: "border-added/35 bg-added/10 text-added",
  ignored: "border-line bg-raised text-muted",
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })
}

async function run(action: () => Promise<void>, failure: string): Promise<void> {
  try {
    await action()
  } catch (error) {
    toast.error(error instanceof Error ? error.message : failure)
  }
}

function BugRow({ report }: { report: BugReport }) {
  const [open, setOpen] = useState(false)
  const setStatus = (status: BugStatus) => run(() => bugReportsRepo.setStatus(report.id, status), "Gagal mengubah status")
  return (
    <li className="rounded-lg border border-line bg-panel">
      <div className="flex items-start gap-2 p-2.5">
        <button type="button" className="min-w-0 flex-1 text-left" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <span className="flex items-center gap-1.5">
            <ChevronDown size={13} className={`shrink-0 text-muted transition ${open ? "" : "-rotate-90"}`} />
            <span className="truncate text-sm text-ink">{report.title}</span>
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5 pl-5 text-[11px] text-muted">
            <span className={`rounded border px-1.5 ${STATUS_STYLES[report.status]}`}>{STATUS_LABELS[report.status]}</span>
            <span>{BUG_SOURCE_LABELS[report.source]}</span>
            {report.count > 1 && <span>· terjadi {report.count}×</span>}
            <span>· {formatTime(report.lastSeen)}</span>
            {report.context.projectName && <span>· {report.context.projectName}</span>}
          </span>
        </button>
        <div className="flex shrink-0">
          {report.status === "open" ? (
            <>
              <IconButton label="Tandai sudah diperbaiki" onClick={() => void setStatus("fixed")}>
                <Check size={14} />
              </IconButton>
              <IconButton label="Abaikan" onClick={() => void setStatus("ignored")}>
                <EyeOff size={14} />
              </IconButton>
            </>
          ) : (
            <IconButton label="Buka lagi" onClick={() => void setStatus("open")}>
              <RotateCcw size={14} />
            </IconButton>
          )}
          <IconButton label="Hapus laporan" onClick={() => void run(() => bugReportsRepo.remove(report.id), "Gagal menghapus")}>
            <Trash2 size={14} />
          </IconButton>
        </div>
      </div>
      {open && (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap border-t border-line px-3 py-2 font-mono text-[11px] leading-relaxed text-muted">
          {[report.context.where && `Lokasi: ${report.context.where}`, report.details || "(tanpa detail)"].filter(Boolean).join("\n")}
        </pre>
      )}
    </li>
  )
}

interface BugReportListProps {
  reports: readonly BugReport[] | undefined
  error: Error | null
}

export function BugReportList({ reports, error }: BugReportListProps) {
  const [showAll, setShowAll] = useState(false)
  if (error) return <p className="text-xs text-danger">Gagal memuat laporan: {error.message}</p>
  if (!reports) return <p className="text-xs text-muted">Memuat…</p>
  const openCount = reports.filter((r) => r.status === "open").length
  const shown = showAll ? reports : reports.filter((r) => r.status === "open")
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium text-muted">
          {openCount} bug terbuka{reports.length > openCount ? ` dari ${reports.length}` : ""}
        </h3>
        {reports.length > openCount && (
          <button type="button" className="text-xs text-accent hover:underline" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Hanya yang terbuka" : "Tampilkan semua"}
          </button>
        )}
      </div>
      {shown.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line p-4 text-center text-xs text-muted">Tidak ada bug terbuka.</p>
      ) : (
        <ul className="space-y-1.5">
          {shown.map((report) => (
            <BugRow key={report.id} report={report} />
          ))}
        </ul>
      )}
    </section>
  )
}
