import { Brain, Cpu, FolderCog, HardDriveDownload, Palette } from "lucide-react"
import { useEffect, useState, type ComponentType } from "react"
import { memoryRepo, preferencesRepo, projectsRepo } from "../../lib/repo"
import type { AiSettings, Preferences, Project, ProjectSettings } from "../../lib/types"
import { Button, Modal } from "../ui"
import { AiTab } from "./AiTab"
import { AppearanceTab } from "./AppearanceTab"
import { BackupTab } from "./BackupTab"
import { MemoryTab, type MemoryDraft } from "./MemoryTab"
import { ProjectTab } from "./ProjectTab"

export type SettingsTab = "ai" | "memory" | "appearance" | "project" | "backup"

interface SettingsDialogProps {
  settings: AiSettings
  onSaveAi: (next: AiSettings) => Promise<void>
  preferences: Preferences
  project: Pick<Project, "id" | "name" | "settings">
  initialTab?: SettingsTab
  onClose: () => void
}

const TABS: { id: SettingsTab; label: string; icon: ComponentType<{ size?: number; className?: string }> }[] = [
  { id: "ai", label: "AI", icon: Cpu },
  { id: "memory", label: "Memori", icon: Brain },
  { id: "appearance", label: "Tampilan & editor", icon: Palette },
  { id: "project", label: "Proyek ini", icon: FolderCog },
  { id: "backup", label: "Cadangan", icon: HardDriveDownload },
]

const changed = (a: unknown, b: unknown): boolean => JSON.stringify(a) !== JSON.stringify(b)

export function SettingsDialog({ settings, onSaveAi, preferences, project, initialTab = "ai", onClose }: SettingsDialogProps) {
  const [tab, setTab] = useState<SettingsTab>(initialTab)
  const [ai, setAi] = useState<AiSettings>(settings)
  const [prefs, setPrefs] = useState<Preferences>(preferences)
  const [projectSettings, setProjectSettings] = useState<ProjectSettings>(project.settings ?? {})
  const [memory, setMemory] = useState<MemoryDraft | null>(null)
  const [savedMemory, setSavedMemory] = useState<MemoryDraft | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([memoryRepo.readProject(project.id), memoryRepo.readGlobal()])
      .then(([projectMemory, globalMemory]) => {
        if (cancelled) return
        const loaded = { project: projectMemory, global: globalMemory }
        setMemory(loaded)
        setSavedMemory(loaded)
      })
      .catch((error: unknown) => setSaveError(error instanceof Error ? `Memori: ${error.message}` : "Gagal memuat memori"))
    return () => {
      cancelled = true
    }
  }, [project.id])
  const [saveError, setSaveError] = useState<string | null>(null)

  const save = async () => {
    setIsSaving(true)
    setSaveError(null)
    try {
      if (changed(ai, settings)) await onSaveAi(ai)
      if (changed(prefs, preferences)) await preferencesRepo.write(prefs)
      if (changed(projectSettings, project.settings ?? {})) await projectsRepo.updateSettings(project.id, projectSettings)
      if (memory && savedMemory && memory.project !== savedMemory.project) await memoryRepo.writeProject(project.id, memory.project)
      if (memory && savedMemory && memory.global !== savedMemory.global) await memoryRepo.writeGlobal(memory.global)
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
          {saveError && (
            <span role="alert" className="mr-auto text-xs text-danger">
              {saveError}
            </span>
          )}
          <Button onClick={onClose}>Batal</Button>
          <Button variant="primary" onClick={() => void save()} disabled={isSaving}>
            Simpan
          </Button>
        </>
      }
    >
      <div className="mb-5 flex gap-1 overflow-x-auto rounded-xl border border-line bg-surface/70 p-1" role="tablist" aria-label="Bagian pengaturan">
        {TABS.map(({ id, label, icon: Icon }) => {
          const active = tab === id
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                active ? "bg-raised text-ink shadow-xs" : "text-muted hover:text-ink"
              }`}
            >
              <Icon size={14} className={active ? "text-accent" : ""} />
              {label}
            </button>
          )
        })}
      </div>
      {tab === "ai" && <AiTab draft={ai} setDraft={setAi} />}
      {tab === "memory" && <MemoryTab projectName={project.name} draft={memory} setDraft={setMemory} />}
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
