import { Copy, Download, Pencil, Plus, Trash2 } from "lucide-react"
import { useState } from "react"
import type { ProjectsState } from "../hooks/useProjects"
import { downloadProjectZip } from "../lib/download"
import { duplicateProject, renamed } from "../lib/project-ops"
import type { Project } from "../lib/types"
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
    await projects.create(newName || "Proyek baru")
    setNewName("")
    onClose()
  }

  const open = (project: Project) => {
    projects.select(project.id)
    onClose()
  }

  const commitRename = async (project: Project) => {
    await projects.save(renamed(project, editName))
    setEditingId(null)
  }

  const duplicate = async (project: Project) => {
    await projects.insert(duplicateProject(project))
  }

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
            <li key={project.id} className={`flex items-center gap-2 px-3 py-2 ${project.id === projects.active?.id ? "bg-raised" : ""}`}>
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
                    {Object.keys(project.files).length} file · diubah {DATE_FORMAT.format(project.updatedAt)}
                  </span>
                </button>
              )}
              {confirmDeleteId === project.id ? (
                <>
                  <span className="text-xs text-danger">Hapus permanen?</span>
                  <Button variant="danger" onClick={() => void projects.remove(project.id)}>Hapus</Button>
                  <Button onClick={() => setConfirmDeleteId(null)}>Batal</Button>
                </>
              ) : (
                <>
                  <IconButton label="Ganti nama" onClick={() => { setEditingId(project.id); setEditName(project.name) }}><Pencil size={14} /></IconButton>
                  <IconButton label="Duplikat" onClick={() => void duplicate(project)}><Copy size={14} /></IconButton>
                  <IconButton label="Unduh ZIP" onClick={() => void downloadProjectZip(project)}><Download size={14} /></IconButton>
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
