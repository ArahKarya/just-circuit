import { Check, FolderPlus, Pencil, Trash2, X } from "lucide-react"
import { useState } from "react"
import { attempt } from "../../lib/notify"
import { workspacesRepo } from "../../lib/repo"
import type { Workspace } from "../../lib/types"
import { IconButton } from "../ui"

interface WorkspaceSidebarProps {
  workspaces: Workspace[]
  selectedId: string
  onSelect: (id: string) => void
}

const DEFAULT_WORKSPACE = "default"
const INPUT_CLASS = "h-8 min-w-0 flex-1 rounded border border-line bg-surface px-2 text-sm"

export function WorkspaceSidebar({ workspaces, selectedId, onSelect }: WorkspaceSidebarProps) {
  const [draft, setDraft] = useState<{ mode: "new" | "rename"; name: string } | null>(null)

  const submit = () =>
    attempt(async () => {
      if (!draft?.name.trim()) return
      if (draft.mode === "new") onSelect((await workspacesRepo.create(draft.name.trim())).id)
      else await workspacesRepo.rename(selectedId, draft.name.trim())
      setDraft(null)
    })

  const remove = (workspace: Workspace) =>
    attempt(async () => {
      await workspacesRepo.remove(workspace.id)
      onSelect(DEFAULT_WORKSPACE)
    })

  return (
    <nav aria-label="Workspace" className="flex flex-col gap-1 sm:w-48 sm:shrink-0">
      <p className="px-2 text-xs font-medium uppercase tracking-wide text-muted">Workspace</p>
      <ul className="flex gap-1 overflow-x-auto sm:flex-col sm:overflow-visible">
        {workspaces.map((workspace) => (
          <li key={workspace.id} className="group flex shrink-0 items-center">
            <button
              type="button"
              aria-current={workspace.id === selectedId}
              onClick={() => onSelect(workspace.id)}
              className={`flex min-w-0 flex-1 items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm ${workspace.id === selectedId ? "bg-raised text-ink" : "text-muted hover:text-ink"}`}
            >
              <span className="truncate">{workspace.name}</span>
              <span className="text-xs text-muted">{workspace.projectCount}</span>
            </button>
            {workspace.id === selectedId && workspace.id !== DEFAULT_WORKSPACE && !draft && (
              <span className="flex">
                <IconButton label="Ganti nama workspace" className="size-7" onClick={() => setDraft({ mode: "rename", name: workspace.name })}><Pencil size={13} /></IconButton>
                <IconButton label="Hapus workspace" className="size-7" disabled={workspace.projectCount > 0} title={workspace.projectCount > 0 ? "Pindahkan atau hapus proyeknya dulu" : "Hapus workspace"} onClick={() => void remove(workspace)}><Trash2 size={13} /></IconButton>
              </span>
            )}
          </li>
        ))}
      </ul>
      {draft ? (
        <form
          className="flex items-center gap-1"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <input autoFocus aria-label={draft.mode === "new" ? "Nama workspace baru" : "Nama workspace"} value={draft.name} maxLength={60} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={INPUT_CLASS} />
          <IconButton label="Simpan workspace" type="submit" className="size-8"><Check size={14} /></IconButton>
          <IconButton label="Batal" className="size-8" onClick={() => setDraft(null)}><X size={14} /></IconButton>
        </form>
      ) : (
        <button type="button" onClick={() => setDraft({ mode: "new", name: "" })} className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted hover:text-ink">
          <FolderPlus size={14} /> Workspace baru
        </button>
      )}
    </nav>
  )
}
