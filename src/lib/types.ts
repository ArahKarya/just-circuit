export type ProviderKind = "openai-compatible" | "anthropic" | "gemini"

export interface Connection {
  id: string
  name: string
  kind: ProviderKind
  baseUrl: string
  apiKey: string
  model: string
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
  /** filesKey() of the files this status belongs to. */
  revision: string
}
