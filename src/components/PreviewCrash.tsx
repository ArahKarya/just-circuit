import { RotateCcw, TriangleAlert } from "lucide-react"
import type { FallbackProps } from "react-error-boundary"
import { Button } from "./ui"

function crashMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Shown when the tscircuit viewer itself throws, instead of a blank panel. */
export function PreviewCrash({ error, resetErrorBoundary }: FallbackProps) {
  return (
    <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 bg-white p-6 text-center text-slate-700">
      <TriangleAlert className="text-amber-600" size={28} />
      <p className="font-medium">Preview berhenti karena error di viewer.</p>
      <pre className="max-h-40 max-w-full overflow-auto whitespace-pre-wrap rounded bg-slate-100 p-2 text-left text-xs">{crashMessage(error)}</pre>
      <p className="text-xs text-slate-500">Kode tetap aman. Preview dicoba lagi otomatis saat kode berubah.</p>
      <Button onClick={resetErrorBoundary}>
        <RotateCcw size={14} /> Muat ulang preview
      </Button>
    </div>
  )
}
