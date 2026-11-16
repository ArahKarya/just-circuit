import { Router, type Request, type Response } from "express"
import { streamText } from "ai"
import { config } from "../config.js"
import { errorMessage, logger } from "../logger.js"
import { describeProviderError } from "../llm/errors.js"
import { createIdleTimer } from "../llm/idle-timer.js"
import { UrlGuardError } from "../net/url-guard.js"
import { createLanguageModel, listModels } from "../llm/providers.js"
import { chatRequestSchema, modelsRequestSchema } from "../llm/schema.js"
import type { SettingsStore } from "../storage/settings.js"

/** One NDJSON line streamed to the browser. */
export type ChatStreamEvent =
  | { type: "text"; text: string }
  /** The model's thinking, shown so long reasoning doesn't look like a hang. */
  | { type: "reasoning"; text: string }
  | { type: "error"; message: string }
  | { type: "done"; finishReason?: string }

function writeEvent(res: Response, event: ChatStreamEvent): void {
  res.write(`${JSON.stringify(event)}\n`)
}

function sendError(res: Response, status: number, message: string): void {
  res.status(status).json({ success: false, error: message })
}

async function handleChat(settings: SettingsStore, req: Request, res: Response): Promise<void> {
  const parsed = chatRequestSchema.safeParse(req.body)
  if (!parsed.success) {
    sendError(res, 400, parsed.error.issues.map((issue) => issue.message).join("; "))
    return
  }
  const body = parsed.data
  const connection = await settings.resolve(body.connectionId)
  if (!connection) {
    sendError(res, 400, "Koneksi AI tidak ditemukan. Simpan pengaturan dulu.")
    return
  }
  if (!connection.model) {
    sendError(res, 400, "Model wajib diisi")
    return
  }

  let model
  try {
    model = await createLanguageModel(connection)
  } catch (error) {
    sendError(res, error instanceof UrlGuardError ? 400 : 500, errorMessage(error))
    return
  }

  const clientGone = new AbortController()
  const upstream = new AbortController()
  let stopReason: "first" | "idle" | "total" | null = null
  const idle = createIdleTimer(
    config.idleTimeoutMs,
    (phase) => {
      stopReason = phase === "first" ? "first" : "idle"
      upstream.abort()
    },
    config.firstChunkTimeoutMs,
  )
  const total = setTimeout(() => {
    stopReason = "total"
    upstream.abort()
  }, config.upstreamTimeoutMs)
  const startedAt = Date.now()
  const logContext = { kind: connection.kind, model: connection.model }
  res.on("close", () => clientGone.abort())
  res.status(200)
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8")
  res.setHeader("Cache-Control", "no-cache")
  res.setHeader("X-Accel-Buffering", "no")
  res.flushHeaders()

  try {
    const result = streamText({
      model,
      system: body.system,
      messages: body.messages,
      temperature: body.temperature,
      maxOutputTokens: body.maxOutputTokens,
      abortSignal: AbortSignal.any([clientGone.signal, upstream.signal]),
      maxRetries: 1,
      // Errors are reported through fullStream below; this stops the SDK from dumping them to the console.
      onError: () => undefined,
    })
    let finishReason: string | undefined
    let failed = false
    for await (const part of result.fullStream) {
      // Only real output counts as progress; lifecycle parts (start, start-step) arrive with the headers.
      if (part.type === "text-delta" || part.type === "reasoning-delta") idle.touch()
      if (part.type === "text-delta") writeEvent(res, { type: "text", text: part.text })
      else if (part.type === "reasoning-delta") writeEvent(res, { type: "reasoning", text: part.text })
      else if (part.type === "error") {
        failed = true
        logger.warn("llm chat failed", { ...logContext, seconds: Math.round((Date.now() - startedAt) / 1000), error: describeProviderError(part.error) })
        writeEvent(res, { type: "error", message: describeProviderError(part.error) })
      } else if (part.type === "finish") finishReason = part.finishReason
    }
    if (stopReason) throw new Error("stopped")
    if (failed) return
    logger.info("llm chat done", { ...logContext, finishReason, seconds: Math.round((Date.now() - startedAt) / 1000) })
    writeEvent(res, { type: "done", finishReason })
  } catch (error) {
    if (!clientGone.signal.aborted) {
      const message = timeoutMessage(stopReason) ?? describeProviderError(error)
      logger.warn("llm chat failed", { ...logContext, seconds: Math.round((Date.now() - startedAt) / 1000), error: message })
      writeEvent(res, { type: "error", message })
    }
  } finally {
    idle.stop()
    clearTimeout(total)
    res.end()
  }
}

function formatDuration(ms: number): string {
  return ms >= 60_000 ? `${Math.round(ms / 60_000)} menit` : `${Math.round(ms / 1000)} detik`
}

function timeoutMessage(reason: "first" | "idle" | "total" | null): string | null {
  if (reason === "first") {
    return `AI belum mengirim balasan apa pun setelah ${formatDuration(config.firstChunkTimeoutMs)}, jadi dihentikan. Model mungkin antre atau kuota provider habis; coba model yang lebih cepat (mis. Sonnet).`
  }
  if (reason === "idle") {
    return `AI berhenti mengirim selama ${formatDuration(config.idleTimeoutMs)} di tengah jawaban, jadi dihentikan. Provider atau model ini mungkin sedang bermasalah; coba model lain.`
  }
  if (reason === "total") {
    return `Jawaban AI melebihi ${formatDuration(config.upstreamTimeoutMs)}, jadi dihentikan. Coba minta bagian yang lebih kecil.`
  }
  return null
}

async function handleModels(settings: SettingsStore, req: Request, res: Response): Promise<void> {
  const parsed = modelsRequestSchema.safeParse(req.body)
  if (!parsed.success) {
    sendError(res, 400, parsed.error.issues.map((issue) => issue.message).join("; "))
    return
  }
  try {
    const { connection, connectionId } = parsed.data
    const saved = !connection.apiKey && connectionId ? await settings.resolve(connectionId) : null
    // A stored key is only ever sent to the provider it was saved for, never to a URL from this request.
    const models = await listModels(saved ? { ...saved, model: connection.model } : connection)
    res.json({ success: true, data: models })
  } catch (error) {
    sendError(res, error instanceof UrlGuardError ? 400 : 502, errorMessage(error))
  }
}

export function llmRouter(settings: SettingsStore): Router {
  const router = Router()
  router.post("/chat", (req, res, next) => handleChat(settings, req, res).catch(next))
  router.post("/models", (req, res, next) => handleModels(settings, req, res).catch(next))
  return router
}
