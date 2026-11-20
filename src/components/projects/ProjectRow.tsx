import { Copy, Download, FolderInput, Pencil, Trash2 } from "lucide-react"
import { useState } from "react"
import type { ProjectsState } from "../../hooks/useProjects"
import { downloadProjectZip } from "../../lib/download"
import { attempt } from "../../lib/notify"
import { duplicateProject } from "../../lib/project-ops"
import { projectsRepo } from "../../lib/repo"
import type { ProjectSummary, Workspace } from "../../lib/types"
import { Button, IconButton, SELECT_CLASS } from "../ui"

interface ProjectRowProps {
  project: ProjectSummary
  projects: ProjectsState
  workspaces: Workspace[]
  isActive: boolean
  canDelete: boolean
  onOpen: () => void
}

type Mode = "view" | "rename" | "move" | "delete"
const DATE_FORMAT = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" })

export function ProjectRow({ project, projects, workspaces, isActive, canDelete, onOpen }: ProjectRowProps) {
  const [mode, setMode] = useState<Mode>("view")
  const [name, setName] = useState(project.name)
  const [target, setTarget] = useState(workspaces.find((w) => w.id !== project.workspaceId)?.id ?? "")

  const rename = () =>
    attempt(async () => {
      await projects.rename(project.id, name.trim() || project.name)
      setMode("view")
    })
  const duplicate = () =>
    attempt(async () => {
      const copy = duplicateProject(await projectsRepo.get(project.id))
      await projects.insert({ name: copy.name, entrypoint: copy.entrypoint, files: copy.files, workspaceId: project.workspaceId })
    })
  const download = () => attempt(async () => downloadProjectZip(await projectsRepo.get(project.id)))
  const move = () =>
    attempt(async () => {
      await projectsRepo.move(project.id, target)
      setMode("view")
    })
  const remove = () => attempt(async () => projects.remove(project.id))

  return (
    <li className={`flex flex-wrap items-center gap-2 px-3.5 py-2.5 transition ${isActive ? "bg-raised/85" : "hover:bg-raised/40"}`}>
      {mode === "rename" ? (
        <form
          className="flex min-w-0 flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void rename()
          }}
        >
          <input
            autoFocus
            aria-label="Nama proyek"
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
            className="h-8 min-w-0 flex-1 rounded-lg border border-accent bg-surface px-2.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
          <Button size="sm" type="submit" variant="primary">
            Simpan
          </Button>
          <Button size="sm" onClick={() => setMode("view")}>
            Batal
          </Button>
        </form>
      ) : (
        <button type="button" className="min-w-0 flex-1 text-left" onClick={onOpen}>
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-ink">{project.name}</span>
            {isActive && (
              <span className="shrink-0 rounded-full border border-accent/30 bg-accent/12 px-1.5 py-0.2 text-[10px] font-medium text-accent">
                aktif
              </span>
            )}
          </span>
          <span className="mt-0.5 block text-xs text-muted tabular-nums">
            {project.fileCount} file · diubah {DATE_FORMAT.format(project.updatedAt)}
          </span>
        </button>
      )}
      {mode === "move" && (
        <span className="flex items-center gap-2">
          <select aria-label="Pindah ke workspace" value={target} onChange={(e) => setTarget(e.target.value)} className={`${SELECT_CLASS} h-8 w-40 text-xs`}>
            {workspaces
              .filter((w) => w.id !== project.workspaceId)
              .map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
          </select>
          <Button size="sm" variant="primary" onClick={() => void move()} disabled={!target}>
            Pindah
          </Button>
          <Button size="sm" onClick={() => setMode("view")}>
            Batal
          </Button>
        </span>
      )}
      {mode === "delete" && (
        <span className="flex items-center gap-2">
          <span className="text-xs font-medium text-danger">Pindahkan ke tempat sampah?</span>
          <Button size="sm" variant="danger" onClick={() => void remove()}>
            Hapus
          </Button>
          <Button size="sm" onClick={() => setMode("view")}>
            Batal
          </Button>
        </span>
      )}
      {mode === "view" && (
        <span className="flex items-center gap-0.5">
          <IconButton
            label="Ganti nama"
            className="size-7"
            onClick={() => {
              setName(project.name)
              setMode("rename")
            }}
          >
            <Pencil size={13} />
          </IconButton>
          <IconButton label="Duplikat" className="size-7" onClick={() => void duplicate()}>
            <Copy size={13} />
          </IconButton>
          <IconButton label="Pindah workspace" className="size-7" disabled={workspaces.length < 2} onClick={() => setMode("move")}>
            <FolderInput size={13} />
          </IconButton>
          <IconButton label="Unduh ZIP" className="size-7" onClick={() => void download()}>
            <Download size={13} />
          </IconButton>
          <IconButton label="Hapus" className="size-7 hover:text-danger" disabled={!canDelete} onClick={() => setMode("delete")}>
            <Trash2 size={13} />
          </IconButton>
        </span>
      )}
    </li>
  )
}
