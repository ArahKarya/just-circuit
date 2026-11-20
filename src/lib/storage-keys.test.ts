import { describe, expect, it } from "vitest"
import { migrateStorageKeys, STORAGE_KEYS } from "./storage-keys"

function memoryStorage(initial: Record<string, string>) {
  const data = new Map(Object.entries(initial))
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) }
}

describe("storage keys", () => {
  it("moves values saved under the old CDS names, without overwriting new ones", () => {
    const storage = memoryStorage({ "cds.migratedToServer": "1", "cds.activeProjectId": "old", [STORAGE_KEYS.activeProject]: "new", "cds.theme": "light" })
    migrateStorageKeys(storage)
    expect(Object.fromEntries(storage.data)).toEqual({ [STORAGE_KEYS.migratedToServer]: "1", [STORAGE_KEYS.activeProject]: "new", [STORAGE_KEYS.theme]: "light" })
  })
})
