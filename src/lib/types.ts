export type ProviderKind = "openai-compatible" | "anthropic" | "gemini"

/** "auto" sends temperature unless the model is known to reject it. */
export type TemperatureMode = "auto" | "send" | "omit"

export interface Connection {
  id: string
  name: string
  kind: ProviderKind
  baseUrl: string
  apiKey: string
  model: string
  temperatureMode?: TemperatureMode
  /** The server holds a key for this connection (keys are never sent back to the browser). */
  hasApiKey?: boolean
  /** Remove the stored key on the next save. */
  clearApiKey?: boolean
}

export interface AiSettings {
  activeConnectionId: string | null
  connections: Connection[]
  temperature: number
  maxOutputTokens: number
  /** How many times the assistant may retry on its own when the circuit fails to build. */
  autoFixAttempts: number
}

export type ProjectFiles = Readonly<Record<string, string>>

/** Project as listed (without file contents). */
export interface ProjectSummary {
  id: string
  name: string
  entrypoint: string
  workspaceId: string
  fileCount: number
  createdAt: number
  updatedAt: number
}

export interface Workspace {
  id: string
  name: string
  createdAt: number
  projectCount: number
}

export interface TrashEntry {
  entryId: string
  projectId: string
  name: string
  workspaceId: string
  deletedAt: number
  fileCount: number
}

export interface Project {
  id: string
  name: string
  files: ProjectFiles
  entrypoint: string
  createdAt: number
  updatedAt: number
}

export type ChatRole = "user" | "assistant"

export interface ChatMessage {
  id: string
  projectId: string
  role: ChatRole
  content: string
  createdAt: number
  /** Files the assistant wrote in this message, applied to the project. */
  appliedFiles?: string[]
  /** Project files before this message was applied, so it can be undone. */
  previousFiles?: ProjectFiles
  isError?: boolean
}

export interface RunStatus {
  state: "idle" | "running" | "ok" | "error"
  errors: string[]
  /** Design concerns that don't fail the build (shown, never auto-fixed). */
  warnings: string[]
  /** filesKey() of the files this status belongs to. */
  revision: string
}
