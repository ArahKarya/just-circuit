import path from "node:path"
import { z } from "zod"
import type { SecretBox } from "../security/secret-box.js"
import { readJsonFile, writeJsonFile } from "./fs-utils.js"
import { providerKinds } from "../llm/schema.js"

export const reasoningLevels = ["provider-default", "none", "low", "medium", "high"] as const
export type ReasoningLevel = (typeof reasoningLevels)[number]
const timeoutSeconds = z.number().int().min(10).max(1800)

const connectionBase = z.object({
  id: z.string().min(1).max(100),
  name: z.string().max(100),
  kind: z.enum(providerKinds),
  baseUrl: z.string().trim().max(500),
  model: z.string().trim().max(200),
  temperatureMode: z.enum(["auto", "send", "omit"]).optional(),
  /** How much the model thinks before answering; provider-default sends nothing. */
  reasoning: z.enum(reasoningLevels).optional(),
  /** Overrides LLM_FIRST_CHUNK_TIMEOUT_MS / LLM_IDLE_TIMEOUT_MS for this connection. */
  firstChunkTimeoutSec: timeoutSeconds.optional(),
  idleTimeoutSec: timeoutSeconds.optional(),
})

const settingsBase = z.object({
  activeConnectionId: z.string().max(100).nullable(),
  /** Connection for automatic build fixes (null: same as chat), e.g. a cheaper, faster model. */
  autoFixConnectionId: z.string().max(100).nullable().optional(),
  temperature: z.number().min(0).max(2),
  maxOutputTokens: z.number().int().min(256).max(64_000),
  autoFixAttempts: z.number().int().min(0).max(10),
  /** Earlier chat messages sent with each request. */
  historyLimit: z.number().int().min(2).max(100).optional(),
  /** Agent mode: the model works with tools (read/write files, build, part search). */
  agentMode: z.boolean().optional(),
  agentMaxSteps: z.number().int().min(2).max(40).optional(),
  /** Let the agent run `tsci build` on the server (sandboxed). Off: the browser preview checks. */
  agentServerBuild: z.boolean().optional(),
})

/** What the browser sends: apiKey null keeps the stored key, "" removes it. */
export const settingsInputSchema = settingsBase.extend({
  connections: z.array(connectionBase.extend({ apiKey: z.string().max(500).nullable() })).max(50),
})

type StoredConnection = z.infer<typeof connectionBase> & { apiKeySealed?: string }
type StoredSettings = z.infer<typeof settingsBase> & { connections: StoredConnection[] }
export type SettingsInput = z.infer<typeof settingsInputSchema>

/** Settings as the browser sees them: keys never leave the server. */
export type PublicSettings = z.infer<typeof settingsBase> & {
  connections: (z.infer<typeof connectionBase> & { apiKey: ""; hasApiKey: boolean })[]
}

export interface ResolvedConnection {
  kind: (typeof providerKinds)[number]
  baseUrl: string
  apiKey: string
  model: string
  reasoning?: ReasoningLevel
  firstChunkTimeoutSec?: number
  idleTimeoutSec?: number
}

const DEFAULTS: StoredSettings = { activeConnectionId: null, connections: [], temperature: 0.2, maxOutputTokens: 8000, autoFixAttempts: 2 }

export function createSettingsStore(dataDir: string, box: SecretBox) {
  const file = path.join(dataDir, "settings.json")

  const load = async (): Promise<StoredSettings> => ({ ...DEFAULTS, ...(await readJsonFile<Partial<StoredSettings>>(file, {})) })

  function toPublic(settings: StoredSettings): PublicSettings {
    return {
      ...settings,
      connections: settings.connections.map(({ apiKeySealed, ...c }) => ({ ...c, apiKey: "", hasApiKey: Boolean(apiKeySealed) })),
    }
  }

  async function read(): Promise<PublicSettings> {
    return toPublic(await load())
  }

  async function write(input: SettingsInput): Promise<PublicSettings> {
    const previous = new Map((await load()).connections.map((c) => [c.id, c]))
    const connections = input.connections.map(({ apiKey, ...c }): StoredConnection => {
      const before = previous.get(c.id)
      // Keep the stored key only while it still goes to the same provider; a new URL needs the key re-entered.
      const sameTarget = before !== undefined && before.baseUrl === c.baseUrl && before.kind === c.kind
      const sealed = apiKey === null ? (sameTarget ? before.apiKeySealed : undefined) : apiKey === "" ? undefined : box.seal(apiKey)
      return sealed ? { ...c, apiKeySealed: sealed } : c
    })
    const next: StoredSettings = { ...input, connections }
    await writeJsonFile(file, next, { mode: 0o600 })
    return toPublic(next)
  }

  /** Connection with its decrypted key, for calling the provider. */
  async function resolve(connectionId: string): Promise<ResolvedConnection | null> {
    const connection = (await load()).connections.find((c) => c.id === connectionId)
    if (!connection) return null
    return {
      kind: connection.kind,
      baseUrl: connection.baseUrl,
      model: connection.model,
      apiKey: connection.apiKeySealed ? box.open(connection.apiKeySealed) : "",
      reasoning: connection.reasoning,
      firstChunkTimeoutSec: connection.firstChunkTimeoutSec,
      idleTimeoutSec: connection.idleTimeoutSec,
    }
  }

  /** Every stored API key, decrypted: only to hide them from bug reports, never to send anywhere. */
  async function apiKeys(): Promise<string[]> {
    return (await load()).connections.flatMap((c) => (c.apiKeySealed ? [box.open(c.apiKeySealed)] : []))
  }

  /** Settings without keys, for server-side decisions (e.g. agent options). */
  async function readRaw(): Promise<z.infer<typeof settingsBase>> {
    const { connections: _connections, ...rest } = await load()
    return rest
  }

  return { read, write, resolve, readRaw, apiKeys }
}

export type SettingsStore = ReturnType<typeof createSettingsStore>
