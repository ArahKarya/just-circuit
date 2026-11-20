import { bugReportsRepo, TOPICS } from "../../lib/repo"
import { useLiveData } from "../../lib/live-data"
import type { BugReportEnvironment } from "../../lib/bug-report-details"
import { Modal } from "../ui"
import { BugReportForm } from "./BugReportForm"
import { BugReportList } from "./BugReportList"

interface BugReportsDialogProps {
  projectId: string
  environment: Omit<BugReportEnvironment, "recentErrors" | "userAgent">
  onClose: () => void
}

/** Report a bug in Just Circuit and see what was recorded, by the user, the browser, the server or the AI agent. */
export function BugReportsDialog({ projectId, environment, onClose }: BugReportsDialogProps) {
  const reports = useLiveData(bugReportsRepo.list, [TOPICS.bugReports])
  return (
    <Modal title="Laporkan bug" subtitle="Bug di aplikasi Just Circuit, bukan kesalahan di desain rangkaian" onClose={onClose} wide>
      <div className="space-y-4">
        <BugReportForm projectId={projectId} environment={environment} />
        <BugReportList reports={reports.data} error={reports.error} />
        <p className="text-[11px] leading-relaxed text-muted">
          Error di browser, timeout AI, tool agen yang crash, dan laporan dari agen AI tercatat otomatis di sini. Untuk memperbaikinya, minta coding agent (Claude Code)
          membaca laporan ini, misalnya: "cek laporan bug Just Circuit".
        </p>
      </div>
    </Modal>
  )
}
