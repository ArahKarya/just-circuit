import type { Preferences, ThemeSetting } from "./types"

export const DEFAULT_PREFERENCES: Preferences = {
  theme: "dark",
  editor: { fontSize: 13, tabSize: 2, wordWrap: true, minimap: false, lineNumbers: true },
  preview: { debounceMs: 700, defaultTab: "pcb" },
}

/** Fills in fields missing from older saved preferences. */
export function withDefaults(stored: Partial<Preferences> | undefined): Preferences {
  return {
    theme: stored?.theme ?? DEFAULT_PREFERENCES.theme,
    editor: { ...DEFAULT_PREFERENCES.editor, ...stored?.editor },
    preview: { ...DEFAULT_PREFERENCES.preview, ...stored?.preview },
  }
}

export function resolveTheme(theme: ThemeSetting, prefersDark: boolean): "dark" | "light" {
  return theme === "system" ? (prefersDark ? "dark" : "light") : theme
}
