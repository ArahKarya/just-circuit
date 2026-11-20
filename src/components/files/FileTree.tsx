import { BookPlus, ChevronDown, ChevronRight, FileCode2, FileJson, FileText, Folder, FolderOpen, Pencil, Star, Trash2 } from "lucide-react"
import { useState, type ReactNode } from "react"
import type { TreeNode } from "../../lib/file-tree"

export interface FileActions {
  onOpen: (path: string) => void
  onRename: (from: string, to: string) => void
  onDelete: (path: string) => void
  onSetEntrypoint: (path: string) => void
  onSaveToLibrary: (path: string) => void
}

interface FileTreeProps extends FileActions {
  nodes: TreeNode[]
  activeFile: string
  entrypoint: string
}

type Edit = { path: string; mode: "rename" | "delete"; value: string } | null

function fileIcon(name: string): ReactNode {
  if (name.endsWith(".json")) return <FileJson size={13} className="shrink-0 text-warn" />
  if (name.endsWith(".md") || name.endsWith(".txt") || name.endsWith(".csv")) return <FileText size={13} className="shrink-0 text-muted" />
  return <FileCode2 size={13} className="shrink-0 text-info" />
}

const ROW = "group flex h-7 items-center gap-1 rounded-md pr-1 text-xs transition"
const ACTION =
  "hidden size-6 shrink-0 items-center justify-center rounded-md text-muted transition hover:bg-surface hover:text-ink group-hover:flex group-focus-within:flex"

export function FileTree({ nodes, activeFile, entrypoint, ...actions }: FileTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [edit, setEdit] = useState<Edit>(null)

  const toggle = (path: string) =>
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  const renderInlineEdit = (node: TreeNode, depth: number) => {
    if (!edit || edit.path !== node.path) return null
    const indent = { paddingLeft: `${depth * 12 + 6}px` }
    if (edit.mode === "delete") {
      return (
        <div className="my-0.5 flex items-center gap-1 rounded-md border border-danger/30 bg-danger/8 py-1 pr-1 text-xs" style={indent}>
          <span className="min-w-0 flex-1 truncate text-danger">
            Hapus {node.kind === "folder" ? "folder" : ""} {node.name}?
          </span>
          <button
            type="button"
            className="rounded px-1.5 py-0.5 font-medium text-danger hover:bg-danger/15"
            onClick={() => {
              actions.onDelete(node.path)
              setEdit(null)
            }}
          >
            Hapus
          </button>
          <button type="button" className="rounded px-1.5 py-0.5 text-muted hover:text-ink" onClick={() => setEdit(null)}>
            Batal
          </button>
        </div>
      )
    }
    return (
      <form
        style={indent}
        className="py-0.5"
        onSubmit={(event) => {
          event.preventDefault()
          actions.onRename(node.path, edit.value)
          setEdit(null)
        }}
      >
        <input
          autoFocus
          aria-label={`Nama baru untuk ${node.path}`}
          value={edit.value}
          onChange={(e) => setEdit({ ...edit, value: e.target.value })}
          onKeyDown={(e) => e.key === "Escape" && setEdit(null)}
          className="h-7 w-full rounded-md border border-accent bg-surface px-2 font-mono text-xs text-ink focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
      </form>
    )
  }

  const renderNode = (node: TreeNode, depth: number): ReactNode => {
    const indent = { paddingLeft: `${depth * 12 + 6}px` }
    const editing = edit?.path === node.path
    const common = (
      <>
        {node.path !== "manual-edits.json" && (
          <button
            type="button"
            aria-label={`Simpan ${node.path} ke library`}
            title="Simpan ke library"
            className={ACTION}
            onClick={() => actions.onSaveToLibrary(node.path)}
          >
            <BookPlus size={11} />
          </button>
        )}
        <button
          type="button"
          aria-label={`Ganti nama ${node.path}`}
          title="Ganti nama / pindah"
          className={ACTION}
          onClick={() => setEdit({ path: node.path, mode: "rename", value: node.path })}
        >
          <Pencil size={11} />
        </button>
        {node.path !== entrypoint && (
          <button
            type="button"
            aria-label={`Hapus ${node.path}`}
            title="Hapus"
            className={ACTION}
            onClick={() => setEdit({ path: node.path, mode: "delete", value: "" })}
          >
            <Trash2 size={11} />
          </button>
        )}
      </>
    )
    if (node.kind === "folder") {
      const open = !collapsed.has(node.path)
      return (
        <li key={node.path}>
          {editing ? (
            renderInlineEdit(node, depth)
          ) : (
            <div className={`${ROW} text-muted hover:bg-raised/60 hover:text-ink`} style={indent}>
              <button
                type="button"
                aria-expanded={open}
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left font-medium"
                onClick={() => toggle(node.path)}
              >
                {open ? <ChevronDown size={12} className="shrink-0" /> : <ChevronRight size={12} className="shrink-0" />}
                {open ? <FolderOpen size={13} className="shrink-0 text-accent/80" /> : <Folder size={13} className="shrink-0" />}
                <span className="truncate">{node.name}</span>
              </button>
              {common}
            </div>
          )}
          {open && <ul>{node.children.map((child) => renderNode(child, depth + 1))}</ul>}
        </li>
      )
    }
    const isActive = node.path === activeFile
    return (
      <li key={node.path}>
        {editing ? (
          renderInlineEdit(node, depth)
        ) : (
          <div
            className={`${ROW} ${
              isActive
                ? "bg-raised font-medium text-ink shadow-xs"
                : "text-muted hover:bg-raised/60 hover:text-ink"
            }`}
            style={indent}
          >
            <button
              type="button"
              aria-current={isActive}
              title={node.path}
              className="flex min-w-0 flex-1 items-center gap-1.5 pl-3 text-left font-mono"
              onClick={() => actions.onOpen(node.path)}
            >
              {fileIcon(node.name)}
              <span className="truncate">{node.name}</span>
              {node.path === entrypoint && <Star size={10} className="shrink-0 fill-accent text-accent" aria-label="file utama" />}
            </button>
            {node.path !== entrypoint && node.path.endsWith(".tsx") && (
              <button
                type="button"
                aria-label={`Jadikan ${node.path} file utama`}
                title="Jadikan file utama"
                className={ACTION}
                onClick={() => actions.onSetEntrypoint(node.path)}
              >
                <Star size={11} />
              </button>
            )}
            {common}
          </div>
        )}
      </li>
    )
  }

  return (
    <ul aria-label="File proyek" className="space-y-0.5 py-1.5">
      {nodes.map((node) => renderNode(node, 0))}
    </ul>
  )
}
