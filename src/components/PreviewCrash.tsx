import { RotateCcw, TriangleAlert } from "lucide-react"
import type { FallbackProps } from "react-error-boundary"
import { Button } from "./ui"

function crashMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Shown when the tscircuit viewer itself throws, instead of a blank panel. */
export function PreviewCrash({ error, resetErrorBoundary }: FallbackProps) {
  return (
    <div role="alert" className="flex h-full flex-col items-center justify-center gap-4 bg-surface p-6 text-center text-ink">
      <div className="flex size-12 items-center justify-center rounded-2xl border border-warn/30 bg-warn/10 text-warn">
        <TriangleAlert size={24} />
      </div>
      <div className="max-w-md space-y-1">
        <p className="text-sm font-semibold">Preview berhenti karena error di viewer.</p>
        <p className="text-xs text-muted">Kode tetap aman. Preview dicoba lagi otomatis saat kode berubah.</p>
      </div>
      <pre className="max-h-40 w-full max-w-lg overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-panel p-3 text-left font-mono text-xs text-muted">
        {crashMessage(error)}
      </pre>
      <Button variant="primary" onClick={resetErrorBoundary}>
        <RotateCcw size={14} /> Muat ulang preview
      </Button>
    </div>
  )
}
