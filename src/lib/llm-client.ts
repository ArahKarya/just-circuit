import { UNAUTHORIZED_EVENT } from "./api"
import type { Connection } from "./types"

export interface ChatTurn {
  role: "user" | "assistant"
  content: string
}

export interface ChatRequest {
  connection: Connection
  system: string
  messages: ChatTurn[]
  /** Undefined leaves temperature out of the request. */
  temperature: number | undefined
  maxOutputTokens: number
  signal?: AbortSignal
  onText: (delta: string) => void
  /** The model's thinking, streamed before (or between) answer text. */
  onReasoning?: (delta: string) => void
}

type StreamEvent =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "error"; message: string }
  | { type: "done"; finishReason?: string }

export interface ChatResult {
  text: string
  /** True when the model stopped because it hit the output token limit. */
  truncated: boolean
}

const JSON_HEADERS = { "Content-Type": "application/json", "X-CDS-Request": "1" }

/** apiKey is only sent when typed in the (unsaved) form; otherwise the server uses the stored key. */
function toServerConnection(connection: Connection) {
  return { kind: connection.kind, baseUrl: connection.baseUrl, apiKey: connection.clearApiKey ? "" : connection.apiKey, model: connection.model }
}

async function readErrorMessage(response: Response): Promise<string> {
  if (response.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
  try {
    const body = (await response.json()) as { error?: string }
    return body.error ?? `HTTP ${response.status}`
  } catch {
    return `HTTP ${response.status}`
  }
}

function parseLine(line: string): StreamEvent | null {
  if (!line.trim()) return null
  try {
    return JSON.parse(line) as StreamEvent
  } catch {
    return null
  }
}

/** Streams a chat completion through the CDS server. Rejects if the stream ends early. */
export async function streamChat(request: ChatRequest): Promise<ChatResult> {
  const response = await fetch("/api/llm/chat", {
    method: "POST",
    headers: JSON_HEADERS,
    signal: request.signal,
    body: JSON.stringify({
      connectionId: request.connection.id,
      system: request.system,
      messages: request.messages,
      temperature: request.temperature,
      maxOutputTokens: request.maxOutputTokens,
    }),
  })
  if (!response.ok || !response.body) throw new Error(await readErrorMessage(response))

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ""
  let reply = ""
  const state: { finishReason: string | undefined; done: boolean } = { finishReason: undefined, done: false }
  const handle = (event: StreamEvent | null) => {
    if (event?.type === "text") {
      reply += event.text
      request.onText(event.text)
    } else if (event?.type === "reasoning") {
      request.onReasoning?.(event.text)
    } else if (event?.type === "error") {
      throw new Error(event.message)
    } else if (event?.type === "done") {
      state.done = true
      state.finishReason = event.finishReason
    }
  }
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += value
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""
      lines.forEach((line) => handle(parseLine(line)))
    }
    handle(parseLine(buffer))
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
  }
  if (!state.done) throw new Error("Koneksi ke AI terputus sebelum jawaban selesai. Perubahan tidak diterapkan.")
  return { text: reply, truncated: state.finishReason === "length" }
}

export async function fetchModels(connection: Connection): Promise<string[]> {
  const response = await fetch("/api/llm/models", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ connection: toServerConnection(connection), connectionId: connection.id }),
  })
  if (!response.ok) throw new Error(await readErrorMessage(response))
  const body = (await response.json()) as { data?: string[] }
  return body.data ?? []
}
