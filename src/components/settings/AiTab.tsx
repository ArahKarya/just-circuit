import { Plus, ShieldAlert, Trash2 } from "lucide-react"
import { useState, type Dispatch, type SetStateAction } from "react"
import { connectionFromPreset, DEFAULT_HISTORY_LIMIT, KIND_LABELS, PROVIDER_PRESETS } from "../../lib/providers"
import type { AiSettings, Connection } from "../../lib/types"
import { ConnectionEditor } from "../ConnectionEditor"
import { Button, Field, SELECT_CLASS, SelectField } from "../ui"

interface AiTabProps {
  draft: AiSettings
  setDraft: Dispatch<SetStateAction<AiSettings>>
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
}

export function AiTab({ draft, setDraft }: AiTabProps) {
  const [selectedId, setSelectedId] = useState<string | null>(draft.activeConnectionId ?? draft.connections[0]?.id ?? null)
  const [presetId, setPresetId] = useState(PROVIDER_PRESETS[0].id)
  const selected = draft.connections.find((c) => c.id === selectedId)
  const preset = PROVIDER_PRESETS.find((p) => p.id === presetId) ?? PROVIDER_PRESETS[0]

  const addConnection = () => {
    const connection = connectionFromPreset(preset)
    setDraft((d) => ({
      ...d,
      connections: [...d.connections, connection],
      activeConnectionId: d.activeConnectionId ?? connection.id,
    }))
    setSelectedId(connection.id)
  }

  const updateConnection = (next: Connection) => {
    setDraft((d) => ({ ...d, connections: d.connections.map((c) => (c.id === next.id ? next : c)) }))
  }

  const removeConnection = (id: string) => {
    setDraft((d) => {
      const connections = d.connections.filter((c) => c.id !== id)
      const activeConnectionId = d.activeConnectionId === id ? (connections[0]?.id ?? null) : d.activeConnectionId
      const autoFixConnectionId = d.autoFixConnectionId === id ? null : d.autoFixConnectionId
      return { ...d, connections, activeConnectionId, autoFixConnectionId }
    })
    setSelectedId((current) => (current === id ? null : current))
  }

  const connectionOptions = [
    { value: "", label: "Sama dengan chat" },
    ...draft.connections.map((c) => ({ value: c.id, label: `${c.name} · ${c.model || "?"}` })),
  ]

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start gap-2.5 rounded-xl border border-accent/25 bg-accent/8 p-3 text-xs leading-relaxed text-muted">
        <ShieldAlert size={16} className="mt-0.5 shrink-0 text-accent" />
        <p>API key disimpan terenkripsi di server Just Circuit dan tidak pernah dikirim balik ke browser. Kolom key kosong berarti key yang tersimpan tetap dipakai.</p>
      </div>

      <section className="space-y-3 rounded-xl border border-line bg-surface/40 p-4">
        <h3 className="text-sm font-semibold text-ink">Koneksi</h3>
        <div className="flex flex-wrap items-end gap-2">
          <label className="block flex-1 space-y-1.5">
            <span className="block text-xs font-medium text-muted">Tambah dari preset</span>
            <select value={presetId} onChange={(e) => setPresetId(e.target.value)} className={SELECT_CLASS}>
              {PROVIDER_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <Button variant="primary" onClick={addConnection}>
            <Plus size={15} />
            Tambah
          </Button>
        </div>
        <p className="text-xs text-muted">{preset.hint}</p>

        {draft.connections.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line py-4 text-center text-xs text-muted">Belum ada koneksi.</p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-panel">
            {draft.connections.map((c) => (
              <li key={c.id} className={`flex items-center gap-3 px-3.5 py-2.5 transition ${c.id === selectedId ? "bg-raised/80" : "hover:bg-raised/40"}`}>
                <input
                  type="radio"
                  name="active-connection"
                  aria-label={`Pakai ${c.name}`}
                  checked={draft.activeConnectionId === c.id}
                  onChange={() => setDraft((d) => ({ ...d, activeConnectionId: c.id }))}
                  className="size-4 accent-emerald-500"
                />
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setSelectedId(c.id)}>
                  <span className="block truncate text-sm font-medium text-ink">{c.name}</span>
                  <span className="block truncate text-xs text-muted">
                    {KIND_LABELS[c.kind]} · {c.model || "model belum diisi"}
                  </span>
                </button>
                <Button size="sm" variant="danger" aria-label={`Hapus ${c.name}`} onClick={() => removeConnection(c.id)}>
                  <Trash2 size={13} />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {selected && (
        <section className="space-y-3 rounded-xl border border-line bg-surface/40 p-4">
          <h3 className="text-sm font-semibold text-ink">Edit: {selected.name}</h3>
          <ConnectionEditor key={selected.id} connection={selected} onChange={updateConnection} />
        </section>
      )}

      <section className="space-y-3 rounded-xl border border-line bg-surface/40 p-4">
        <h3 className="text-sm font-semibold text-ink">Parameter Generasi</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field
            label="Temperature"
            type="number"
            step="0.1"
            min={0}
            max={2}
            value={draft.temperature}
            onChange={(e) => setDraft((d) => ({ ...d, temperature: clamp(e.target.valueAsNumber, 0, 2, 0.2) }))}
          />
          <Field
            label="Maks token jawaban"
            type="number"
            min={256}
            max={64000}
            step={256}
            value={draft.maxOutputTokens}
            onChange={(e) => setDraft((d) => ({ ...d, maxOutputTokens: clamp(e.target.valueAsNumber, 256, 64000, 8000) }))}
          />
          <Field
            label="Auto-fix error build"
            type="number"
            min={0}
            max={5}
            hint="0 = matikan"
            value={draft.autoFixAttempts}
            onChange={(e) => setDraft((d) => ({ ...d, autoFixAttempts: clamp(Math.round(e.target.valueAsNumber), 0, 5, 2) }))}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            label="Model untuk auto-fix"
            options={connectionOptions}
            value={draft.autoFixConnectionId ?? ""}
            onChange={(e) => setDraft((d) => ({ ...d, autoFixConnectionId: e.target.value || null }))}
          />
          <Field
            label="Riwayat chat yang dikirim"
            type="number"
            min={2}
            max={100}
            hint="Jumlah pesan sebelumnya. Lebih sedikit = lebih hemat token."
            value={draft.historyLimit ?? DEFAULT_HISTORY_LIMIT}
            onChange={(e) => setDraft((d) => ({ ...d, historyLimit: clamp(Math.round(e.target.valueAsNumber), 2, 100, DEFAULT_HISTORY_LIMIT) }))}
          />
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-line bg-surface/40 p-4">
        <h3 className="text-sm font-semibold text-ink">Mode Agen</h3>
        <div className="space-y-2.5">
          <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium text-ink">
            <input
              type="checkbox"
              className="size-4 rounded accent-emerald-500"
              checked={draft.agentMode ?? false}
              onChange={(e) => setDraft((d) => ({ ...d, agentMode: e.target.checked }))}
            />
            Mode agen
          </label>
          <p className="text-xs leading-relaxed text-muted">
            AI membaca file yang dibutuhkan, mengubahnya, menjalankan <span className="font-mono text-ink">tsci build</span> dan memperbaiki error sendiri, serta mencari part JLCPCB. Lebih hemat token untuk proyek besar, tapi butuh model yang mendukung tools (Claude, GPT, Gemini) dan <span className="font-mono text-ink">tsci</span> di server.
          </p>
        </div>
        <div className="space-y-2 border-t border-line/70 pt-3">
          <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium text-ink">
            <input
              type="checkbox"
              className="size-4 rounded accent-emerald-500"
              checked={draft.agentServerBuild ?? false}
              onChange={(e) => setDraft((d) => ({ ...d, agentServerBuild: e.target.checked }))}
            />
            Izinkan agen menjalankan build di server
          </label>
          <p className="text-xs leading-relaxed text-muted">
            Kode tulisan AI dijalankan oleh <span className="font-mono text-ink">tsci</span> di server, di dalam sandbox (macOS: sandbox-exec, Linux: bwrap) tanpa jaringan dan tanpa akses ke folder home. Kalau mati, preview di browser yang mengecek hasilnya dan error dikirim balik ke agen.
          </p>
        </div>
        <Field
          label="Langkah maksimal per jawaban"
          type="number"
          min={2}
          max={40}
          value={draft.agentMaxSteps ?? 12}
          onChange={(e) => setDraft((d) => ({ ...d, agentMaxSteps: clamp(Math.round(e.target.valueAsNumber), 2, 40, 12) }))}
        />
      </section>
    </div>
  )
}
