export type ProviderKind = "openai-compatible" | "anthropic" | "gemini"

/** "auto" sends temperature unless the model is known to reject it. */
export type TemperatureMode = "auto" | "send" | "omit"

/** How much the model thinks before answering; provider-default sends nothing. */
export type ReasoningLevel = "provider-default" | "none" | "low" | "medium" | "high"

export interface Connection {
  id: string
  name: string
  kind: ProviderKind
  baseUrl: string
  apiKey: string
  model: string
  temperatureMode?: TemperatureMode
  reasoning?: ReasoningLevel
  /** Seconds to wait for the first chunk / between chunks (default from the server's env). */
  firstChunkTimeoutSec?: number
  idleTimeoutSec?: number
  /** The server holds a key for this connection (keys are never sent back to the browser). */
  hasApiKey?: boolean
  /** Remove the stored key on the next save. */
  clearApiKey?: boolean
}

export interface AiSettings {
  activeConnectionId: string | null
  /** Connection for automatic build fixes (null: same as chat). */
  autoFixConnectionId?: string | null
  /** Earlier chat messages sent with each request. */
  historyLimit?: number
  /** Agent mode: the AI reads/writes files, builds and searches parts with tools. */
  agentMode?: boolean
  agentMaxSteps?: number
  /** Let the agent run tsci build on the server (sandboxed); off: the browser preview checks. */
  agentServerBuild?: boolean
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

export interface Version {
  sha: string
  shortSha: string
  message: string
  createdAt: number
  files: string[]
}

export interface TrashEntry {
  entryId: string
  projectId: string
  name: string
  workspaceId: string
  deletedAt: number
  fileCount: number
}

export interface ProjectSettings {
  /** Extra instructions for the AI in this project. */
  aiRules?: string
  /** Connection for this project's chat (null: the global active one). */
  connectionId?: string | null
}

export type ThemeSetting = "dark" | "light" | "system"
export type PreviewTab = "pcb" | "schematic" | "cad" | "bom"

export interface Preferences {
  theme: ThemeSetting
  editor: { fontSize: number; tabSize: 2 | 4; wordWrap: boolean; minimap: boolean; lineNumbers: boolean }
  preview: { debounceMs: number; defaultTab: PreviewTab }
}

export interface Project {
  id: string
  name: string
  files: ProjectFiles
  entrypoint: string
  settings?: ProjectSettings
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
  /** Agent mode: the tools the AI used for this answer. */
  toolSteps?: ToolStep[]
}

export interface ToolStep {
  name: string
  /** What it was asked (a path, a query, a command). */
  detail: string
  /** undefined while running. */
  ok?: boolean
  result?: string
}

export interface RunStatus {
  state: "idle" | "running" | "ok" | "error"
  errors: string[]
  /** Design concerns that don't fail the build (shown, never auto-fixed). */
  warnings: string[]
  /** filesKey() of the files this status belongs to. */
  revision: string
}
