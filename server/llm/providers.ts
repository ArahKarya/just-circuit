import { createAnthropic } from "@ai-sdk/anthropic"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import type { LanguageModel } from "ai"
import { config } from "../config.js"
import { assertPublicHost, noRedirectFetch, parseHttpUrl, readLimited, UrlGuardError } from "../net/url-guard.js"
import type { Connection } from "./schema.js"

const DEFAULT_BASE_URL: Record<Connection["kind"], string | null> = {
  "openai-compatible": null,
  anthropic: "https://api.anthropic.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
}

/** API version path appended when the user enters only a host, e.g. http://localhost:20128. */
const DEFAULT_VERSION_PATH: Record<Connection["kind"], string> = {
  "openai-compatible": "/v1",
  anthropic: "/v1",
  gemini: "/v1beta",
}

/** Adds the API version path when the base URL has no path, and drops trailing slashes. */
export function normalizeBaseUrl(url: URL, kind: Connection["kind"]): string {
  const path = url.pathname.replace(/\/+$/, "")
  const fullPath = path === "" ? DEFAULT_VERSION_PATH[kind] : path
  return `${url.origin}${fullPath}${url.search}`
}

/** Resolves and validates the base URL for a connection. */
export async function resolveBaseUrl(connection: Connection): Promise<string> {
  const raw = connection.baseUrl || DEFAULT_BASE_URL[connection.kind]
  if (!raw) throw new UrlGuardError("Base URL wajib diisi untuk provider OpenAI-compatible")
  const url = parseHttpUrl(raw)
  await assertPublicHost(url, config.allowPrivateLlmHosts)
  return normalizeBaseUrl(url, connection.kind)
}

export async function createLanguageModel(connection: Connection & { model: string }): Promise<LanguageModel> {
  const baseURL = await resolveBaseUrl(connection)
  const apiKey = connection.apiKey || undefined
  switch (connection.kind) {
    case "openai-compatible":
      return createOpenAICompatible({ name: "custom", baseURL, apiKey, fetch: noRedirectFetch }).chatModel(connection.model)
    case "anthropic":
      return createAnthropic({ baseURL, apiKey, fetch: noRedirectFetch })(connection.model)
    case "gemini":
      return createGoogleGenerativeAI({ baseURL, apiKey, fetch: noRedirectFetch })(connection.model)
  }
}

const MAX_MODELS_BYTES = 5 * 1024 * 1024

interface ModelsRequest {
  url: string
  headers: Record<string, string>
  pick: (body: unknown) => string[]
}

function idsFrom(list: unknown, key: string): string[] {
  if (!Array.isArray(list)) return []
  return list
    .map((item) => (item && typeof item === "object" ? (item as Record<string, unknown>)[key] : undefined))
    .filter((value): value is string => typeof value === "string")
}

function buildModelsRequest(connection: Connection, baseUrl: string): ModelsRequest {
  const key = connection.apiKey
  switch (connection.kind) {
    case "openai-compatible":
      return {
        url: `${baseUrl}/models`,
        headers: key ? { Authorization: `Bearer ${key}` } : {},
        pick: (body) => idsFrom((body as { data?: unknown })?.data, "id"),
      }
    case "anthropic":
      return {
        url: `${baseUrl}/models?limit=100`,
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
        pick: (body) => idsFrom((body as { data?: unknown })?.data, "id"),
      }
    case "gemini":
      return {
        url: `${baseUrl}/models?pageSize=200`,
        headers: { "x-goog-api-key": key },
        pick: (body) => {
          const models = (body as { models?: unknown })?.models
          if (!Array.isArray(models)) return []
          return models
            .filter((m) => Array.isArray(m?.supportedGenerationMethods) && m.supportedGenerationMethods.includes("generateContent"))
            .map((m) => String(m.name).replace(/^models\//, ""))
        },
      }
  }
}

export async function listModels(connection: Connection): Promise<string[]> {
  const baseUrl = await resolveBaseUrl(connection)
  const request = buildModelsRequest(connection, baseUrl)
  const response = await fetch(request.url, {
    headers: request.headers,
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  })
  const body = await readLimited(response, MAX_MODELS_BYTES)
  if (!response.ok) {
    // Echo the provider's message only while private hosts are blocked, so this can't read internal services.
    const detail = config.allowPrivateLlmHosts ? "" : ` ${body.toString("utf8").slice(0, 300)}`
    const hint = response.status === 404 ? " Endpoint tidak ditemukan, cek Base URL (biasanya diakhiri /v1)." : ""
    throw new Error(`Provider menolak permintaan daftar model (HTTP ${response.status}, ${request.url}).${hint}${detail}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(body.toString("utf8"))
  } catch {
    throw new Error("Respons daftar model bukan JSON yang valid")
  }
  const models = request.pick(parsed)
  return [...new Set(models)].sort((a, b) => a.localeCompare(b))
}
