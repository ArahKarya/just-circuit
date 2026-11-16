import { Eye, EyeOff, ListRestart, Loader2, PlugZap } from "lucide-react"
import { useState } from "react"
import { fetchModels, testConnection } from "../lib/llm-client"
import { KIND_LABELS, supportsTemperature } from "../lib/providers"
import type { Connection, ProviderKind, ReasoningLevel, TemperatureMode } from "../lib/types"
import { Button, Field, SELECT_CLASS, SelectField } from "./ui"

interface ConnectionEditorProps {
  connection: Connection
  onChange: (next: Connection) => void
}

const BASE_URL_HINT: Record<ProviderKind, string> = {
  "openai-compatible": "Wajib, biasanya diakhiri /v1. Contoh: https://openrouter.ai/api/v1. Kalau hanya host, /v1 ditambahkan otomatis.",
  anthropic: "Kosongkan untuk https://api.anthropic.com/v1. Untuk proxy (mis. 9router) isi http://host:port/v1.",
  gemini: "Kosongkan untuk https://generativelanguage.googleapis.com/v1beta",
}

const REASONING_OPTIONS: { value: ReasoningLevel; label: string }[] = [
  { value: "provider-default", label: "Bawaan provider" },
  { value: "none", label: "Mati" },
  { value: "low", label: "Rendah" },
  { value: "medium", label: "Sedang" },
  { value: "high", label: "Tinggi" },
]

/** Parses a seconds field; empty means "use the server default". */
function seconds(value: string): number | undefined {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? Math.min(1800, Math.max(10, parsed)) : undefined
}

type TestState = { status: "idle" } | { status: "running" } | { status: "ok"; text: string } | { status: "error"; text: string }

const TEMPERATURE_LABELS: Record<TemperatureMode, string> = {
  auto: "Otomatis",
  send: "Selalu kirim",
  omit: "Jangan kirim",
}

function apiKeyPlaceholder(connection: Connection): string {
  if (connection.clearApiKey) return "key akan dihapus saat disimpan"
  if (connection.hasApiKey) return "•••••••• tersimpan (ketik untuk mengganti)"
  return connection.kind === "openai-compatible" ? "kosongkan kalau tidak perlu (mis. Ollama)" : "wajib"
}

function temperatureHint(connection: Connection): string {
  if ((connection.temperatureMode ?? "auto") !== "auto") return "Pengaturan manual untuk koneksi ini."
  return supportsTemperature(connection.model)
    ? "Dikirim untuk model ini."
    : "Tidak dikirim: model ini (Claude 5, GPT-5, seri o) menolak temperature."
}

export function ConnectionEditor({ connection, onChange }: ConnectionEditorProps) {
  const [showKey, setShowKey] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [modelsState, setModelsState] = useState<{ loading: boolean; error: string | null }>({ loading: false, error: null })
  const [test, setTest] = useState<TestState>({ status: "idle" })
  const update = (patch: Partial<Connection>) => onChange({ ...connection, ...patch })

  const runTest = async () => {
    setTest({ status: "running" })
    try {
      const result = await testConnection(connection)
      setTest({ status: "ok", text: `Tersambung dalam ${(result.ms / 1000).toFixed(1)} dtk. Jawaban: "${result.reply || "(kosong)"}"` })
    } catch (error) {
      setTest({ status: "error", text: error instanceof Error ? error.message : "Gagal" })
    }
  }
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
            className={SELECT_CLASS}
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
            placeholder={apiKeyPlaceholder(connection)}
            onChange={(e) => update({ apiKey: e.target.value, clearApiKey: false })}
          />
        </div>
        {connection.hasApiKey && !connection.clearApiKey && (
          <Button onClick={() => update({ apiKey: "", clearApiKey: true })}>Hapus key</Button>
        )}
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
      <div className="grid gap-3 sm:grid-cols-3">
        <SelectField
          id={`reasoning-${connection.id}`}
          label="Thinking"
          options={REASONING_OPTIONS}
          value={connection.reasoning ?? "provider-default"}
          onChange={(e) => update({ reasoning: e.target.value as ReasoningLevel })}
        />
        <Field
          id={`first-timeout-${connection.id}`}
          label="Tunggu jawaban pertama (dtk)"
          type="number"
          min={10}
          max={1800}
          placeholder="300"
          value={connection.firstChunkTimeoutSec ?? ""}
          onChange={(e) => update({ firstChunkTimeoutSec: seconds(e.target.value) })}
        />
        <Field
          id={`idle-timeout-${connection.id}`}
          label="Batas diam di tengah (dtk)"
          type="number"
          min={10}
          max={1800}
          placeholder="120"
          value={connection.idleTimeoutSec ?? ""}
          onChange={(e) => update({ idleTimeoutSec: seconds(e.target.value) })}
        />
      </div>
      <p className="text-xs text-muted">Thinking membuat jawaban lebih teliti tapi lebih lama. Kalau provider menolak (error 400), kembalikan ke "Bawaan provider". Kosongkan batas waktu untuk memakai bawaan server.</p>
      <div className="space-y-1">
        <label htmlFor={`temperature-${connection.id}`} className="text-xs font-medium text-muted">Temperature</label>
        <select
          id={`temperature-${connection.id}`}
          value={connection.temperatureMode ?? "auto"}
          onChange={(e) => update({ temperatureMode: e.target.value as TemperatureMode })}
          className={SELECT_CLASS}
        >
          {(Object.keys(TEMPERATURE_LABELS) as TemperatureMode[]).map((mode) => (
            <option key={mode} value={mode}>{TEMPERATURE_LABELS[mode]}</option>
          ))}
        </select>
        <p className="text-xs text-muted">{temperatureHint(connection)}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => void runTest()} disabled={test.status === "running" || !connection.model.trim()}>
          {test.status === "running" ? <Loader2 size={15} className="animate-spin" /> : <PlugZap size={15} />}
          Tes koneksi
        </Button>
        {test.status === "ok" && <span role="status" className="text-xs text-accent">{test.text}</span>}
        {test.status === "error" && <span role="alert" className="text-xs text-danger">{test.text}</span>}
      </div>
    </div>
  )
}
