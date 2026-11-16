import type { AiSettings, Connection, ProviderKind } from "./types"

export interface ProviderPreset {
  id: string
  label: string
  kind: ProviderKind
  baseUrl: string
  model: string
  needsKey: boolean
  hint: string
}

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    id: "openrouter",
    label: "OpenRouter",
    kind: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openai/gpt-oss-120b:free",
    needsKey: true,
    hint: "Ada banyak model gratis (akhiran :free). Key dari openrouter.ai/keys.",
  },
  {
    id: "9router",
    label: "9router",
    kind: "openai-compatible",
    baseUrl: "http://100.101.203.54:20128/v1",
    model: "",
    needsKey: true,
    hint: "9router di RPi5 lewat Tailscale. Bisa pakai jenis API OpenAI-compatible atau Anthropic, Base URL tetap diakhiri /v1.",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    kind: "gemini",
    baseUrl: "",
    model: "gemini-2.5-flash",
    needsKey: true,
    hint: "Free tier tersedia. Key dari aistudio.google.com/apikey.",
  },
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    kind: "anthropic",
    baseUrl: "",
    model: "claude-sonnet-5-5",
    needsKey: true,
    hint: "Key dari console.anthropic.com.",
  },
  {
    id: "groq",
    label: "Groq",
    kind: "openai-compatible",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile",
    needsKey: true,
    hint: "Free tier dengan batas harian. Key dari console.groq.com.",
  },
  {
    id: "ollama",
    label: "Ollama (lokal)",
    kind: "openai-compatible",
    baseUrl: "http://localhost:11434/v1",
    model: "qwen2.5-coder:7b",
    needsKey: false,
    hint: "Gratis, jalan di komputer sendiri. Tidak perlu API key.",
  },
  {
    id: "openai",
    label: "OpenAI",
    kind: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5-mini",
    needsKey: true,
    hint: "Key dari platform.openai.com.",
  },
  {
    id: "custom",
    label: "Custom (OpenAI-compatible)",
    kind: "openai-compatible",
    baseUrl: "",
    model: "",
    needsKey: false,
    hint: "Endpoint apa pun yang mengikuti format /v1/chat/completions.",
  },
]

export const KIND_LABELS: Record<ProviderKind, string> = {
  "openai-compatible": "OpenAI-compatible",
  anthropic: "Anthropic",
  gemini: "Gemini",
}

export function newId(): string {
  return crypto.randomUUID()
}

export function connectionFromPreset(preset: ProviderPreset): Connection {
  return {
    id: newId(),
    name: preset.label,
    kind: preset.kind,
    baseUrl: preset.baseUrl,
    apiKey: "",
    model: preset.model,
  }
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  activeConnectionId: null,
  connections: [],
  temperature: 0.2,
  maxOutputTokens: 8000,
  autoFixAttempts: 2,
}

export function activeConnection(settings: AiSettings): Connection | undefined {
  return settings.connections.find((c) => c.id === settings.activeConnectionId) ?? settings.connections[0]
}

export function connectionProblem(connection: Connection | undefined): string | null {
  if (!connection) return "Belum ada koneksi AI. Tambahkan di Pengaturan."
  if (!connection.model.trim()) return `Model untuk "${connection.name}" belum diisi.`
  if (connection.kind === "openai-compatible" && !connection.baseUrl.trim()) {
    return `Base URL untuk "${connection.name}" belum diisi.`
  }
  if (connection.kind !== "openai-compatible" && !connection.apiKey.trim()) {
    return `API key untuk "${connection.name}" belum diisi.`
  }
  return null
}

/** Models that reject temperature: Claude 5.x+ and OpenAI reasoning models (o1, o3, gpt-5…). */
const NO_TEMPERATURE = [/claude-(?:opus|sonnet|haiku|fable)-([5-9]|\d{2,})/i, /(?:^|\/)(?:o\d|gpt-5)/i]

export function supportsTemperature(model: string): boolean {
  return !NO_TEMPERATURE.some((pattern) => pattern.test(model))
}

/** Temperature to send for this connection, or undefined to leave it to the provider. */
export function temperatureFor(connection: Connection, temperature: number): number | undefined {
  const mode = connection.temperatureMode ?? "auto"
  if (mode === "omit") return undefined
  if (mode === "send") return temperature
  return supportsTemperature(connection.model) ? temperature : undefined
}
