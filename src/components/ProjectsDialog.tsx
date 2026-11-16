import { Copy, Download, Pencil, Plus, Trash2 } from "lucide-react"
import { useState } from "react"
import toast from "react-hot-toast"
import type { ProjectsState } from "../hooks/useProjects"
import { downloadProjectZip } from "../lib/download"
import { duplicateProject } from "../lib/project-ops"
import { projectsRepo } from "../lib/repo"
import type { ProjectSummary } from "../lib/types"
import { Button, Field, IconButton, Modal } from "./ui"

interface ProjectsDialogProps {
  projects: ProjectsState
  onClose: () => void
}

const DATE_FORMAT = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" })

export function ProjectsDialog({ projects, onClose }: ProjectsDialogProps) {
  const [newName, setNewName] = useState("")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState("")
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const create = async () => {
    await attempt(async () => {
      await projects.create(newName || "Proyek baru")
      setNewName("")
      onClose()
    })
  }

  /** Runs an action and reports failures instead of leaving the dialog silent. */
  const attempt = async (action: () => Promise<void>) => {
    try {
      await action()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal")
    }
  }

  const open = (project: ProjectSummary) => {
    projects.select(project.id)
    onClose()
  }

  const commitRename = (project: ProjectSummary) =>
    attempt(async () => {
      await projects.rename(project.id, editName.trim() || project.name)
      setEditingId(null)
    })

  const duplicate = (project: ProjectSummary) =>
    attempt(async () => {
      const copy = duplicateProject(await projectsRepo.get(project.id))
      await projects.insert({ name: copy.name, entrypoint: copy.entrypoint, files: copy.files })
    })

  const download = (project: ProjectSummary) => attempt(async () => downloadProjectZip(await projectsRepo.get(project.id)))

  const remove = (project: ProjectSummary) =>
    attempt(async () => {
      await projects.remove(project.id)
      setConfirmDeleteId(null)
    })

  return (
    <Modal title="Proyek" wide onClose={onClose}>
      <div className="space-y-4">
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void create()
          }}
        >
          <div className="flex-1">
            <Field label="Proyek baru" placeholder="mis. Power supply 5V" value={newName} onChange={(e) => setNewName(e.target.value)} />
          </div>
          <Button variant="primary" type="submit"><Plus size={15} />Buat</Button>
        </form>

        <ul className="divide-y divide-line rounded-md border border-line">
          {(projects.projects ?? []).map((project) => (
            <li key={project.id} className={`flex items-center gap-2 px-3 py-2 ${project.id === projects.activeId ? "bg-raised" : ""}`}>
              {editingId === project.id ? (
                <form
                  className="flex flex-1 gap-2"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void commitRename(project)
                  }}
                >
                  <input
                    autoFocus
                    aria-label="Nama proyek"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="h-8 flex-1 rounded border border-line bg-surface px-2 text-sm"
                  />
                  <Button type="submit" variant="primary">Simpan</Button>
                </form>
              ) : (
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => open(project)}>
                  <span className="block truncate text-sm">{project.name}</span>
                  <span className="block text-xs text-muted">
                    {project.fileCount} file · diubah {DATE_FORMAT.format(project.updatedAt)}
                  </span>
                </button>
              )}
              {confirmDeleteId === project.id ? (
                <>
                  <span className="text-xs text-danger">Pindahkan ke tempat sampah?</span>
                  <Button variant="danger" onClick={() => void remove(project)}>Hapus</Button>
                  <Button onClick={() => setConfirmDeleteId(null)}>Batal</Button>
                </>
              ) : (
                <>
                  <IconButton label="Ganti nama" onClick={() => { setEditingId(project.id); setEditName(project.name) }}><Pencil size={14} /></IconButton>
                  <IconButton label="Duplikat" onClick={() => void duplicate(project)}><Copy size={14} /></IconButton>
                  <IconButton label="Unduh ZIP" onClick={() => void download(project)}><Download size={14} /></IconButton>
                  <IconButton label="Hapus" onClick={() => setConfirmDeleteId(project.id)} disabled={(projects.projects?.length ?? 0) <= 1}><Trash2 size={14} /></IconButton>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  )
}
