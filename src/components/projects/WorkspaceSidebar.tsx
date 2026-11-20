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
const INPUT_CLASS =
  "h-8 min-w-0 flex-1 rounded-lg border border-accent bg-surface px-2 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-accent/20"

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
    <nav aria-label="Workspace" className="flex flex-col gap-1.5 rounded-xl border border-line bg-surface/40 p-2.5 sm:w-52 sm:shrink-0">
      <p className="px-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Workspace</p>
      <ul className="flex gap-1 overflow-x-auto sm:flex-col sm:overflow-visible">
        {workspaces.map((workspace) => {
          const active = workspace.id === selectedId
          return (
            <li key={workspace.id} className="group flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                aria-current={active}
                onClick={() => onSelect(workspace.id)}
                className={`flex min-w-0 flex-1 items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition ${
                  active ? "bg-raised text-ink shadow-xs" : "text-muted hover:bg-raised/50 hover:text-ink"
                }`}
              >
                <span className="truncate">{workspace.name}</span>
                <span className="rounded-full bg-surface px-1.5 py-0.2 text-[10px] text-muted tabular-nums">{workspace.projectCount}</span>
              </button>
              {active && workspace.id !== DEFAULT_WORKSPACE && !draft && (
                <span className="flex">
                  <IconButton label="Ganti nama workspace" className="size-7 rounded-md" onClick={() => setDraft({ mode: "rename", name: workspace.name })}>
                    <Pencil size={12} />
                  </IconButton>
                  <IconButton
                    label="Hapus workspace"
                    className="size-7 rounded-md hover:text-danger"
                    disabled={workspace.projectCount > 0}
                    title={workspace.projectCount > 0 ? "Pindahkan atau hapus proyeknya dulu" : "Hapus workspace"}
                    onClick={() => void remove(workspace)}
                  >
                    <Trash2 size={12} />
                  </IconButton>
                </span>
              )}
            </li>
          )
        })}
      </ul>
      {draft ? (
        <form
          className="mt-1 flex items-center gap-1"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <input
            autoFocus
            aria-label={draft.mode === "new" ? "Nama workspace baru" : "Nama workspace"}
            value={draft.name}
            maxLength={60}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            className={INPUT_CLASS}
          />
          <IconButton label="Simpan workspace" type="submit" className="size-7 rounded-md text-accent">
            <Check size={14} />
          </IconButton>
          <IconButton label="Batal" className="size-7 rounded-md" onClick={() => setDraft(null)}>
            <X size={14} />
          </IconButton>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setDraft({ mode: "new", name: "" })}
          className="mt-1 flex items-center gap-1.5 rounded-lg border border-dashed border-line px-2.5 py-1.5 text-xs font-medium text-muted transition hover:border-accent/40 hover:bg-raised/50 hover:text-ink"
        >
          <FolderPlus size={13} /> Workspace baru
        </button>
      )}
    </nav>
  )
}
