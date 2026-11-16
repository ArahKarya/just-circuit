import { useCallback } from "react"
import { useLiveData } from "../lib/live-data"
import { DEFAULT_AI_SETTINGS } from "../lib/providers"
import { settingsRepo, TOPICS } from "../lib/repo"
import type { AiSettings } from "../lib/types"

export interface AiSettingsState {
  settings: AiSettings
  isLoaded: boolean
  save: (next: AiSettings) => Promise<void>
}

export function useAiSettings(): AiSettingsState {
  const stored = useLiveData(settingsRepo.read, [TOPICS.settings])
  const save = useCallback(async (next: AiSettings) => {
    await settingsRepo.write(next)
  }, [])
  return {
    settings: stored.data ? { ...DEFAULT_AI_SETTINGS, ...stored.data } : DEFAULT_AI_SETTINGS,
    isLoaded: stored.data !== undefined,
    save,
  }
}
