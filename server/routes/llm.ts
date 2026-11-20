import { Router, type Request, type Response } from "express"
import path from "node:path"
import { generateText, stepCountIs, streamText, type ToolSet } from "ai"
import { createAgentTools, isUnexpectedToolError, type AgentContext } from "../agent/tools.js"
import type { BugReportStore } from "../storage/bug-reports.js"
import { describeToolCall, describeToolResult } from "../agent/summary.js"
import type { AttachmentStore } from "../storage/attachments.js"
import type { ProjectStore } from "../storage/projects.js"
import { buildModelMessages, hasAttachments } from "../llm/attachment-parts.js"
import { config } from "../config.js"
import { errorMessage, logger } from "../logger.js"
import { describeProviderError } from "../llm/errors.js"
import { createIdleTimer } from "../llm/idle-timer.js"
import { UrlGuardError } from "../net/url-guard.js"
import { createLanguageModel, listModels } from "../llm/providers.js"
import { chatRequestSchema, modelsRequestSchema } from "../llm/schema.js"
import type { ResolvedConnection, SettingsStore } from "../storage/settings.js"
import type { Connection } from "../llm/schema.js"

const TEST_TIMEOUT_MS = 90_000
const TOOL_INPUT_REPORT_CHARS = 1024
const TEST_REPLY_CHARS = 200

/**
 * Connection described by a models/test request. An empty apiKey falls back to the stored key,
 * but then the stored URL and kind are used too: a stored key never goes to a URL from the request.
 */
async function connectionFromForm(settings: SettingsStore, connection: Connection, connectionId: string | undefined): Promise<Connection & Partial<ResolvedConnection>> {
  const saved = !connection.apiKey && connectionId ? await settings.resolve(connectionId) : null
  return saved ? { ...saved, model: connection.model } : connection
}

/** One NDJSON line streamed to the browser. */
export type ChatStreamEvent =
  | { type: "text"; text: string }
  /** The model's thinking, shown so long reasoning doesn't look like a hang. */
  | { type: "reasoning"; text: string }
  | { type: "error"; message: string }
  /** Agent mode: a tool call and its outcome, shown as steps in the chat. */
  | { type: "tool"; id: string; name: string; detail: string }
  /** Agent mode: the model is still writing a tool's input (a big edit can take minutes). */
  | { type: "tool-input"; id: string; name: string; chars: number }
  | { type: "tool-result"; id: string; name: string; ok: boolean; detail: string }
  /** Agent mode: the agent changed these files (already saved and recorded as a version). */
  | { type: "files-changed"; paths: string[] }
  | { type: "done"; finishReason?: string }

function writeEvent(res: Response, event: ChatStreamEvent): void {
  res.write(`${JSON.stringify(event)}\n`)
}

function sendError(res: Response, status: number, message: string): void {
  res.status(status).json({ success: false, error: message })
}

const ATTACHMENT_HINT = " Kalau ini karena lampiran: pastikan modelnya bisa membaca gambar/PDF (mis. Claude, Gemini, GPT-4o/5), atau kirim ulang tanpa lampiran."

/** Reads attached files from the project; a missing one becomes a note instead of failing the chat. */
async function resolveMessages(attachments: AttachmentStore, projectId: string | undefined, body: { messages: Parameters<typeof buildModelMessages>[0] }, kind: Connection["kind"]) {
  if (!hasAttachments(body.messages)) return body.messages.map(({ role, content }) => ({ role, content }))
  if (!projectId) throw new Error("projectId wajib diisi untuk pesan dengan lampiran")
  return buildModelMessages(
    body.messages,
    {
      info: (id) => attachments.info(projectId, id).catch(() => null),
      bytes: async (id) => (await attachments.get(projectId, id).catch(() => null))?.bytes ?? null,
      text: (id) => attachments.text(projectId, id).catch(() => ""),
    },
    kind,
  )
}

