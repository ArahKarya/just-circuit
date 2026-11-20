import type { ManualEditEvent } from "@tscircuit/core"
import { ImportComponentDialog2, type JlcpcbComponentTsxLoadedPayload } from "@tscircuit/runframe/runner"
import {
  AlertTriangle,
  BookOpen,
  ChevronDown,
  CircuitBoard,
  Code2,
  FolderOpen,
  History,
  ListChecks,
  LogOut,
  MessageSquare,
  Move,
  PackageSearch,
  Settings,
  TerminalSquare,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react"
// runframe already renders a <Toaster /> from the same react-hot-toast store.
import toast from "react-hot-toast"
import { skippedLabel, type BuildScope } from "../shared/build-scope"
import { partFilePath, type CatalogPart, type KicadModPart } from "../shared/parts"
import { BuildScopeControls } from "./components/BuildScopeControls"
import { ChatPanel, type ChatDraftRequest } from "./components/ChatPanel"
import { CodeEditor } from "./components/CodeEditor"
import { LayoutEditor } from "./components/LayoutEditor"
import { LoginScreen } from "./components/LoginScreen"
import { PreviewPane } from "./components/PreviewPane"
import { ProblemsPanel } from "./components/ProblemsPanel"
import { HistoryDialog } from "./components/history/HistoryDialog"
import { LibraryDialog } from "./components/library/LibraryDialog"
import { SaveToLibraryDialog } from "./components/library/SaveToLibraryDialog"
import { PartSearchDialog } from "./components/parts/PartSearchDialog"
import { ProjectsDialog } from "./components/projects/ProjectsDialog"
import { SettingsDialog } from "./components/settings/SettingsDialog"
import { TerminalPanel } from "./components/terminal/TerminalPanel"
import { Button, IconButton } from "./components/ui"
import { useAiSettings } from "./hooks/useAiSettings"
import { useAuth } from "./hooks/useAuth"
import { useBrowserMigration } from "./hooks/useBrowserMigration"
import { useChat } from "./hooks/useChat"
import { useFileActions } from "./hooks/useFileActions"
import { usePreferences } from "./hooks/usePreferences"
import { useProjects } from "./hooks/useProjects"
import { useWorkingProject } from "./hooks/useWorkingProject"
import { applyLayoutMove, type LayoutMoveOutcome } from "./lib/apply-layout-move"
import { buildIssues, extractIssues, locateComponent, mergeRunWarnings, type DesignIssue } from "./lib/drc"
import { notifyChange } from "./lib/live-data"
import { MANUAL_EDITS_FILE } from "./lib/manual-edits"
import { pinNamesRequest } from "./lib/parts"
import { addComponentFile, addImportedComponent, withFiles } from "./lib/project-ops"
import { chatConnection, connectionProblem } from "./lib/providers"
import { projectsRepo, TOPICS } from "./lib/repo"
import { buildFixRequest } from "./lib/system-prompt"
import type { AttachmentRef, RunStatus } from "./lib/types"

type LeftTab = "chat" | "code" | "problems"
type DialogName = "settings" | "projects" | "import" | "parts" | "history" | "library" | null

const MIN_PANEL_WIDTH = 340
const DEFAULT_CHAT_WIDTH = 450
const DEFAULT_CODE_WIDTH = 620

const STATUS_STYLES: Record<RunStatus["state"], { label: string; pill: string; dot: string }> = {
  idle: {
    label: "Siap",
    pill: "border-line bg-surface/70 text-muted hover:text-ink",
    dot: "bg-muted/70",
  },
  running: {
    label: "Membangun…",
    pill: "border-warn/35 bg-warn/10 text-warn",
    dot: "bg-warn animate-pulse",
  },
  ok: {
    label: "Build OK",
    pill: "border-accent/30 bg-accent/10 text-accent hover:bg-accent/15",
    dot: "bg-accent",
  },
  error: {
    label: "Build error",
    pill: "border-danger/40 bg-danger/10 text-danger hover:bg-danger/15",
    dot: "bg-danger",
  },
}

/** Root: login (when the server requires it), then the studio. */
export function App() {
  const auth = useAuth()
  if (auth.error && !auth.status) return <CenteredMessage tone="error">Server Just Circuit tidak bisa dihubungi: {auth.error}</CenteredMessage>
  if (!auth.status) return <CenteredMessage>Menghubungkan ke server…</CenteredMessage>
  if (!auth.status.authenticated) return <LoginScreen onLogin={auth.login} />
  return <Studio onLogout={auth.status.authRequired ? () => void auth.logout() : undefined} />
}

function CenteredMessage({ children, tone }: { children: ReactNode; tone?: "error" }) {
  return (
    <div className="flex h-full items-center justify-center bg-surface p-6 text-center">
      <div className={`max-w-md rounded-xl border px-5 py-4 text-sm ${tone === "error" ? "border-danger/35 bg-danger/10 text-danger" : "border-line bg-panel text-muted"}`}>
        {children}
      </div>
    </div>
  )
}

function Studio({ onLogout }: { onLogout?: () => void }) {
  const migration = useBrowserMigration(true)
  const projects = useProjects(migration.ready)
  const working = useWorkingProject(projects.active, projects.save)
  const ai = useAiSettings()
  const { preferences, theme } = usePreferences()
  const [leftTab, setLeftTab] = useState<LeftTab>("chat")
  const [customWidth, setCustomWidth] = useState<number | null>(null)
  const [isResizing, setIsResizing] = useState(false)
  const [dialog, setDialog] = useState<DialogName>(null)
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [runStatus, setRunStatus] = useState<RunStatus>({ state: "idle", errors: [], warnings: [], revision: "" })
  const [rendered, setRendered] = useState<{ json: unknown[]; revision: string } | null>(null)
  const [revealRequest, setRevealRequest] = useState<{ path: string; line: number; column: number; nonce: number } | null>(null)
  const handleCircuitJson = useCallback((json: unknown[], revision: string) => setRendered({ json, revision }), [])
  const [isLayoutMode, setIsLayoutMode] = useState(false)
  const [showTerminal, setShowTerminal] = useState(false)
  /** A command the agent proposed and the user chose to run. */
  const [terminalCommand, setTerminalCommand] = useState<{ text: string; nonce: number } | null>(null)
  const clearTerminalCommand = useCallback(() => setTerminalCommand(null), [])
  /** File or folder being saved to the library. */
  const [libraryPath, setLibraryPath] = useState<string | null>(null)
  const leftPaneRef = useRef<HTMLElement>(null)

  // Ctrl+` (like VS Code) opens and closes the terminal.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key === "`") {
        event.preventDefault()
        setShowTerminal((open) => !open)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const startResize = useCallback((event: ReactPointerEvent) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = leftPaneRef.current?.getBoundingClientRect().width ?? (leftTab === "code" ? DEFAULT_CODE_WIDTH : DEFAULT_CHAT_WIDTH)
    setIsResizing(true)
    const move = (e: PointerEvent) => {
      const max = Math.max(MIN_PANEL_WIDTH + 100, window.innerWidth * 0.72)
      setCustomWidth(Math.round(Math.max(MIN_PANEL_WIDTH, Math.min(max, startWidth + (e.clientX - startX)))))
    }
    const up = () => {
      setIsResizing(false)
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }, [leftTab])

  /** Circuit shown in the layout editor, fixed while it is open. */
  const layoutCircuit = useRef<unknown[]>([])
  const project = working.project

  // The chat reads the latest problems when it sends (they are computed further down).
  const problemsRef = useRef<readonly DesignIssue[]>([])
  const getProblems = useCallback(() => problemsRef.current, [])
  const chat = useChat({ project, runStatus, onApplyProject: working.apply, flush: working.flush, getProblems })
  const fileActions = useFileActions(project, working, activeFile ?? undefined, setActiveFile)
  const connection = chatConnection(ai.settings, project?.settings)
  const problem = connectionProblem(connection)
  const currentFile = project && activeFile && project.files[activeFile] !== undefined ? activeFile : project?.entrypoint

  const closeDialog = useCallback(() => setDialog(null), [])
  const [chatDraft, setChatDraft] = useState<ChatDraftRequest | null>(null)

  const addPart = useCallback(
    async (part: CatalogPart) => {
      const current = working.project
      if (!current) return
      const path = partFilePath(part.componentName)
      if (current.files[path] !== undefined) throw new Error(`${path} sudah ada di proyek`)
      const added = addComponentFile(current, path, part.tsx)
      await working.apply(added.project, `Tambah part ${part.mpn}`)
      setLeftTab("code")
      setActiveFile(path)
      toast.success(`${part.mpn} ditambahkan (${part.pinCount} pin). Pakai <${part.componentName} name="U…" /> di rangkaianmu.`)
    },
    [working],
  )

  const askAiWithDraft = useCallback((text: string, attachments: AttachmentRef[]) => {
    setChatDraft({ text, attachments, nonce: Date.now() })
    setLeftTab("chat")
  }, [])

  const addKicadMod = useCallback(
    async (part: KicadModPart, partName: string) => {
      const current = working.project
      if (!current) return
      const taken = Object.keys(part.files).find((path) => current.files[path] !== undefined)
      if (taken) throw new Error(`${taken} sudah ada di proyek; isi nomor part lain`)
      const { [part.tsxPath]: tsx, ...rest } = part.files
      const added = addComponentFile(withFiles(current, rest), part.tsxPath, tsx)
      await working.apply(added.project, `Tambah footprint KiCad ${part.footprintName}`)
      toast.success(`${part.componentName} ditambahkan (${part.padCount} pad). Nama pin masih P1, P2, …; permintaan untuk AI sudah ada di chat.`)
      // The pin names come from the datasheet: prepare the request, the user attaches the PDF and sends.
      askAiWithDraft(pinNamesRequest(part, partName), [])
    },
    [working, askAiWithDraft],
  )

  const handleImport = useCallback(
    async ({ result, tsx }: JlcpcbComponentTsxLoadedPayload) => {
      if (!project) return
      const imported = addImportedComponent(project, result.component.partNumber, tsx)
      await working.apply(imported.project, `Impor part ${result.component.partNumber}`)
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

  // A rendered circuit belongs to one project; forget it when switching.
  const projectId = project?.id
  useEffect(() => {
    setRendered(null)
    setIsLayoutMode(false)
  }, [projectId])

  // A circuit only counts for the code it was rendered from (a failed build leaves an older one behind).
  const circuitJson = rendered && rendered.revision === runStatus.revision ? rendered.json : null
  const canEditLayout = circuitJson !== null && runStatus.state === "ok"
  const issues = useMemo<DesignIssue[]>(() => {
    if (runStatus.state === "running" || runStatus.state === "idle") return []
    const base = circuitJson ? extractIssues(circuitJson) : buildIssues(runStatus.errors)
    return mergeRunWarnings(base, runStatus.warnings)
  }, [circuitJson, runStatus])
  const errorCount = issues.filter((i) => i.severity === "error").length
  problemsRef.current = issues

  const schematicDisabled = project?.settings?.schematicDisabled ?? false
  const routingDisabled = project?.settings?.routingDisabled ?? false
  const scope = useMemo<BuildScope>(() => ({ schematicDisabled, routingDisabled }), [schematicDisabled, routingDisabled])
  const toggleScope = useCallback(
    (key: keyof BuildScope) => {
      const current = working.project
      if (!current) return
      // Save typing first, so the server copy (which carries the new settings) matches the editor.
      void working
        .flush()
        .then(() => projectsRepo.updateSettings(current.id, { ...current.settings, [key]: !current.settings?.[key] }))
        .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Gagal menyimpan pengaturan build"))
    },
    [working],
  )

  const revealComponent = useCallback(
    (name: string): boolean => {
      const current = working.project
      if (!current) return false
      const location = locateComponent(current.files, current.entrypoint, name)
      if (!location) return false
      setLeftTab("code")
      setRevealRequest({ ...location, nonce: Date.now() })
      return true
    },
    [working.project],
  )

  const askAiToFix = useCallback(
    (selected: DesignIssue[]) => {
      setLeftTab("chat")
      const lines = selected.map((e) => `${e.message}${e.components.length ? ` [${e.components.join(", ")}]` : ""}`)
      const kind = selected.every((e) => e.severity === "warning") ? "warning" : "error"
      void chat.send(buildFixRequest(lines, kind))
    },
    [chat],
  )

  const openLayoutEditor = useCallback(() => {
    if (!project || !circuitJson) return
    layoutCircuit.current = circuitJson
    setIsLayoutMode(true)
  }, [project, circuitJson])

  const handleLayoutMove = useCallback(
    (event: ManualEditEvent, snapshot: unknown[]) => {
      let outcome: LayoutMoveOutcome | null = null
      working
        .update((current) => {
          const result = applyLayoutMove(current, event, snapshot)
          outcome = result.outcome
          return result.project
        })
        .then(() => {
          const result = outcome as LayoutMoveOutcome | null
          if (result?.kind === "unsupported") {
            toast.error(`${result.name}: pcbX/pcbY di ${result.path} berupa rumus, ubah manual di kode.`)
          } else if (result?.kind === "manual-edits" && !result.wired) {
            toast.error(`Posisi disimpan di ${MANUAL_EDITS_FILE}, tapi file utama tidak punya <board>. Tambahkan manualEdits ke board-mu.`)
          }
        })
        .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Gagal menyimpan posisi"))
    },
    [working],
  )

  const status = STATUS_STYLES[runStatus.state]
  const skipped = skippedLabel(scope)
  const statusLabel = runStatus.state === "ok" && skipped ? `${status.label} (${skipped})` : status.label
  const files = useMemo(() => project?.files ?? {}, [project?.files])
  const panelWidth = customWidth ?? (leftTab === "code" ? DEFAULT_CODE_WIDTH : DEFAULT_CHAT_WIDTH)

  if (!project) {
    const error = migration.error ?? projects.error?.message
    if (error) return <CenteredMessage tone="error">Gagal memuat proyek: {error}</CenteredMessage>
    return <CenteredMessage>Memuat proyek…</CenteredMessage>
  }

  return (
    <div className="flex h-full flex-col bg-surface">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-panel px-3">
        {/* Brand & Project switcher */}
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex shrink-0 items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg border border-accent/25 bg-accent/12 text-accent">
              <CircuitBoard size={16} />
            </span>
            <span className="hidden text-sm font-semibold tracking-tight text-ink sm:inline">Just Circuit</span>
          </div>
          <span className="text-line">/</span>
          <button
            type="button"
            onClick={() => setDialog("projects")}
            className="flex min-w-0 max-w-[14rem] items-center gap-1.5 rounded-lg border border-transparent bg-surface/60 px-2.5 py-1 text-sm font-medium text-ink transition hover:border-line hover:bg-raised"
          >
            <FolderOpen size={14} className="shrink-0 text-muted" />
            <span className="truncate">{project.name}</span>
            <ChevronDown size={13} className="shrink-0 text-muted" />
          </button>
        </div>

        <span className="hidden h-5 w-px bg-line md:inline-block" aria-hidden="true" />

        {/* Build status & scope */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setLeftTab("problems")}
            className={`inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition ${status.pill}`}
            title={runStatus.errors.join("\n") || "Lihat masalah DRC/ERC"}
          >
            <span className={`size-1.5 shrink-0 rounded-full ${status.dot}`} />
            <span className="whitespace-nowrap">{statusLabel}</span>
          </button>
          <BuildScopeControls scope={scope} isRunning={runStatus.state === "running"} onToggle={toggleScope} />
          {runStatus.warnings.length > 0 && (
            <button
              type="button"
              onClick={() => setLeftTab("problems")}
              className="inline-flex h-7 items-center gap-1 rounded-lg border border-warn/30 bg-warn/10 px-2 text-xs font-medium text-warn tabular-nums transition hover:bg-warn/20"
              title={runStatus.warnings.join("\n\n")}
            >
              <AlertTriangle size={12} />
              {runStatus.warnings.length} peringatan
            </button>
          )}
        </div>

        {/* Right toolbar */}
        <div className="ml-auto flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            aria-label="Atur posisi"
            onClick={openLayoutEditor}
            disabled={!canEditLayout || isLayoutMode}
            title={canEditLayout ? "Seret komponen di PCB" : "Butuh build yang berhasil"}
          >
            <Move size={14} />
            <span className="hidden xl:inline">Atur posisi</span>
          </Button>
          <Button
            size="sm"
            variant={showTerminal ? "primary" : "ghost"}
            aria-label="Terminal"
            onClick={() => setShowTerminal((open) => !open)}
            aria-pressed={showTerminal}
            title="Terminal (Ctrl+`)"
          >
            <TerminalSquare size={14} />
            <span className="hidden xl:inline">Terminal</span>
          </Button>

          <span className="mx-0.5 hidden h-5 w-px bg-line sm:inline-block" aria-hidden="true" />

          <Button size="sm" variant="subtle" aria-label="Riwayat" onClick={() => setDialog("history")}>
            <History size={14} />
            <span className="hidden xl:inline">Riwayat</span>
          </Button>
          <Button size="sm" variant="subtle" aria-label="Library" onClick={() => setDialog("library")}>
            <BookOpen size={14} />
            <span className="hidden xl:inline">Library</span>
          </Button>
          <Button size="sm" variant="ghost" aria-label="Cari part" onClick={() => setDialog("parts")}>
            <PackageSearch size={14} className="text-accent" />
            <span className="hidden xl:inline">Cari part</span>
          </Button>

          <span className="mx-0.5 h-5 w-px bg-line" aria-hidden="true" />

          <IconButton label="Pengaturan" onClick={() => setDialog("settings")}>
            <Settings size={16} />
          </IconButton>
          {onLogout && (
            <IconButton label="Keluar" onClick={onLogout}>
              <LogOut size={15} />
            </IconButton>
          )}
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <section
          ref={leftPaneRef}
          style={{ ["--panel-w" as string]: `${panelWidth}px` }}
          className="flex h-[50%] min-h-0 flex-col border-b border-line bg-panel lg:h-auto lg:w-[var(--panel-w)] lg:shrink-0 lg:border-b-0 lg:border-r"
        >
          <div className="shrink-0 border-b border-line bg-surface/40 p-1.5">
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-surface p-0.5 border border-line/70" role="tablist">
              {([
                ["chat", "Chat AI", MessageSquare],
                ["code", "Kode", Code2],
                ["problems", "Masalah", ListChecks],
              ] as const).map(([id, label, Icon]) => {
                const active = leftTab === id
                return (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setLeftTab(id)}
                    className={`flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium transition ${
                      active
                        ? "bg-raised text-ink shadow-sm"
                        : "text-muted hover:text-ink"
                    }`}
                  >
                    <Icon size={14} className={active ? "text-accent" : ""} />
                    {label}
                    {id === "problems" && issues.length > 0 && (
                      <span
                        className={`rounded-full px-1.5 py-0.2 text-[10px] font-semibold tabular-nums ${
                          errorCount > 0 ? "bg-danger/15 text-danger" : "bg-warn/15 text-warn"
                        }`}
                      >
                        {issues.length}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="min-h-0 flex-1">
            {leftTab === "chat" ? (
              <ChatPanel
                projectId={project?.id}
                draftRequest={chatDraft}
                onDraftRequestHandled={() => setChatDraft(null)}
                chat={chat}
                connection={connection}
                connectionProblem={problem}
                onOpenSettings={() => setDialog("settings")}
                agentMode={ai.settings.agentMode ?? false}
                onToggleAgent={() =>
                  void ai
                    .save({ ...ai.settings, agentMode: !ai.settings.agentMode })
                    .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Gagal menyimpan"))
                }
                onRunCommand={(text) => {
                  setShowTerminal(true)
                  setTerminalCommand({ text, nonce: Date.now() })
                }}
              />
            ) : leftTab === "problems" ? (
              <ProblemsPanel
                issues={issues}
                isBuilding={runStatus.state === "running"}
                onRevealComponent={revealComponent}
                onAskAiToFix={askAiToFix}
                canAskAi={!chat.isBusy && !problem}
              />
            ) : (
              <CodeEditor
                project={project}
                activeFile={currentFile ?? project.entrypoint}
                onSelectFile={setActiveFile}
                onChange={(path, content) => working.edit(withFiles(project, { [path]: content }))}
                {...fileActions}
                onSaveToLibrary={setLibraryPath}
                editorPrefs={preferences.editor}
                theme={theme}
                revealRequest={revealRequest}
              />
            )}
          </div>
        </section>

        {/* Desktop split-pane resize handle */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Ubah lebar panel"
          title="Seret untuk mengubah lebar panel (klik ganda untuk reset)"
          onPointerDown={startResize}
          onDoubleClick={() => setCustomWidth(null)}
          className={`hidden w-1 shrink-0 cursor-col-resize transition-colors lg:block ${
            isResizing ? "bg-accent" : "bg-transparent hover:bg-accent/40"
          }`}
        />

        <section className="relative min-h-0 min-w-0 flex-1">
          {isResizing && <div className="absolute inset-0 z-30 cursor-col-resize" />}
          <PreviewPane
            files={files}
            entrypoint={project.entrypoint}
            onStatus={setRunStatus}
            onCircuitJson={handleCircuitJson}
            debounceMs={preferences.preview.debounceMs}
            defaultTab={preferences.preview.defaultTab}
            scope={scope}
          />
          {isLayoutMode && (
            <LayoutEditor circuitJson={layoutCircuit.current} onMove={handleLayoutMove} onDone={() => setIsLayoutMode(false)} />
          )}
        </section>
      </main>

      {showTerminal && (
        <TerminalPanel
          projectId={project.id}
          projectName={project.name}
          theme={theme}
          command={terminalCommand}
          onCommandDelivered={clearTerminalCommand}
          onClose={() => setShowTerminal(false)}
          onSettled={() => notifyChange(TOPICS.project(project.id), TOPICS.versions(project.id), TOPICS.projects)}
        />
      )}

      {dialog === "settings" && (
        <SettingsDialog settings={ai.settings} onSaveAi={ai.save} preferences={preferences} project={project} onClose={closeDialog} />
      )}
      {dialog === "projects" && <ProjectsDialog projects={projects} onClose={closeDialog} />}
      {dialog === "parts" && (
        <PartSearchDialog
          projectId={project.id}
          onClose={closeDialog}
          onAddPart={addPart}
          onAskAi={askAiWithDraft}
          onOpenJlcImport={() => setDialog("import")}
          onAddKicadMod={addKicadMod}
        />
      )}
      {dialog === "library" && (
        <LibraryDialog
          project={project}
          onInsert={async (next, message, file) => {
            await working.apply(next, message)
            setLeftTab("code")
            setActiveFile(file)
          }}
          onClose={closeDialog}
        />
      )}
      {libraryPath && <SaveToLibraryDialog project={project} path={libraryPath} onClose={() => setLibraryPath(null)} />}
      {dialog === "history" && <HistoryDialog projectId={project.id} flush={working.flush} onClose={closeDialog} />}
      <ImportComponentDialog2
        isOpen={dialog === "import"}
        onClose={closeDialog}
        jlcpcbProxyApiBase="/api/jlc"
        onJlcpcbComponentTsxLoaded={handleImport}
      />
    </div>
  )
}
