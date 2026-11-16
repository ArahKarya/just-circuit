import type { Dispatch, SetStateAction } from "react"
import { MAX_MEMORY_CHARS } from "../../lib/memory"

export interface MemoryDraft {
  project: string
  global: string
}

interface MemoryTabProps {
  projectName: string
  draft: MemoryDraft | null
  setDraft: Dispatch<SetStateAction<MemoryDraft | null>>
}

const TEXTAREA = "w-full rounded-md border border-line bg-surface p-2.5 font-mono text-xs text-ink placeholder:text-muted/60 focus:border-accent focus:outline-none"

function MemoryField({ label, hint, value, placeholder, onChange }: { label: string; hint: string; value: string; placeholder: string; onChange: (value: string) => void }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted">{label}</span>
      <textarea aria-label={label} rows={7} maxLength={MAX_MEMORY_CHARS} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} className={TEXTAREA} />
      <span className="block text-xs text-muted">{hint} {value.length}/{MAX_MEMORY_CHARS}</span>
    </label>
  )
}

export function MemoryTab({ projectName, draft, setDraft }: MemoryTabProps) {
  if (!draft) return <p className="text-sm text-muted">Memuat memori…</p>
  return (
    <div className="space-y-5">
      <p className="text-xs text-muted">
        Memori selalu dikirim ke AI. AI menambahkan catatan sendiri saat ada keputusan penting; kamu bisa mengubah atau menghapusnya di sini.
      </p>
      <MemoryField
        label={`Memori proyek: ${projectName}`}
        hint="Keputusan desain proyek ini."
        placeholder={"- LDO 3V3 terpisah (AP2112K), V3V3_EN Pico dimatikan\n- Input digital 24V lewat optocoupler PC817"}
        value={draft.project}
        onChange={(project) => setDraft((d) => (d ? { ...d, project } : d))}
      />
      <MemoryField
        label="Memori global (semua proyek)"
        hint="Preferensimu yang berlaku di semua proyek."
        placeholder={"- Pakai part JLCPCB basic\n- Resistor dan kapasitor kecil 0603"}
        value={draft.global}
        onChange={(global) => setDraft((d) => (d ? { ...d, global } : d))}
      />
    </div>
  )
}
