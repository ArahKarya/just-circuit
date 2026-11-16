import Editor, { type BeforeMount, type OnMount } from "@monaco-editor/react"
import { FilePlus, Files, PanelLeftClose, PanelLeftOpen, Search } from "lucide-react"
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

export function CodeEditor({ project, activeFile, onSelectFile, onChange, onCreateFile, editorPrefs, theme, ...fileActions }: CodeEditorProps) {
  const [showExplorer, setShowExplorer] = useState(true)
  const [view, setView] = useState<ExplorerView>("files")
  const [newFile, setNewFile] = useState<string | null>(null)
  const [reveal, setReveal] = useState<{ path: string; line: number; column: number } | null>(null)
  const editorRef = useRef<MonacoEditor | null>(null)
  const tree = useMemo(() => buildTree(Object.keys(project.files), project.entrypoint), [project.files, project.entrypoint])
  const content = project.files[activeFile] ?? ""

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
        <aside className="flex w-48 shrink-0 flex-col border-r border-line" aria-label="Penjelajah file">
          <div className="flex shrink-0 items-center gap-0.5 border-b border-line px-1 py-1">
            <IconButton label="File" aria-pressed={view === "files"} className={`size-7 ${view === "files" ? "text-ink" : ""}`} onClick={() => setView("files")}><Files size={14} /></IconButton>
            <IconButton label="Cari di semua file" aria-pressed={view === "search"} className={`size-7 ${view === "search" ? "text-ink" : ""}`} onClick={() => setView("search")}><Search size={14} /></IconButton>
            <IconButton label="File baru" className="size-7" onClick={() => { setView("files"); setNewFile("lib/") }}><FilePlus size={14} /></IconButton>
            <IconButton label="Sembunyikan penjelajah" className="ml-auto size-7" onClick={() => setShowExplorer(false)}><PanelLeftClose size={14} /></IconButton>
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
            <div className="min-h-0 flex-1 overflow-y-auto px-1">
              {newFile !== null && (
                <form
                  className="space-y-1 py-1"
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
                    className="h-7 w-full rounded border border-accent bg-surface px-1.5 font-mono text-xs"
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
        <div className="flex h-8 shrink-0 items-center gap-1 border-b border-line px-1 text-xs text-muted">
          {!showExplorer && (
            <IconButton label="Tampilkan penjelajah" className="size-7" onClick={() => setShowExplorer(true)}><PanelLeftOpen size={14} /></IconButton>
          )}
          <span className="truncate px-1 font-mono">{activeFile}</span>
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
