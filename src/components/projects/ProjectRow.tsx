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

  const rename = () => attempt(async () => {
    await projects.rename(project.id, name.trim() || project.name)
    setMode("view")
  })
  const duplicate = () => attempt(async () => {
    const copy = duplicateProject(await projectsRepo.get(project.id))
    await projects.insert({ name: copy.name, entrypoint: copy.entrypoint, files: copy.files, workspaceId: project.workspaceId })
  })
  const download = () => attempt(async () => downloadProjectZip(await projectsRepo.get(project.id)))
  const move = () => attempt(async () => {
    await projectsRepo.move(project.id, target)
    setMode("view")
  })
  const remove = () => attempt(async () => projects.remove(project.id))

  return (
    <li className={`flex flex-wrap items-center gap-2 px-3 py-2 ${isActive ? "bg-raised" : ""}`}>
      {mode === "rename" ? (
        <form className="flex min-w-0 flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); void rename() }}>
          <input autoFocus aria-label="Nama proyek" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} className="h-8 min-w-0 flex-1 rounded border border-line bg-surface px-2 text-sm" />
          <Button type="submit" variant="primary">Simpan</Button>
          <Button onClick={() => setMode("view")}>Batal</Button>
        </form>
      ) : (
        <button type="button" className="min-w-0 flex-1 text-left" onClick={onOpen}>
          <span className="block truncate text-sm">{project.name}</span>
          <span className="block text-xs text-muted">{project.fileCount} file · diubah {DATE_FORMAT.format(project.updatedAt)}</span>
        </button>
      )}
      {mode === "move" && (
        <span className="flex items-center gap-2">
          <select aria-label="Pindah ke workspace" value={target} onChange={(e) => setTarget(e.target.value)} className={`${SELECT_CLASS} w-40`}>
            {workspaces.filter((w) => w.id !== project.workspaceId).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <Button variant="primary" onClick={() => void move()} disabled={!target}>Pindah</Button>
          <Button onClick={() => setMode("view")}>Batal</Button>
        </span>
      )}
      {mode === "delete" && (
        <span className="flex items-center gap-2">
          <span className="text-xs text-danger">Pindahkan ke tempat sampah?</span>
          <Button variant="danger" onClick={() => void remove()}>Hapus</Button>
          <Button onClick={() => setMode("view")}>Batal</Button>
        </span>
      )}
      {mode === "view" && (
        <span className="flex">
          <IconButton label="Ganti nama" onClick={() => { setName(project.name); setMode("rename") }}><Pencil size={14} /></IconButton>
          <IconButton label="Duplikat" onClick={() => void duplicate()}><Copy size={14} /></IconButton>
          <IconButton label="Pindah workspace" disabled={workspaces.length < 2} onClick={() => setMode("move")}><FolderInput size={14} /></IconButton>
          <IconButton label="Unduh ZIP" onClick={() => void download()}><Download size={14} /></IconButton>
          <IconButton label="Hapus" disabled={!canDelete} onClick={() => setMode("delete")}><Trash2 size={14} /></IconButton>
        </span>
      )}
    </li>
  )
}
