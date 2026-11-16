import { Plus, ShieldAlert, Trash2 } from "lucide-react"
import { useState } from "react"
import { connectionFromPreset, KIND_LABELS, PROVIDER_PRESETS } from "../lib/providers"
import type { AiSettings, Connection } from "../lib/types"
import { ConnectionEditor } from "./ConnectionEditor"
import { Button, Field, Modal } from "./ui"

interface SettingsDialogProps {
  settings: AiSettings
  onSave: (next: AiSettings) => Promise<void>
  onClose: () => void
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
}

export function SettingsDialog({ settings, onSave, onClose }: SettingsDialogProps) {
  const [draft, setDraft] = useState<AiSettings>(settings)
  const [selectedId, setSelectedId] = useState<string | null>(settings.activeConnectionId ?? settings.connections[0]?.id ?? null)
  const [presetId, setPresetId] = useState(PROVIDER_PRESETS[0].id)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
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
      return { ...d, connections, activeConnectionId }
    })
    setSelectedId((current) => (current === id ? null : current))
  }

  const save = async () => {
    setIsSaving(true)
    setSaveError(null)
    try {
      await onSave(draft)
      onClose()
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Gagal menyimpan pengaturan")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Modal
      title="Pengaturan AI"
      wide
      onClose={onClose}
      footer={
        <>
          {saveError && <span role="alert" className="mr-auto text-xs text-danger">{saveError}</span>}
          <Button onClick={onClose}>Batal</Button>
          <Button variant="primary" onClick={() => void save()} disabled={isSaving}>Simpan</Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <p className="flex gap-2 rounded-md border border-line bg-raised p-3 text-xs text-muted">
          <ShieldAlert size={16} className="shrink-0 text-accent" />
          API key disimpan terenkripsi di server CDS dan tidak pernah dikirim balik ke browser. Kolom key kosong berarti key yang tersimpan tetap dipakai.
        </p>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Koneksi</h3>
          <div className="flex flex-wrap items-end gap-2">
            <label className="block flex-1 space-y-1">
              <span className="text-xs font-medium text-muted">Tambah dari preset</span>
              <select value={presetId} onChange={(e) => setPresetId(e.target.value)} className="h-9 w-full rounded-md border border-line bg-surface px-2 text-sm text-ink">
                {PROVIDER_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </label>
            <Button variant="primary" onClick={addConnection}><Plus size={15} />Tambah</Button>
          </div>
          <p className="text-xs text-muted">{preset.hint}</p>

          {draft.connections.length === 0 ? (
            <p className="py-3 text-sm text-muted">Belum ada koneksi.</p>
          ) : (
            <ul className="divide-y divide-line rounded-md border border-line">
              {draft.connections.map((c) => (
                <li key={c.id} className={`flex items-center gap-3 px-3 py-2 ${c.id === selectedId ? "bg-raised" : ""}`}>
                  <input
                    type="radio"
                    name="active-connection"
                    aria-label={`Pakai ${c.name}`}
                    checked={draft.activeConnectionId === c.id}
                    onChange={() => setDraft((d) => ({ ...d, activeConnectionId: c.id }))}
                    className="accent-emerald-400"
                  />
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setSelectedId(c.id)}>
                    <span className="block truncate text-sm">{c.name}</span>
                    <span className="block truncate text-xs text-muted">{KIND_LABELS[c.kind]} · {c.model || "model belum diisi"}</span>
                  </button>
                  <Button variant="danger" aria-label={`Hapus ${c.name}`} onClick={() => removeConnection(c.id)}><Trash2 size={14} /></Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {selected && (
          <section className="space-y-2 rounded-md border border-line p-3">
            <h3 className="text-sm font-semibold">Edit: {selected.name}</h3>
            <ConnectionEditor key={selected.id} connection={selected} onChange={updateConnection} />
          </section>
        )}

        <section className="grid gap-3 sm:grid-cols-3">
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
        </section>
      </div>
    </Modal>
  )
}