async function handleChat(settings: SettingsStore, projects: ProjectStore, attachments: AttachmentStore, bugs: BugReportStore, req: Request, res: Response): Promise<void> {
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
  let messages
  try {
    messages = await resolveMessages(attachments, body.agent?.projectId ?? body.projectId, body, connection.kind)
  } catch (error) {
    sendError(res, 400, errorMessage(error))
    return
  }
  const withAttachments = hasAttachments(body.messages)

  const timeouts = {
    firstMs: connection.firstChunkTimeoutSec ? connection.firstChunkTimeoutSec * 1000 : config.firstChunkTimeoutMs,
    idleMs: connection.idleTimeoutSec ? connection.idleTimeoutSec * 1000 : config.idleTimeoutMs,
  }
  const clientGone = new AbortController()
  const upstream = new AbortController()
  let stopReason: "first" | "idle" | "total" | null = null
  const idle = createIdleTimer(
    timeouts.idleMs,
    (phase) => {
      stopReason = phase === "first" ? "first" : "idle"
      upstream.abort()
    },
    timeouts.firstMs,
  )
  const total = setTimeout(() => {
    stopReason = "total"
    upstream.abort()
  }, body.agent ? config.agentTimeoutMs : config.upstreamTimeoutMs)
  const startedAt = Date.now()
  const logContext = { kind: connection.kind, model: connection.model }
  res.on("close", () => clientGone.abort())
  res.status(200)
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8")
  res.setHeader("Cache-Control", "no-cache")
  res.setHeader("X-Accel-Buffering", "no")
  res.flushHeaders()

  let agent: AgentContext | null = null
  let tools: ToolSet | undefined
  if (body.agent) {
    try {
      await projects.pathOf(body.agent.projectId)
    } catch {
      writeEvent(res, { type: "error", message: "Proyek tidak ditemukan" })
      res.end()
      return
    }
    const stored = await settings.readRaw()
    agent = {
      projectId: body.agent.projectId,
      store: projects,
      keepAlive: () => idle.touch(),
      changed: new Set(),
      reportBug: async (title, details) => {
        const read = [...(agent?.outsideReads ?? []), ...(withAttachments ? ["lampiran"] : [])]
        // Tell whoever fixes it that outside text was in the agent's context when it wrote this.
        const note = read.length > 0 ? `\n\n[Catatan Just Circuit: run ini membaca data dari luar (${read.join(", ")}); isi laporan bisa terpengaruh teks itu.]` : ""
        await bugs.record({ source: "agent", title, details: `${details}${note}`, context: { where: "agent:report_app_bug", projectId: body.agent?.projectId } })
      },
      outsideReads: new Set(),
      signal: AbortSignal.any([clientGone.signal, upstream.signal]),
      serverBuild: {
        enabled: stored.agentServerBuild === true,
        runtimeDir: path.join(config.dataDir, "build-runtime"),
        secretDirs: [config.dataDir],
        footprintCacheDir: path.join(config.dataDir, "cache", "kicad-footprints"),
        schematicDisabled: body.agent.schematicDisabled,
        routingDisabled: body.agent.routingDisabled,
      },
    }
    tools = createAgentTools(agent)
    // Hand edits since the last version stay separate from what the agent does.
    await projects.saveVersion(body.agent.projectId, "Perubahan manual").catch(() => null)
  }

  try {
    const result = streamText({
      ...(tools && body.agent ? { tools, stopWhen: stepCountIs(body.agent.maxSteps) } : {}),
      model,
      system: body.system,
      messages,
      temperature: body.temperature,
      ...(connection.reasoning && connection.reasoning !== "provider-default" ? { reasoning: connection.reasoning } : {}),
      maxOutputTokens: body.maxOutputTokens,
      abortSignal: AbortSignal.any([clientGone.signal, upstream.signal]),
      maxRetries: 1,
      // Errors are reported through fullStream below; this stops the SDK from dumping them to the console.
      onError: () => undefined,
    })
    let finishReason: string | undefined
    let failed = false
    // Tool inputs being written: progress is reported at most every TOOL_INPUT_REPORT_CHARS.
    const writing = new Map<string, { name: string; chars: number; reported: number }>()
    for await (const part of result.fullStream) {
      // Only real output counts as progress; lifecycle parts (start, start-step) arrive with the headers.
      // A tool input streams as deltas too: an edit holding a whole new group takes minutes to write.
      if (part.type === "text-delta" || part.type === "reasoning-delta" || part.type === "tool-input-delta" || part.type === "tool-input-start") idle.touch()
      if (part.type === "tool-input-start") {
        writing.set(part.id, { name: part.toolName, chars: 0, reported: 0 })
        writeEvent(res, { type: "tool-input", id: part.id, name: part.toolName, chars: 0 })
      } else if (part.type === "tool-input-delta") {
        const input = writing.get(part.id)
        if (input) {
          input.chars += part.delta.length
          if (input.chars - input.reported >= TOOL_INPUT_REPORT_CHARS) {
            input.reported = input.chars
            writeEvent(res, { type: "tool-input", id: part.id, name: input.name, chars: input.chars })
          }
        }
      }
      if (part.type === "text-delta") writeEvent(res, { type: "text", text: part.text })
      else if (part.type === "reasoning-delta") writeEvent(res, { type: "reasoning", text: part.text })
      else if (part.type === "tool-call") {
        idle.touch()
        writeEvent(res, { type: "tool", id: part.toolCallId, name: part.toolName, detail: describeToolCall(part.toolName, part.input) })
      } else if (part.type === "tool-result") {
        idle.touch()
        writeEvent(res, { type: "tool-result", id: part.toolCallId, name: part.toolName, ok: true, detail: describeToolResult(part.toolName, part.output) })
      } else if (part.type === "tool-error") {
        idle.touch()
        writeEvent(res, { type: "tool-result", id: part.toolCallId, name: part.toolName, ok: false, detail: errorMessage(part.error).slice(0, 200) })
        // Expected tool failures (bad path, no match) are thrown as plain messages for the AI;
        // anything with a stack outside our own messages is worth a look.
        if (isUnexpectedToolError(part.error)) {
          void bugs
            .record({ source: "server", title: `Tool agen ${part.toolName} gagal: ${errorMessage(part.error)}`, details: part.error instanceof Error ? (part.error.stack ?? "") : "", context: { where: `agent:${part.toolName}`, projectId: body.agent?.projectId } })
            .catch(() => undefined)
        }
      }
      else if (part.type === "error") {
        failed = true
        logger.warn("llm chat failed", { ...logContext, seconds: Math.round((Date.now() - startedAt) / 1000), error: describeProviderError(part.error) })
        writeEvent(res, { type: "error", message: describeProviderError(part.error) + (withAttachments ? ATTACHMENT_HINT : "") })
      } else if (part.type === "finish") finishReason = part.finishReason
    }
    if (stopReason) throw new Error("stopped")
    if (failed) return
    if (agent && agent.changed.size > 0 && body.agent) {
      await projects.saveVersion(body.agent.projectId, body.agent.versionMessage).catch(() => null)
      writeEvent(res, { type: "files-changed", paths: [...agent.changed].sort() })
    }
    logger.info("llm chat done", { ...logContext, agent: Boolean(agent), finishReason, seconds: Math.round((Date.now() - startedAt) / 1000) })
    writeEvent(res, { type: "done", finishReason })
  } catch (error) {
    // Files the agent already wrote stay on disk: tell the browser to reload them.
    if (agent && agent.changed.size > 0 && body.agent) {
      await projects.saveVersion(body.agent.projectId, `${body.agent.versionMessage} (terhenti)`).catch(() => null)
      if (!clientGone.signal.aborted) writeEvent(res, { type: "files-changed", paths: [...agent.changed].sort() })
    }
    if (!clientGone.signal.aborted) {
      const timedOut = timeoutMessage(stopReason, timeouts)
      const message = timedOut ?? describeProviderError(error) + (withAttachments ? ATTACHMENT_HINT : "")
      // Timeouts have been app bugs before (idle timer vs long tool inputs); provider errors are not ours.
      if (timedOut) {
        void bugs
          .record({ source: "server", title: `AI dihentikan karena timeout (${stopReason})`, details: `${timedOut}\nmodel: ${connection.kind}/${connection.model}, agent: ${Boolean(body.agent)}, ${Math.round((Date.now() - startedAt) / 1000)} detik`, context: { where: "llm:chat", projectId: body.agent?.projectId } })
          .catch(() => undefined)
      }
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

function timeoutMessage(reason: "first" | "idle" | "total" | null, timeouts: { firstMs: number; idleMs: number }): string | null {
  if (reason === "first") {
    return `AI belum mengirim balasan apa pun setelah ${formatDuration(timeouts.firstMs)}, jadi dihentikan. Model mungkin antre atau kuota provider habis; coba model yang lebih cepat (mis. Sonnet), atau naikkan batas waktunya di Pengaturan.`
  }
  if (reason === "idle") {
    return `AI berhenti mengirim selama ${formatDuration(timeouts.idleMs)} di tengah jawaban, jadi dihentikan. Provider atau model ini mungkin sedang bermasalah; coba model lain.`
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
    const models = await listModels(await connectionFromForm(settings, parsed.data.connection, parsed.data.connectionId))
    res.json({ success: true, data: models })
  } catch (error) {
    sendError(res, error instanceof UrlGuardError ? 400 : 502, errorMessage(error))
  }
}

/** Sends a tiny prompt to check URL, key and model, and reports how long it took. */
async function handleTest(settings: SettingsStore, req: Request, res: Response): Promise<void> {
  const parsed = modelsRequestSchema.safeParse(req.body)
  if (!parsed.success) {
    sendError(res, 400, parsed.error.issues.map((issue) => issue.message).join("; "))
    return
  }
  const connection = await connectionFromForm(settings, parsed.data.connection, parsed.data.connectionId)
  if (!connection.model) {
    sendError(res, 400, "Model wajib diisi")
    return
  }
  const startedAt = Date.now()
  try {
    const model = await createLanguageModel({ ...connection, model: connection.model })
    const result = await generateText({
      model,
      prompt: "Balas hanya dengan kata: OK",
      maxOutputTokens: 1024,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    })
    res.json({ success: true, data: { ms: Date.now() - startedAt, reply: result.text.trim().slice(0, TEST_REPLY_CHARS) } })
  } catch (error) {
    const message = error instanceof DOMException && error.name === "TimeoutError" ? `Tidak ada jawaban dalam ${TEST_TIMEOUT_MS / 1000} detik` : describeProviderError(error)
    sendError(res, error instanceof UrlGuardError ? 400 : 502, message)
  }
}

export function llmRouter(settings: SettingsStore, projects: ProjectStore, attachments: AttachmentStore, bugs: BugReportStore): Router {
  const router = Router()
  router.post("/chat", (req, res, next) => handleChat(settings, projects, attachments, bugs, req, res).catch(next))
  router.post("/models", (req, res, next) => handleModels(settings, req, res).catch(next))
  router.post("/test", (req, res, next) => handleTest(settings, req, res).catch(next))
  return router
}
