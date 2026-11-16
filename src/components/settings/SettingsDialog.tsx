import { useState } from "react"
import { preferencesRepo, projectsRepo } from "../../lib/repo"
import type { AiSettings, Preferences, Project, ProjectSettings } from "../../lib/types"
import { Button, Modal } from "../ui"
import { AiTab } from "./AiTab"
import { AppearanceTab } from "./AppearanceTab"
import { BackupTab } from "./BackupTab"
import { ProjectTab } from "./ProjectTab"

export type SettingsTab = "ai" | "appearance" | "project" | "backup"

interface SettingsDialogProps {
  settings: AiSettings
  onSaveAi: (next: AiSettings) => Promise<void>
  preferences: Preferences
  project: Pick<Project, "id" | "name" | "settings">
  initialTab?: SettingsTab
  onClose: () => void
}

const TABS: { id: SettingsTab; label: string }[] = [
  { id: "ai", label: "AI" },
  { id: "appearance", label: "Tampilan & editor" },
  { id: "project", label: "Proyek ini" },
  { id: "backup", label: "Cadangan" },
]

const changed = (a: unknown, b: unknown): boolean => JSON.stringify(a) !== JSON.stringify(b)

export function SettingsDialog({ settings, onSaveAi, preferences, project, initialTab = "ai", onClose }: SettingsDialogProps) {
  const [tab, setTab] = useState<SettingsTab>(initialTab)
  const [ai, setAi] = useState<AiSettings>(settings)
  const [prefs, setPrefs] = useState<Preferences>(preferences)
  const [projectSettings, setProjectSettings] = useState<ProjectSettings>(project.settings ?? {})
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const save = async () => {
    setIsSaving(true)
    setSaveError(null)
    try {
      if (changed(ai, settings)) await onSaveAi(ai)
      if (changed(prefs, preferences)) await preferencesRepo.write(prefs)
      if (changed(projectSettings, project.settings ?? {})) await projectsRepo.updateSettings(project.id, projectSettings)
      onClose()
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Gagal menyimpan pengaturan")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Modal
      title="Pengaturan"
      wide
      onClose={onClose}
      footer={
        <>
          {saveError && <span role="alert" className="mr-auto text-xs text-danger">{saveError}</span>}
          <Button onClick={onClose}>Batal</Button>
          <Button variant="primary" onClick={() => void save()} disabled={isSaving}>Simpan</Button>
        </>
      }
    >
      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-line" role="tablist" aria-label="Bagian pengaturan">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm ${tab === id ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "ai" && <AiTab draft={ai} setDraft={setAi} />}
      {tab === "appearance" && <AppearanceTab draft={prefs} setDraft={setPrefs} />}
      {tab === "project" && <ProjectTab projectName={project.name} draft={projectSettings} setDraft={setProjectSettings} connections={ai.connections} />}
      {tab === "backup" && (
        <BackupTab
          ai={ai}
          preferences={prefs}
          onImport={(nextAi, nextPrefs) => {
            setAi(nextAi)
            setPrefs(nextPrefs)
          }}
        />
      )}
    </Modal>
  )
}
