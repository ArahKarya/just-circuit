import { useEffect, useState } from "react"
import { useLiveData } from "../lib/live-data"
import { resolveTheme, withDefaults } from "../lib/preferences"
import { preferencesRepo, TOPICS } from "../lib/repo"
import type { Preferences } from "../lib/types"

const DARK_QUERY = "(prefers-color-scheme: dark)"
const THEME_CACHE_KEY = "cds.theme"

function prefersDark(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(DARK_QUERY).matches
}

export interface PreferencesState {
  preferences: Preferences
  /** The theme actually shown ("system" resolved). */
  theme: "dark" | "light"
}

/** Server-stored preferences; also applies the theme to <html data-theme>. */
export function usePreferences(): PreferencesState {
  const stored = useLiveData(preferencesRepo.read, [TOPICS.preferences])
  const preferences = withDefaults(stored.data)
  const [systemDark, setSystemDark] = useState(prefersDark)

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return
    const query = window.matchMedia(DARK_QUERY)
    const onChange = () => setSystemDark(query.matches)
    query.addEventListener("change", onChange)
    return () => query.removeEventListener("change", onChange)
  }, [])

  const theme = resolveTheme(preferences.theme, systemDark)
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      // Read by index.html before React loads, so a light theme doesn't flash dark.
      localStorage.setItem(THEME_CACHE_KEY, theme)
    } catch {
      // Only a convenience.
    }
  }, [theme])

  return { preferences, theme }
}
