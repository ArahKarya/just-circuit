import Editor, { type BeforeMount, type OnMount } from "@monaco-editor/react"
import { FileCode2, FileJson, FilePlus, Files, FileText, PanelLeftClose, PanelLeftOpen, Search, Star } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { buildTree } from "../lib/file-tree"
import type { Preferences, Project } from "../lib/types"
import { FileSearch } from "./files/FileSearch"
import { FileTree, type FileActions } from "./files/FileTree"
import { IconButton } from "./ui"

interface CodeEditorProps extends Omit<FileActions, "onOpen"> {
  project: Project
  activeFile: string
  onSelectFile: (path: string) => void
  onChange: (path: string, content: string) => void
  /** Returns false when the name is invalid (the caller shows why). */
  onCreateFile: (path: string) => boolean
  editorPrefs: Preferences["editor"]
  theme: "dark" | "light"
  /** Jump to a location from outside (problems panel); a new nonce jumps again. */
  revealRequest?: { path: string; line: number; column: number; nonce: number } | null
}

type ExplorerView = "files" | "search"
type MonacoEditor = Parameters<OnMount>[0]

const configureMonaco: BeforeMount = (monaco) => {
  const ts = monaco.languages.typescript
  ts.typescriptDefaults.setCompilerOptions({
    jsx: ts.JsxEmit.Preserve,
    target: ts.ScriptTarget.ES2020,
    allowNonTsExtensions: true,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
  })
  // tscircuit's intrinsic elements have no type definitions here, so only report syntax errors.
  ts.typescriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false })
}

function languageOf(path: string): string {
  if (path.endsWith(".json")) return "json"
  if (path.endsWith(".md")) return "markdown"
  if (path.endsWith(".txt") || path.endsWith(".csv")) return "plaintext"
  return "typescript"
}

function ActiveFileIcon({ path }: { path: string }) {
  if (path.endsWith(".json")) return <FileJson size={13} className="shrink-0 text-warn" />
  if (path.endsWith(".md") || path.endsWith(".txt") || path.endsWith(".csv")) return <FileText size={13} className="shrink-0 text-muted" />
  return <FileCode2 size={13} className="shrink-0 text-info" />
}

