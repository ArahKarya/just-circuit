import { BookOpen, Pencil, Search, Trash2 } from "lucide-react"
import { useMemo, useState } from "react"
import toast from "react-hot-toast"
import { insertLibraryItem, type LibraryItem } from "../../lib/library"
import { useLiveData } from "../../lib/live-data"
import { attempt } from "../../lib/notify"
import { libraryRepo, TOPICS } from "../../lib/repo"
import type { Project } from "../../lib/types"
import { Button, IconButton, Modal } from "../ui"

interface LibraryDialogProps {
  project: Project
  /** Applies the project with the inserted files (recorded as a version). */
  onInsert: (next: Project, message: string, openFile: string) => Promise<void>
  onClose: () => void
}

const DATE_FORMAT = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" })

export function LibraryDialog({ project, onInsert, onClose }: LibraryDialogProps) {
  const items = useLiveData(libraryRepo.list, [TOPICS.library])
  const [query, setQuery] = useState("")
  const [editing, setEditing] = useState<{ id: string; description: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (items.data ?? []).filter((item) => !needle || `${item.name} ${item.description} ${item.exports.join(" ")}`.toLowerCase().includes(needle))
  }, [items.data, query])

  const insert = (item: LibraryItem) =>
    attempt(async () => {
      const full = await libraryRepo.get(item.id)
      const result = insertLibraryItem(project, full)
      await onInsert(result.project, `Sisipkan ${item.name} dari library`, project.entrypoint)
      toast.success(result.componentName ? `${item.name} disisipkan, pakai <${result.componentName} /> di board` : `${item.name} disalin ke ${result.folder}/`)
      onClose()
    })

  return (
    <Modal title="Library komponen" wide onClose={onClose}>
      <div className="space-y-3">
        <label className="relative block">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="search"
            aria-label="Cari di library"
            placeholder="Cari komponen…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-9 w-full rounded-md border border-line bg-surface pl-8 pr-2 text-sm focus:border-accent focus:outline-none"
          />
        </label>
        {items.error && <p className="text-sm text-danger">{items.error.message}</p>}
        {items.data && visible.length === 0 && (
          <div className="rounded-md border border-dashed border-line p-6 text-center text-sm text-muted">
            <BookOpen size={20} className="mx-auto mb-2" />
            {query ? "Tidak ada yang cocok." : "Library masih kosong. Di tab Kode, arahkan ke file atau folder lalu klik ikon buku untuk menyimpannya ke library."}
          </div>
        )}
        <ul className="divide-y divide-line rounded-md border border-line" aria-label="Isi library">
          {visible.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{item.name}</p>
                {editing?.id === item.id ? (
                  <form
                    className="mt-1 flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault()
                      void attempt(async () => {
                        await libraryRepo.update(item.id, { description: editing.description })
                        setEditing(null)
                      })
                    }}
                  >
                    <input autoFocus aria-label="Keterangan" value={editing.description} maxLength={500} onChange={(e) => setEditing({ ...editing, description: e.target.value })} className="h-8 min-w-0 flex-1 rounded border border-line bg-surface px-2 text-xs" />
                    <Button type="submit" variant="primary">Simpan</Button>
                  </form>
                ) : (
                  <p className="truncate text-xs text-muted">
                    {item.description || "Tanpa keterangan"} · {item.fileCount} file{item.exports.length ? ` · ${item.exports.join(", ")}` : ""} · {DATE_FORMAT.format(item.updatedAt)}
                  </p>
                )}
              </div>
              {confirmDelete === item.id ? (
                <span className="flex items-center gap-2">
                  <span className="text-xs text-danger">Hapus dari library?</span>
                  <Button variant="danger" onClick={() => void attempt(async () => libraryRepo.remove(item.id))}>Hapus</Button>
                  <Button onClick={() => setConfirmDelete(null)}>Batal</Button>
                </span>
              ) : (
                <span className="flex items-center">
                  <Button variant="primary" onClick={() => void insert(item)}>Sisipkan</Button>
                  <IconButton label={`Ubah keterangan ${item.name}`} onClick={() => setEditing({ id: item.id, description: item.description })}><Pencil size={14} /></IconButton>
                  <IconButton label={`Hapus ${item.name}`} onClick={() => setConfirmDelete(item.id)}><Trash2 size={14} /></IconButton>
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  )
}
