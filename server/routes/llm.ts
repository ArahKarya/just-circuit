import { Router, type Request, type Response } from "express"
import { streamText } from "ai"
import { config } from "../config.js"
import { errorMessage, logger } from "../logger.js"
import { describeProviderError } from "../llm/errors.js"
import { UrlGuardError } from "../net/url-guard.js"
import { createLanguageModel, listModels } from "../llm/providers.js"
import { chatRequestSchema, modelsRequestSchema } from "../llm/schema.js"

/** One NDJSON line streamed to the browser. */
export type ChatStreamEvent =
  | { type: "text"; text: string }
  | { type: "error"; message: string }
  | { type: "done"; finishReason?: string }

function writeEvent(res: Response, event: ChatStreamEvent): void {
  res.write(`${JSON.stringify(event)}\n`)
}

function sendError(res: Response, status: number, message: string): void {
  res.status(status).json({ success: false, error: message })
}

async function handleChat(req: Request, res: Response): Promise<void> {
  const parsed = chatRequestSchema.safeParse(req.body)
  if (!parsed.success) {
    sendError(res, 400, parsed.error.issues.map((issue) => issue.message).join("; "))
    return
  }
  const body = parsed.data

  let model
  try {
    model = await createLanguageModel(body.connection)
  } catch (error) {
    sendError(res, error instanceof UrlGuardError ? 400 : 500, errorMessage(error))
    return
  }

  const abort = new AbortController()
  res.on("close", () => abort.abort())
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
      abortSignal: AbortSignal.any([abort.signal, AbortSignal.timeout(config.upstreamTimeoutMs)]),
      maxRetries: 1,
      // Errors are reported through fullStream below; this stops the SDK from dumping them to the console.
      onError: () => undefined,
    })
    let finishReason: string | undefined
    for await (const part of result.fullStream) {
      if (part.type === "text-delta") writeEvent(res, { type: "text", text: part.text })
      else if (part.type === "error") {
        logger.warn("llm chat failed", { kind: body.connection.kind, error: describeProviderError(part.error) })
        writeEvent(res, { type: "error", message: describeProviderError(part.error) })
      }
      else if (part.type === "finish") finishReason = part.finishReason
    }
    writeEvent(res, { type: "done", finishReason })
  } catch (error) {
    if (!abort.signal.aborted) {
      logger.warn("llm chat failed", { kind: body.connection.kind, error: describeProviderError(error) })
      writeEvent(res, { type: "error", message: describeProviderError(error) })
    }
  } finally {
    res.end()
  }
}

async function handleModels(req: Request, res: Response): Promise<void> {
  const parsed = modelsRequestSchema.safeParse(req.body)
  if (!parsed.success) {
    sendError(res, 400, parsed.error.issues.map((issue) => issue.message).join("; "))
    return
  }
  try {
    const models = await listModels(parsed.data.connection)
    res.json({ success: true, data: models })
  } catch (error) {
    sendError(res, error instanceof UrlGuardError ? 400 : 502, errorMessage(error))
  }
}

export function llmRouter(): Router {
  const router = Router()
  router.post("/chat", handleChat)
  router.post("/models", handleModels)
  return router
}