export function CodeEditor({
  project,
  activeFile,
  onSelectFile,
  onChange,
  onCreateFile,
  editorPrefs,
  theme,
  revealRequest,
  ...fileActions
}: CodeEditorProps) {
  const [showExplorer, setShowExplorer] = useState(true)
  const [view, setView] = useState<ExplorerView>("files")
  const [newFile, setNewFile] = useState<string | null>(null)
  const [reveal, setReveal] = useState<{ path: string; line: number; column: number } | null>(null)
  const editorRef = useRef<MonacoEditor | null>(null)
  const tree = useMemo(() => buildTree(Object.keys(project.files), project.entrypoint), [project.files, project.entrypoint])
  const content = project.files[activeFile] ?? ""

  useEffect(() => {
    if (!revealRequest) return
    setReveal({ path: revealRequest.path, line: revealRequest.line, column: revealRequest.column })
    onSelectFile(revealRequest.path)
    // Only a new request (nonce) jumps; onSelectFile is stable enough not to matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealRequest?.nonce])

  // Jump to a search hit once its file is open in the editor.
  useEffect(() => {
    const editor = editorRef.current
    if (!reveal || !editor || reveal.path !== activeFile) return
    const frame = requestAnimationFrame(() => {
      editor.revealLineInCenter(reveal.line)
      editor.setPosition({ lineNumber: reveal.line, column: reveal.column })
      editor.focus()
      setReveal(null)
    })
    return () => cancelAnimationFrame(frame)
  }, [reveal, activeFile, content])

  const submitNewFile = () => {
    if (newFile && onCreateFile(newFile)) setNewFile(null)
  }

  return (
    <div className="flex h-full min-h-0">
      {showExplorer && (
        <aside className="flex w-52 shrink-0 flex-col border-r border-line bg-surface/35" aria-label="Penjelajah file">
          <div className="flex h-9 shrink-0 items-center gap-0.5 border-b border-line px-1.5">
            <IconButton
              label="File"
              aria-pressed={view === "files"}
              className={`size-7 rounded-md ${view === "files" ? "bg-raised text-ink" : ""}`}
              onClick={() => setView("files")}
            >
              <Files size={14} />
            </IconButton>
            <IconButton
              label="Cari di semua file"
              aria-pressed={view === "search"}
              className={`size-7 rounded-md ${view === "search" ? "bg-raised text-ink" : ""}`}
              onClick={() => setView("search")}
            >
              <Search size={14} />
            </IconButton>
            <IconButton
              label="File baru"
              className="size-7 rounded-md"
              onClick={() => {
                setView("files")
                setNewFile("lib/")
              }}
            >
              <FilePlus size={14} />
            </IconButton>
            <IconButton label="Sembunyikan penjelajah" className="ml-auto size-7 rounded-md" onClick={() => setShowExplorer(false)}>
              <PanelLeftClose size={14} />
            </IconButton>
          </div>
          {view === "search" ? (
            <FileSearch
              files={project.files}
              onOpen={(path, line, column) => {
                setReveal({ path, line, column })
                onSelectFile(path)
              }}
            />
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto px-1.5">
              {newFile !== null && (
                <form
                  className="space-y-1.5 py-2"
                  onSubmit={(event) => {
                    event.preventDefault()
                    submitNewFile()
                  }}
                >
                  <input
                    autoFocus
                    aria-label="Nama file baru"
                    value={newFile}
                    onChange={(e) => setNewFile(e.target.value)}
                    onKeyDown={(e) => e.key === "Escape" && setNewFile(null)}
                    className="h-7 w-full rounded-md border border-accent bg-surface px-2 font-mono text-xs text-ink focus:outline-none focus:ring-2 focus:ring-accent/20"
                  />
                  <p className="px-0.5 text-[11px] leading-4 text-muted">Pakai / untuk folder, mis. lib/power.tsx. Enter untuk buat.</p>
                </form>
              )}
              <FileTree nodes={tree} activeFile={activeFile} entrypoint={project.entrypoint} onOpen={onSelectFile} {...fileActions} />
            </div>
          )}
        </aside>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-line bg-surface/25 px-2 text-xs text-muted">
          {!showExplorer && (
            <IconButton label="Tampilkan penjelajah" className="size-7 rounded-md" onClick={() => setShowExplorer(true)}>
              <PanelLeftOpen size={14} />
            </IconButton>
          )}
          <ActiveFileIcon path={activeFile} />
          <span className="truncate font-mono text-ink">{activeFile}</span>
          {activeFile === project.entrypoint && (
            <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border border-accent/25 bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
              <Star size={9} className="fill-accent" /> utama
            </span>
          )}
        </div>
        <div className="min-h-0 flex-1">
          <Editor
            path={`${project.id}/${activeFile}`}
            language={languageOf(activeFile)}
            theme={theme === "light" ? "vs" : "vs-dark"}
            value={content}
            beforeMount={configureMonaco}
            onMount={(editor) => {
              editorRef.current = editor
            }}
            onChange={(value) => onChange(activeFile, value ?? "")}
            options={{
              fontSize: editorPrefs.fontSize,
              fontFamily: "JetBrains Mono, Menlo, monospace",
              minimap: { enabled: editorPrefs.minimap },
              lineNumbers: editorPrefs.lineNumbers ? "on" : "off",
              scrollBeyondLastLine: false,
              tabSize: editorPrefs.tabSize,
              wordWrap: editorPrefs.wordWrap ? "on" : "off",
              automaticLayout: true,
            }}
          />
        </div>
      </div>
    </div>
  )
}
