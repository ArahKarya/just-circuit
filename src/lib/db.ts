import Dexie, { type EntityTable } from "dexie"
import type { AiSettings, ChatMessage, Project } from "./types"

interface SettingRow {
  key: string
  value: unknown
}

/** All app data lives in the browser's IndexedDB. */
class CdsDatabase extends Dexie {
  projects!: EntityTable<Project, "id">
  messages!: EntityTable<ChatMessage, "id">
  settings!: EntityTable<SettingRow, "key">

  constructor() {
    super("circuit-design-studio")
    this.version(1).stores({
      projects: "id, updatedAt",
      messages: "id, projectId, createdAt",
      settings: "key",
    })
  }
}

export const db = new CdsDatabase()

export const AI_SETTINGS_KEY = "ai"

export async function readAiSettings(): Promise<AiSettings | undefined> {
  const row = await db.settings.get(AI_SETTINGS_KEY)
  return row?.value as AiSettings | undefined
}

export async function writeAiSettings(settings: AiSettings): Promise<void> {
  await db.settings.put({ key: AI_SETTINGS_KEY, value: settings })
}
