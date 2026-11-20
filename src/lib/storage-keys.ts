/** Browser storage keys. The app was called CDS before; values saved under the old names are moved once. */
export const STORAGE_KEYS = {
  activeProject: "just-circuit.activeProjectId",
  migratedToServer: "just-circuit.migratedToServer",
  theme: "just-circuit.theme",
} as const

const LEGACY_KEYS: Record<string, string> = {
  [STORAGE_KEYS.activeProject]: "cds.activeProjectId",
  [STORAGE_KEYS.migratedToServer]: "cds.migratedToServer",
  [STORAGE_KEYS.theme]: "cds.theme",
}

/** Copies values from the old key names (keeps "already migrated" from re-importing IndexedDB data). */
export function migrateStorageKeys(storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined = globalThis.localStorage): void {
  if (!storage) return
  try {
    for (const [key, legacy] of Object.entries(LEGACY_KEYS)) {
      const old = storage.getItem(legacy)
      if (old === null) continue
      if (storage.getItem(key) === null) storage.setItem(key, old)
      storage.removeItem(legacy)
    }
  } catch {
    // Storage blocked (private mode): nothing to move.
  }
}
