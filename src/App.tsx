import { ImportComponentDialog2, type JlcpcbComponentTsxLoadedPayload } from "@tscircuit/runframe/runner"
import { CircuitBoard, Code2, FolderOpen, MessageSquare, PackagePlus, Settings } from "lucide-react"
import { useCallback, useMemo, useState } from "react"
// runframe already renders a <Toaster /> from the same react-hot-toast store.
import toast from "react-hot-toast"
import { ChatPanel } from "./components/ChatPanel"
import { CodeEditor } from "./components/CodeEditor"
import { PreviewPane } from "./components/PreviewPane"
import { ProjectsDialog } from "./components/ProjectsDialog"
import { SettingsDialog } from "./components/SettingsDialog"
import { Button, IconButton } from "./components/ui"
import { useAiSettings } from "./hooks/useAiSettings"
import { useChat } from "./hooks/useChat"
import { useProjects } from "./hooks/useProjects"
import { useWorkingProject } from "./hooks/useWorkingProject"
import { addImportedComponent, withFiles, withoutFile } from "./lib/project-ops"
import { activeConnection, connectionProblem } from "./lib/providers"
import type { RunStatus } from "./lib/types"

type LeftTab = "chat" | "code"
type DialogName = "settings" | "projects" | "import" | null

const STATUS_STYLES: Record<RunStatus["state"], { label: string; className: string }> = {
  idle: { label: "Siap", className: "text-muted" },
  running: { label: "Membangun…", className: "text-amber-300" },
  ok: { label: "Build OK", className: "text-accent" },
  error: { label: "Build error", className: "text-danger" },
}

export function App() {
  const projects = useProjects()
  const working = useWorkingProject(projects.active, projects.save)
  const ai = useAiSettings()
  const [leftTab, setLeftTab] = useState<LeftTab>("chat")
  const [dialog, setDialog] = useState<DialogName>(null)
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [runStatus, setRunStatus] = useState<RunStatus>({ state: "idle", errors: [], revision: "" })
  const project = working.project

  const chat = useChat({ project, runStatus, onApplyProject: working.apply })
  const connection = activeConnection(ai.settings)
  const problem = connectionProblem(connection)
  const currentFile = project && activeFile && project.files[activeFile] !== undefined ? activeFile : project?.entrypoint

  const closeDialog = useCallback(() => setDialog(null), [])

  const handleImport = useCallback(
    async ({ result, tsx }: JlcpcbComponentTsxLoadedPayload) => {
      if (!project) return
      const imported = addImportedComponent(project, result.component.partNumber, tsx)
      await working.apply(imported.project)
      setDialog(null)
      setLeftTab("code")
      setActiveFile(project.entrypoint)
      toast.success(
        imported.componentName
          ? `${result.component.partNumber} diimpor sebagai <${imported.componentName} />`
          : `${result.component.partNumber} ditambahkan ke ${imported.filePath}`,
      )
    },
    [project, working],
  )

  const status = STATUS_STYLES[runStatus.state]
  const files = useMemo(() => project?.files ?? {}, [project?.files])

  if (!project) {
    return <div className="flex h-full items-center justify-center text-sm text-muted">Memuat proyek…</div>
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-panel px-3">
        <CircuitBoard size={20} className="text-accent" />
        <span className="hidden text-sm font-semibold sm:inline">Circuit Design Studio</span>
        <span className="text-line">/</span>
        <button type="button" onClick={() => setDialog("projects")} className="flex min-w-0 items-center gap-1.5 rounded px-2 py-1 text-sm hover:bg-raised">
          <FolderOpen size={15} className="text-muted" />
          <span className="truncate">{project.name}</span>
        </button>
        <span className={`ml-2 text-xs ${status.className}`} title={runStatus.errors.join("\n")}>{status.label}</span>
        <div className="ml-auto flex items-center gap-1">
          <Button onClick={() => setDialog("import")}><PackagePlus size={15} />Impor part JLCPCB</Button>
          <IconButton label="Pengaturan AI" onClick={() => setDialog("settings")}><Settings size={17} /></IconButton>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <section className="flex h-[50%] min-h-0 flex-col border-line bg-panel lg:h-auto lg:w-[440px] lg:shrink-0 lg:border-r">
          <div className="flex shrink-0 gap-1 border-b border-line p-1.5" role="tablist">
            {([["chat", "Chat AI", MessageSquare], ["code", "Kode", Code2]] as const).map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={leftTab === id}
                onClick={() => setLeftTab(id)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-sm ${leftTab === id ? "bg-raised text-ink" : "text-muted hover:text-ink"}`}
              >
                <Icon size={15} />
                {label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1">
            {leftTab === "chat" ? (
              <ChatPanel chat={chat} connection={connection} connectionProblem={problem} onOpenSettings={() => setDialog("settings")} />
            ) : (
              <CodeEditor
                project={project}
                activeFile={currentFile ?? project.entrypoint}
                onSelectFile={setActiveFile}
                onChange={(path, content) => working.edit(withFiles(project, { [path]: content }))}
                onDeleteFile={(path) => void working.apply(withoutFile(project, path))}
              />
            )}
          </div>
        </section>
        <section className="min-h-0 flex-1">
          <PreviewPane files={files} entrypoint={project.entrypoint} onStatus={setRunStatus} />
        </section>
      </main>

      {dialog === "settings" && <SettingsDialog settings={ai.settings} onSave={ai.save} onClose={closeDialog} />}
      {dialog === "projects" && <ProjectsDialog projects={projects} onClose={closeDialog} />}
      <ImportComponentDialog2
        isOpen={dialog === "import"}
        onClose={closeDialog}
        jlcpcbProxyApiBase="/api/jlc"
        onJlcpcbComponentTsxLoaded={handleImport}
      />
    </div>
  )
}
