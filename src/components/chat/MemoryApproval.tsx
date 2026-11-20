import toast from "react-hot-toast"
import type { MemoryNotes } from "../../lib/memory"
import { Button } from "../ui"

interface MemoryApprovalProps {
  notes: MemoryNotes
  readOutsideText: boolean
  onSave: () => void
  onDismiss: () => void
}

function MemoryApproval({ notes, readOutsideText, onSave, onDismiss }: MemoryApprovalProps) {
  const rows = [...notes.global.map((note) => ({ note, scope: "global" })), ...notes.project.map((note) => ({ note, scope: "proyek" }))]
  return (
    <div role="dialog" aria-label="Setujui catatan memori" className="w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-line bg-panel p-3 text-sm text-ink shadow-lg">
      <p className="font-medium">AI ingin mencatat {rows.length} hal ke memori</p>
      <p className="mt-1 text-xs text-muted">
        {readOutsideText
          ? "Jawaban ini memakai data dari luar (pencarian part, datasheet, lampiran), jadi catatannya tidak disimpan otomatis. Periksa dulu isinya."
          : "Catatan global dipakai di semua proyek, jadi perlu persetujuanmu. Periksa dulu isinya."}
      </p>
      <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs">
        {rows.map(({ note, scope }) => (
          <li key={`${scope}:${note}`} className="flex gap-2">
            <span className="shrink-0 rounded bg-raised px-1.5 font-mono text-[10px] leading-5 text-muted">{scope}</span>
            <span className="leading-5">{note}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="subtle" onClick={onDismiss}>
          Abaikan
        </Button>
        <Button size="sm" variant="primary" onClick={onSave}>
          Simpan ke memori
        </Button>
      </div>
    </div>
  )
}

/** Shows the notes and calls `save` only when the user approves them. */
export function askToSaveMemory(notes: MemoryNotes, readOutsideText: boolean, save: () => Promise<void>): void {
  toast.custom(
    (t) => (
      <MemoryApproval
        notes={notes}
        readOutsideText={readOutsideText}
        onDismiss={() => toast.dismiss(t.id)}
        onSave={() => {
          toast.dismiss(t.id)
          void save()
        }}
      />
    ),
    { duration: Infinity, id: `memory-approval-${Date.now()}` },
  )
}
