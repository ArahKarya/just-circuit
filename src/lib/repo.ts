import { api } from "./api"
import type { LibraryItem, LibraryItemWithFiles } from "./library"
import { notifyChange } from "./live-data"
import type { AiSettings, ChatMessage, Connection, Preferences, Project, ProjectFiles, ProjectSettings, ProjectSummary, TrashEntry, Version, Workspace } from "./types"

export const TOPICS = {
  projects: "projects",
  project: (id: string) => `project:${id}`,
  messages: (id: string) => `messages:${id}`,
  versions: (id: string) => `versions:${id}`,
  settings: "settings",
  workspaces: "workspaces",
  preferences: "preferences",
  globalMemory: "memory:global",
  library: "library",
  projectMemory: (id: string) => `memory:${id}`,
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
    // The name is left out on purpose: it only changes through rename(), so a late autosave can't undo a rename.
    const saved = await api.put<Project>(projectUrl(project.id), { entrypoint: project.entrypoint, files: project.files, commitMessage })
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
  async updateSettings(id: string, settings: ProjectSettings): Promise<void> {
    await api.put<Project>(projectUrl(id), { settings })
    notifyChange(TOPICS.project(id))
  },
  async move(id: string, workspaceId: string): Promise<void> {
    await api.post<ProjectSummary>(`${projectUrl(id)}/move`, { workspaceId })
    notifyChange(TOPICS.projects, TOPICS.workspaces, TOPICS.project(id))
  },
}

export const libraryRepo = {
  list: () => api.get<LibraryItem[]>("/api/library"),
  get: (id: string) => api.get<LibraryItemWithFiles>(`/api/library/${encodeURIComponent(id)}`),
  async create(input: { name: string; description: string; entry: string; files: ProjectFiles }): Promise<LibraryItem> {
    const item = await api.post<LibraryItem>("/api/library", input)
    notifyChange(TOPICS.library)
    return item
  },
  async update(id: string, patch: { name?: string; description?: string }): Promise<void> {
    await api.patch(`/api/library/${encodeURIComponent(id)}`, patch)
    notifyChange(TOPICS.library)
  },
  async remove(id: string): Promise<void> {
    await api.delete(`/api/library/${encodeURIComponent(id)}`)
    notifyChange(TOPICS.library)
  },
}

export const memoryRepo = {
  readGlobal: async () => (await api.get<{ content: string }>("/api/memory")).content,
  readProject: async (projectId: string) => (await api.get<{ content: string }>(`${projectUrl(projectId)}/memory`)).content,
  async writeGlobal(content: string): Promise<void> {
    await api.put("/api/memory", { content })
    notifyChange(TOPICS.globalMemory)
  },
  async writeProject(projectId: string, content: string): Promise<void> {
    await api.put(`${projectUrl(projectId)}/memory`, { content })
    notifyChange(TOPICS.projectMemory(projectId))
  },
}

export const preferencesRepo = {
  read: () => api.get<Preferences>("/api/preferences"),
  async write(preferences: Preferences): Promise<Preferences> {
    const saved = await api.put<Preferences>("/api/preferences", preferences)
    notifyChange(TOPICS.preferences)
    return saved
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
