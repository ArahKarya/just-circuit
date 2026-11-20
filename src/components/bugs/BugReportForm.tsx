import { Send } from "lucide-react"
import { useState } from "react"
import toast from "react-hot-toast"
import { MAX_BUG_DETAILS_CHARS, MAX_BUG_TITLE_CHARS } from "../../../shared/bug-reports"
import { errorCollector } from "../../lib/bug-capture"
import { buildBugDetails, type BugReportEnvironment } from "../../lib/bug-report-details"
import { bugReportsRepo } from "../../lib/repo"
import { Button, Field } from "../ui"

const TEXTAREA =
  "w-full rounded-lg border border-line bg-surface p-3 text-sm leading-relaxed text-ink placeholder:text-muted/55 transition focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"

interface BugReportFormProps {
  projectId: string
  environment: Omit<BugReportEnvironment, "recentErrors" | "userAgent">
}

/** A short form for bugs the user sees; it attaches the build state and recent browser errors. */
export function BugReportForm({ projectId, environment }: BugReportFormProps) {
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [attachContext, setAttachContext] = useState(true)
  const [sending, setSending] = useState(false)

  const submit = async () => {
    if (!title.trim()) return
    setSending(true)
    try {
      const env = attachContext ? { ...environment, recentErrors: errorCollector.recent(), userAgent: navigator.userAgent } : null
      await bugReportsRepo.create({
        source: "user",
        title: title.trim(),
        details: buildBugDetails(description, env).slice(0, MAX_BUG_DETAILS_CHARS),
        context: attachContext ? { projectId, projectName: environment.projectName, where: window.location.pathname } : undefined,
      })
      setTitle("")
      setDescription("")
      toast.success("Bug tercatat. Minta coding agent \"cek laporan bug Just Circuit\" untuk memperbaikinya.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal mencatat bug")
    } finally {
      setSending(false)
    }
  }

  return (
    <form
      className="space-y-3 rounded-xl border border-line bg-surface/40 p-3.5"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <Field label="Judul bug" placeholder="mis. 3D viewer tidak muncul setelah build" value={title} maxLength={MAX_BUG_TITLE_CHARS} onChange={(e) => setTitle(e.target.value)} />
      <label className="block space-y-1.5">
        <span className="block text-xs font-medium text-muted">Apa yang terjadi?</span>
        <textarea
          aria-label="Apa yang terjadi?"
          rows={4}
          maxLength={MAX_BUG_DETAILS_CHARS - 2000}
          placeholder="Langkahnya, apa yang diharapkan, apa yang muncul (salin pesan error kalau ada)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={TEXTAREA}
        />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={attachContext} onChange={(e) => setAttachContext(e.target.checked)} />
          Lampirkan nama proyek, status build, dan error browser terakhir
        </label>
        <Button type="submit" size="sm" variant="primary" disabled={sending || !title.trim()}>
          <Send size={13} /> Catat bug
        </Button>
      </div>
    </form>
  )
}
