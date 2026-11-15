import { Eye, EyeOff, ListRestart, Loader2 } from "lucide-react"
import { useState } from "react"
import { fetchModels } from "../lib/llm-client"
import { KIND_LABELS } from "../lib/providers"
import type { Connection, ProviderKind } from "../lib/types"
import { Button, Field } from "./ui"

interface ConnectionEditorProps {
  connection: Connection
  onChange: (next: Connection) => void
}

const BASE_URL_HINT: Record<ProviderKind, string> = {
  "openai-compatible": "Wajib. Contoh: https://openrouter.ai/api/v1",
  anthropic: "Kosongkan untuk https://api.anthropic.com/v1",
  gemini: "Kosongkan untuk https://generativelanguage.googleapis.com/v1beta",
}

export function ConnectionEditor({ connection, onChange }: ConnectionEditorProps) {
  const [showKey, setShowKey] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [modelsState, setModelsState] = useState<{ loading: boolean; error: string | null }>({ loading: false, error: null })
  const update = (patch: Partial<Connection>) => onChange({ ...connection, ...patch })
  const listId = `models-${connection.id}`

  const loadModels = async () => {
    setModelsState({ loading: true, error: null })
    try {
      const found = await fetchModels(connection)
      setModels(found)
      setModelsState({ loading: false, error: found.length === 0 ? "Provider tidak mengembalikan model." : null })
    } catch (error) {
      setModelsState({ loading: false, error: error instanceof Error ? error.message : "Gagal mengambil model" })
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nama" value={connection.name} onChange={(e) => update({ name: e.target.value })} />
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted">Jenis API</span>
          <select
            value={connection.kind}
            onChange={(e) => update({ kind: e.target.value as ProviderKind })}
            className="h-9 w-full rounded-md border border-line bg-surface px-2 text-sm text-ink focus:border-accent focus:outline-none"
          >
            {(Object.keys(KIND_LABELS) as ProviderKind[]).map((kind) => (
              <option key={kind} value={kind}>{KIND_LABELS[kind]}</option>
            ))}
          </select>
        </label>
      </div>
      <Field
        label="Base URL"
        value={connection.baseUrl}
        placeholder={connection.kind === "openai-compatible" ? "https://…/v1" : "default"}
        hint={BASE_URL_HINT[connection.kind]}
        onChange={(e) => update({ baseUrl: e.target.value })}
      />
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Field
            label="API key"
            type={showKey ? "text" : "password"}
            autoComplete="off"
            value={connection.apiKey}
            placeholder={connection.kind === "openai-compatible" ? "kosongkan kalau tidak perlu (mis. Ollama)" : "wajib"}
            onChange={(e) => update({ apiKey: e.target.value })}
          />
        </div>
        <Button aria-label={showKey ? "Sembunyikan key" : "Tampilkan key"} onClick={() => setShowKey((v) => !v)}>
          {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
        </Button>
      </div>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Field label="Model" list={listId} value={connection.model} placeholder="mis. gemini-2.5-flash" onChange={(e) => update({ model: e.target.value })} />
          <datalist id={listId}>
            {models.map((model) => <option key={model} value={model} />)}
          </datalist>
        </div>
        <Button onClick={() => void loadModels()} disabled={modelsState.loading}>
          {modelsState.loading ? <Loader2 size={15} className="animate-spin" /> : <ListRestart size={15} />}
          Ambil model
        </Button>
      </div>
      {modelsState.error && <p className="text-xs text-danger">{modelsState.error}</p>}
      {!modelsState.error && models.length > 0 && <p className="text-xs text-muted">{models.length} model ditemukan, pilih dari kolom Model.</p>}
    </div>
  )
}
