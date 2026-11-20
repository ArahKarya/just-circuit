import { CheckCircle2, CircleAlert, Loader2, Play, TerminalSquare } from "lucide-react"
import type { ToolStep } from "../lib/types"

const LABELS: Record<string, string> = {
  list_files: "Lihat daftar file",
  read_file: "Baca",
  search_files: "Cari di file",
  write_file: "Tulis",
  edit_file: "Ubah",
  delete_file: "Hapus",
  build_circuit: "Build",
  search_jlcpcb: "Cari part JLCPCB",
  search_parts: "Cari part",
  search_footprints: "Cari footprint KiCad",
  propose_command: "Usul perintah",
  report_app_bug: "Laporkan bug aplikasi",
}

interface ToolStepsProps {
  steps: readonly ToolStep[]
  onRunCommand?: (command: string) => void
}

function StepIcon({ step }: { step: ToolStep }) {
  if (step.ok === undefined) return <Loader2 size={13} className="mt-0.5 shrink-0 animate-spin text-accent" />
  return step.ok ? (
    <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-accent" />
  ) : (
    <CircleAlert size={13} className="mt-0.5 shrink-0 text-danger" />
  )
}

/** The tools the agent used, one line each; proposed shell commands get a run button. */
export function ToolSteps({ steps, onRunCommand }: ToolStepsProps) {
  const proposals = steps.filter((step) => step.name === "propose_command" && step.detail)
  return (
    <div className="space-y-2">
      <ol className="space-y-1.5 rounded-lg border border-line bg-surface/65 p-2.5 text-xs" aria-label="Langkah agen">
        {steps.map((step, index) => (
          <li key={index} className="flex items-start gap-2">
            <StepIcon step={step} />
            <span className="min-w-0 leading-relaxed">
              <span className="font-medium text-ink">{LABELS[step.name] ?? step.name}</span>
              {step.detail && <span className="font-mono text-muted"> {step.detail}</span>}
              {step.result && <span className={step.ok === false ? "text-danger" : "text-muted"}> → {step.result}</span>}
            </span>
          </li>
        ))}
      </ol>
      {onRunCommand &&
        proposals.map((step, index) => (
          <div key={index} className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface/80 p-2.5 text-xs">
            <TerminalSquare size={14} className="shrink-0 text-accent" />
            <code className="min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-ink">{step.detail}</code>
            <button
              type="button"
              title="Ditempel ke terminal; periksa lalu tekan Enter sendiri"
              onClick={() => onRunCommand(step.detail)}
              className="inline-flex items-center gap-1.5 rounded-md border border-line bg-panel px-2.5 py-1 font-medium text-ink transition hover:border-accent/40 hover:bg-raised"
            >
              <Play size={11} className="text-accent" /> Tempel ke terminal
            </button>
          </div>
        ))}
    </div>
  )
}
