import { STORAGE_KEYS } from "./storage-keys"
import Dexie, { type EntityTable } from "dexie"
import { api } from "./api"
import type { AiSettings, ChatMessage, Project } from "./types"

/**
 * Before Phase 1 all data lived in the browser's IndexedDB. This module only exists
 * to move that data to the server once; the IndexedDB copy is left untouched as a backup.
 */
const LEGACY_DB_NAME = "circuit-design-studio"
const MIGRATED_KEY = STORAGE_KEYS.migratedToServer
const ACTIVE_KEY = STORAGE_KEYS.activeProject

interface SettingRow {
  key: string
  value: unknown
}

class LegacyDatabase extends Dexie {
  projects!: EntityTable<Project, "id">
  messages!: EntityTable<ChatMessage, "id">
  settings!: EntityTable<SettingRow, "key">

  constructor() {
    super(LEGACY_DB_NAME)
    this.version(1).stores({ projects: "id, updatedAt", messages: "id, projectId, createdAt", settings: "key" })
  }
}

export interface MigrationResult {
  imported: number
  skipped: { name: string; error: string }[]
  settingsImported: boolean
}

interface ServerResult {
  imported: { name: string; id: string }[]
  skipped: { name: string; error: string }[]
  settingsImported: boolean
}

function storage(): Storage | null {
  try {
    return localStorage
  } catch {
    return null
  }
}

let inFlight: Promise<MigrationResult | null> | null = null

/** Uploads browser-only projects, chats and AI settings to the server (once per browser). */
export function migrateBrowserData(): Promise<MigrationResult | null> {
  // React StrictMode runs effects twice; never upload the same data twice.
  inFlight ??= runMigration().finally(() => {
    inFlight = null
  })
  return inFlight
}

async function runMigration(): Promise<MigrationResult | null> {
  const local = storage()
  if (local?.getItem(MIGRATED_KEY) === "1") return null
  if (!(await Dexie.exists(LEGACY_DB_NAME))) {
    local?.setItem(MIGRATED_KEY, "1")
    return null
  }
  const db = new LegacyDatabase()
  try {
    const projects = await db.projects.orderBy("updatedAt").toArray()
    const settingsRow = await db.settings.get("ai")
    if (projects.length === 0 && !settingsRow) {
      local?.setItem(MIGRATED_KEY, "1")
      return null
    }
    const items = await Promise.all(
      projects.map(async (project) => ({
        name: project.name,
        entrypoint: project.entrypoint,
        files: project.files,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        messages: (await db.messages.where("projectId").equals(project.id).sortBy("createdAt")).map(({ projectId: _p, ...m }) => m),
      })),
    )
    const settings = settingsRow?.value as AiSettings | undefined
    const result = await api.post<ServerResult>("/api/migrate/browser", {
      projects: items,
      settings: settings
        ? { ...settings, connections: settings.connections.map(({ hasApiKey: _h, clearApiKey: _c, ...c }) => ({ ...c, apiKey: c.apiKey || null })) }
        : null,
    })
    // Keep the same project open: map the old browser id to its new server id.
    const activeIndex = projects.findIndex((p) => p.id === local?.getItem(ACTIVE_KEY))
    const activeName = activeIndex >= 0 ? projects[activeIndex].name : undefined
    const newActive = result.imported.find((p) => p.name === activeName) ?? result.imported.at(-1)
    if (newActive) local?.setItem(ACTIVE_KEY, newActive.id)
    local?.setItem(MIGRATED_KEY, "1")
    return { imported: result.imported.length, skipped: result.skipped, settingsImported: result.settingsImported }
  } finally {
    db.close()
  }
}
