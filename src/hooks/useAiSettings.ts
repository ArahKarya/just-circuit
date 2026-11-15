import { useLiveQuery } from "dexie-react-hooks"
import { useCallback } from "react"
import { readAiSettings, writeAiSettings } from "../lib/db"
import { DEFAULT_AI_SETTINGS } from "../lib/providers"
import type { AiSettings } from "../lib/types"

export interface AiSettingsState {
  settings: AiSettings
  isLoaded: boolean
  save: (next: AiSettings) => Promise<void>
}

export function useAiSettings(): AiSettingsState {
  const stored = useLiveQuery(readAiSettings, [], null)
  const save = useCallback((next: AiSettings) => writeAiSettings(next), [])
  return {
    settings: stored ? { ...DEFAULT_AI_SETTINGS, ...stored } : DEFAULT_AI_SETTINGS,
    isLoaded: stored !== null,
    save,
  }
}
