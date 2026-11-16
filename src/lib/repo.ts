import { api } from "./api"
import { notifyChange } from "./live-data"
import type { AiSettings, ChatMessage, Connection, Project, ProjectFiles, ProjectSummary, TrashEntry, Version, Workspace } from "./types"

export const TOPICS = {
  projects: "projects",
  project: (id: string) => `project:${id}`,
  messages: (id: string) => `messages:${id}`,
  versions: (id: string) => `versions:${id}`,
  settings: "settings",
  workspaces: "workspaces",
  trash: "trash",
} as const

const projectUrl = (id: string) => `/api/projects/${encodeURIComponent(id)}`

export interface ProjectInput {
  name: string
  entrypoint: string
  files: ProjectFiles
  workspaceId?: string
}

export const projectsRepo = {
  list: () => api.get<ProjectSummary[]>("/api/projects"),
  get: (id: string) => api.get<Project>(projectUrl(id)),
  async create(input: ProjectInput): Promise<Project> {
    const project = await api.post<Project>("/api/projects", input)
    notifyChange(TOPICS.projects, TOPICS.workspaces)
    return project
  },
  /**
   * Saves a full snapshot of the project; with a commit message it is also recorded as a version.
   * Does not notify the project topic: the editor already has this content.
   */
  async save(project: Project, commitMessage?: string): Promise<Project> {
    const saved = await api.put<Project>(projectUrl(project.id), { name: project.name, entrypoint: project.entrypoint, files: project.files, commitMessage })
    notifyChange(TOPICS.projects, ...(commitMessage ? [TOPICS.versions(project.id)] : []))
    return saved
  },
  async rename(id: string, name: string): Promise<void> {
    await api.put<Project>(projectUrl(id), { name })
    notifyChange(TOPICS.projects, TOPICS.project(id))
  },
  async remove(id: string): Promise<void> {
    await api.delete<null>(projectUrl(id))
    notifyChange(TOPICS.projects, TOPICS.workspaces, TOPICS.trash)
  },
  async move(id: string, workspaceId: string): Promise<void> {
    await api.post<ProjectSummary>(`${projectUrl(id)}/move`, { workspaceId })
    notifyChange(TOPICS.projects, TOPICS.workspaces, TOPICS.project(id))
  },
}

export const versionsRepo = {
  list: (projectId: string) => api.get<Version[]>(`${projectUrl(projectId)}/versions`),
  diff: (projectId: string, sha: string) => api.get<{ diff: string; truncated: boolean }>(`${projectUrl(projectId)}/versions/${encodeURIComponent(sha)}/diff`),
  async save(projectId: string, message: string): Promise<string | null> {
    const { sha } = await api.post<{ sha: string | null }>(`${projectUrl(projectId)}/versions`, { message })
    notifyChange(TOPICS.versions(projectId))
    return sha
  },
  /** Puts an old version back; the open editor reloads through the project topic. */
  async restore(projectId: string, sha: string): Promise<void> {
    await api.post<Project>(`${projectUrl(projectId)}/versions/${encodeURIComponent(sha)}/restore`)
    notifyChange(TOPICS.versions(projectId), TOPICS.project(projectId), TOPICS.projects)
  },
}

const workspaceUrl = (id: string) => `/api/workspaces/${encodeURIComponent(id)}`

export const workspacesRepo = {
  list: () => api.get<Workspace[]>("/api/workspaces"),
  async create(name: string): Promise<Workspace> {
    const workspace = await api.post<Workspace>("/api/workspaces", { name })
    notifyChange(TOPICS.workspaces)
    return workspace
  },
  async rename(id: string, name: string): Promise<void> {
    await api.patch<null>(workspaceUrl(id), { name })
    notifyChange(TOPICS.workspaces)
  },
  async remove(id: string): Promise<void> {
    await api.delete<null>(workspaceUrl(id))
    notifyChange(TOPICS.workspaces)
  },
}

const trashUrl = (entryId: string) => `/api/trash/${encodeURIComponent(entryId)}`

export const trashRepo = {
  list: () => api.get<TrashEntry[]>("/api/trash"),
  async restore(entryId: string): Promise<ProjectSummary> {
    const project = await api.post<ProjectSummary>(`${trashUrl(entryId)}/restore`)
    notifyChange(TOPICS.trash, TOPICS.projects, TOPICS.workspaces)
    return project
  },
  async purge(entryId: string): Promise<void> {
    await api.delete<null>(trashUrl(entryId))
    notifyChange(TOPICS.trash)
  },
  async empty(): Promise<void> {
    await api.delete<{ purged: number }>("/api/trash")
    notifyChange(TOPICS.trash)
  },
}

export interface MessagePatch {
  appliedFiles?: string[]
  /** null removes the undo snapshot. */
  previousFiles?: ProjectFiles | null
}

export const messagesRepo = {
  list: (projectId: string) => api.get<ChatMessage[]>(`${projectUrl(projectId)}/messages`),
  async add(message: ChatMessage): Promise<void> {
    const { projectId, ...body } = message
    await api.post<ChatMessage>(`${projectUrl(projectId)}/messages`, body)
    notifyChange(TOPICS.messages(projectId))
  },
  async update(projectId: string, messageId: string, patch: MessagePatch): Promise<void> {
    await api.patch<ChatMessage>(`${projectUrl(projectId)}/messages/${encodeURIComponent(messageId)}`, patch)
    notifyChange(TOPICS.messages(projectId))
  },
  async clear(projectId: string): Promise<void> {
    await api.delete<null>(`${projectUrl(projectId)}/messages`)
    notifyChange(TOPICS.messages(projectId))
  },
}

/** apiKey on the wire: null keeps the stored key, "" removes it, text replaces it. */
function toWireConnection({ hasApiKey: _has, clearApiKey, apiKey, ...rest }: Connection) {
  return { ...rest, apiKey: clearApiKey ? "" : apiKey.trim() ? apiKey.trim() : null }
}

export const settingsRepo = {
  read: () => api.get<AiSettings>("/api/settings"),
  async write(settings: AiSettings): Promise<AiSettings> {
    const saved = await api.put<AiSettings>("/api/settings", { ...settings, connections: settings.connections.map(toWireConnection) })
    notifyChange(TOPICS.settings)
    return saved
  },
}
