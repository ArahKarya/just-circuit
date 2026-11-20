import { RotateCcw, Trash2 } from "lucide-react"
import { useState } from "react"
import toast from "react-hot-toast"
import { useLiveData } from "../../lib/live-data"
import { attempt } from "../../lib/notify"
import { TOPICS, trashRepo } from "../../lib/repo"
import type { TrashEntry, Workspace } from "../../lib/types"
import { Button, IconButton } from "../ui"

interface TrashListProps {
  workspaces: Workspace[]
  onRestored: (projectId: string) => void
}

const DATE_FORMAT = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" })
const RETENTION_DAYS = 30

export function TrashList({ workspaces, onRestored }: TrashListProps) {
  const trash = useLiveData(trashRepo.list, [TOPICS.trash])
  const [confirm, setConfirm] = useState<string | null>(null)
  const workspaceName = (id: string) => workspaces.find((w) => w.id === id)?.name ?? id
  const entries = trash.data ?? []

  const restore = (entry: TrashEntry) =>
    attempt(async () => {
      const project = await trashRepo.restore(entry.entryId)
      toast.success(`${entry.name} dipulihkan`)
      onRestored(project.id)
    })
  const purge = (entry: TrashEntry) =>
    attempt(async () => {
      await trashRepo.purge(entry.entryId)
      setConfirm(null)
    })
  const empty = () =>
    attempt(async () => {
      await trashRepo.empty()
      setConfirm(null)
    })

  if (trash.error) return <p className="text-sm text-danger">Gagal memuat tempat sampah: {trash.error.message}</p>
  if (!trash.data) return <p className="text-sm text-muted">Memuat…</p>

  return (
    <div className="space-y-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface/40 px-3.5 py-2.5">
        <p className="text-xs text-muted">Proyek yang dihapus disimpan {RETENTION_DAYS} hari, lalu dihapus permanen.</p>
        {entries.length > 0 &&
          (confirm === "all" ? (
            <span className="flex items-center gap-2">
              <span className="text-xs font-medium text-danger">Hapus permanen {entries.length} proyek? Tidak bisa dibatalkan.</span>
              <Button size="sm" variant="danger" onClick={() => void empty()}>
                Kosongkan
              </Button>
              <Button size="sm" onClick={() => setConfirm(null)}>
                Batal
              </Button>
            </span>
          ) : (
            <Button size="sm" variant="danger" onClick={() => setConfirm("all")}>
              <Trash2 size={13} />
              Kosongkan
            </Button>
          ))}
      </div>
      {entries.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line bg-surface/40 p-8 text-center text-sm text-muted">Tempat sampah kosong.</p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface/40">
          {entries.map((entry) => (
            <li key={entry.entryId} className="flex flex-wrap items-center gap-2 px-3.5 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink">{entry.name}</span>
                <span className="mt-0.5 block text-xs text-muted">
                  {workspaceName(entry.workspaceId)} · {entry.fileCount} file · dihapus {DATE_FORMAT.format(entry.deletedAt)}
                </span>
              </span>
              {confirm === entry.entryId ? (
                <span className="flex items-center gap-2">
                  <span className="text-xs font-medium text-danger">Hapus permanen?</span>
                  <Button size="sm" variant="danger" onClick={() => void purge(entry)}>
                    Hapus
                  </Button>
                  <Button size="sm" onClick={() => setConfirm(null)}>
                    Batal
                  </Button>
                </span>
              ) : (
                <span className="flex items-center gap-1">
                  <Button size="sm" onClick={() => void restore(entry)}>
                    <RotateCcw size={13} />
                    Pulihkan
                  </Button>
                  <IconButton label="Hapus permanen" className="size-7 hover:text-danger" onClick={() => setConfirm(entry.entryId)}>
                    <Trash2 size={13} />
                  </IconButton>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
