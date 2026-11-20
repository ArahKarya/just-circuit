import type { Dispatch, SetStateAction } from "react"
import { MAX_PROJECT_RULES_CHARS } from "../../lib/system-prompt"
import type { Connection, ProjectSettings } from "../../lib/types"
import { SelectField } from "../ui"

interface ProjectTabProps {
  projectName: string
  draft: ProjectSettings
  setDraft: Dispatch<SetStateAction<ProjectSettings>>
  connections: Connection[]
}

const RULES_PLACEHOLDER = `Contoh:
- Pakai part JLCPCB basic saja, sertakan nomor LCSC.
- Board maksimal 100×80 mm, 2 layer.
- Semua resistor 0603, kapasitor 0805.
- Tegangan logika 3.3V.`

export function ProjectTab({ projectName, draft, setDraft, connections }: ProjectTabProps) {
  const options = [{ value: "", label: "Sama dengan pengaturan AI" }, ...connections.map((c) => ({ value: c.id, label: `${c.name} · ${c.model || "?"}` }))]
  const rules = draft.aiRules ?? ""

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">
        Berlaku hanya untuk proyek <span className="font-semibold text-ink">{projectName}</span>.
      </p>
      <div className="space-y-4 rounded-xl border border-line bg-surface/40 p-4">
        <SelectField
          label="Koneksi AI untuk proyek ini"
          options={options}
          value={draft.connectionId ?? ""}
          onChange={(e) => setDraft((d) => ({ ...d, connectionId: e.target.value || null }))}
        />
        <label className="block space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted">Aturan tambahan untuk AI</span>
            <span className="font-mono text-[11px] text-muted tabular-nums">
              {rules.length}/{MAX_PROJECT_RULES_CHARS}
            </span>
          </div>
          <textarea
            aria-label="Aturan tambahan untuk AI"
            rows={8}
            maxLength={MAX_PROJECT_RULES_CHARS}
            placeholder={RULES_PLACEHOLDER}
            value={rules}
            onChange={(e) => setDraft((d) => ({ ...d, aiRules: e.target.value }))}
            className="w-full rounded-lg border border-line bg-surface p-3 font-mono text-xs leading-relaxed text-ink placeholder:text-muted/55 transition focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
          <span className="block text-[11px] text-muted">Dikirim ke AI di setiap permintaan untuk proyek ini.</span>
        </label>
      </div>
    </div>
  )
}
