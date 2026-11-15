import Editor, { type BeforeMount } from "@monaco-editor/react"
import { FileCode2, Trash2 } from "lucide-react"
import type { Project } from "../lib/types"

interface CodeEditorProps {
  project: Project
  activeFile: string
  onSelectFile: (path: string) => void
  onChange: (path: string, content: string) => void
  onDeleteFile: (path: string) => void
}

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

export function CodeEditor({ project, activeFile, onSelectFile, onChange, onDeleteFile }: CodeEditorProps) {
  const paths = Object.keys(project.files).sort((a, b) =>
    a === project.entrypoint ? -1 : b === project.entrypoint ? 1 : a.localeCompare(b),
  )
  const content = project.files[activeFile] ?? ""

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-line px-2 py-1.5" role="tablist" aria-label="File proyek">
        {paths.map((path) => (
          <div
            key={path}
            className={`group flex shrink-0 items-center rounded-md text-xs ${path === activeFile ? "bg-raised text-ink" : "text-muted hover:text-ink"}`}
          >
            <button type="button" role="tab" aria-selected={path === activeFile} className="flex items-center gap-1.5 px-2 py-1.5 font-mono" onClick={() => onSelectFile(path)}>
              <FileCode2 size={13} />
              {path}
            </button>
            {path !== project.entrypoint && (
              <button type="button" aria-label={`Hapus ${path}`} className="pr-1.5 opacity-0 group-hover:opacity-100 hover:text-danger" onClick={() => onDeleteFile(path)}>
                <Trash2 size={12} />
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        <Editor
          path={`${project.id}/${activeFile}`}
          language="typescript"
          theme="vs-dark"
          value={content}
          beforeMount={configureMonaco}
          onChange={(value) => onChange(activeFile, value ?? "")}
          options={{
            fontSize: 13,
            fontFamily: "JetBrains Mono, Menlo, monospace",
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            tabSize: 2,
            wordWrap: "on",
            automaticLayout: true,
          }}
        />
      </div>
    </div>
  )
}
